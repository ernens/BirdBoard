#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# rollback.sh — Revert birdash to a specific commit and restart services
#
# Usage:
#   bash scripts/rollback.sh <commit-sha> [--write-status PATH]
#
# Called by POST /api/rollback-update when the user clicks "Rollback"
# in the update modal after a failed or regretted update.
# ══════════════════════════════════════════════════════════════════════════

set -e

REPO_DIR="${BIRDASH_DIR:-$HOME/birdash}"
BIRDASH_PORT="${BIRDASH_PORT:-7474}"
TARGET_COMMIT="${1:-}"
LOG_FILE="${REPO_DIR}/config/update.log"

if [ -z "$TARGET_COMMIT" ]; then
    echo "Usage: rollback.sh <commit-sha> [--write-status PATH]" >&2
    exit 1
fi

STATUS_FILE=""
shift || true
while [ $# -gt 0 ]; do
    case "$1" in
        --write-status) STATUS_FILE="$2"; shift 2 ;;
        *) shift ;;
    esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

write_status() {
    [ -z "$STATUS_FILE" ] && return 0
    local state="$1" step="$2" detail="$3" extra="${4:-}"
    local tmp="${STATUS_FILE}.$$"
    local esc
    esc=$(printf '%s' "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')
    cat > "$tmp" <<STATUSEOF
{"state":"$state","step":"$step","detail":"$esc"${extra:+,$extra},"updatedAt":"$(date -Iseconds)"}
STATUSEOF
    mv "$tmp" "$STATUS_FILE"
}

info() { echo -e "${BLUE}▶${NC} $1"; write_status running "${1%%...*}" "$1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1" >&2; write_status failed error "$1"; exit 1; }

cd "$REPO_DIR"

# Log
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1
echo ""
echo "════════════════════════════════════════════════════"
echo "  Rollback started at $(date -Iseconds)"
echo "  Target: $TARGET_COMMIT"
echo "════════════════════════════════════════════════════"

# Verify the target commit exists locally
if ! git cat-file -e "$TARGET_COMMIT" 2>/dev/null; then
    fail "Commit $TARGET_COMMIT not found locally."
fi

info "Rolling back to $(echo "$TARGET_COMMIT" | cut -c1-7)..."
git reset --hard "$TARGET_COMMIT"
ok "Git reset to $(git rev-parse --short HEAD)"

# Reinstall dependencies to match the rolled-back code
info "Installing Node dependencies..."
npm install --omit=dev --silent 2>&1 || echo "  (npm install warning — continuing)"
ok "Node dependencies synced"

# Restart services
info "Restarting birdash..."
sudo systemctl restart birdash

birdash_healthy=0
for i in $(seq 1 15); do
    sleep 1
    if curl -sf "http://127.0.0.1:${BIRDASH_PORT}/api/health" >/dev/null 2>&1; then
        birdash_healthy=1
        break
    fi
done

if [ "$birdash_healthy" = "1" ]; then
    ok "birdash active and healthy"
else
    if systemctl is-active --quiet birdash; then
        echo "  (birdash active but /api/health slow)"
    else
        fail "birdash failed to start after rollback"
    fi
fi

info "Restarting birdengine..."
sudo systemctl restart birdengine
sleep 3
if systemctl is-active --quiet birdengine; then
    ok "birdengine active"
else
    echo "  birdengine state: $(systemctl is-active birdengine)"
fi

NEW_SHORT=$(git rev-parse --short HEAD)
ok "Rollback complete — now on $NEW_SHORT"

if [ -n "$STATUS_FILE" ]; then
    write_status done complete "Rolled back to $NEW_SHORT" "\"newCommit\":\"$NEW_SHORT\""
fi
