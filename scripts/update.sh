#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# update.sh — Pull latest birdash from origin/main and restart services
#
# Usage:
#   bash scripts/update.sh [--write-status PATH] [--force]
#
# Options:
#   --write-status PATH   Write JSON progress to PATH (for UI polling)
#   --force               Force update even with diverged history
#                         (git reset --hard origin/main)
#
# What it does:
#   1. Handle uncommitted changes (auto-reset package-lock.json)
#   2. git fetch + fast-forward (or --force reset) to origin/main
#   3. npm/pip install if dependencies changed (fatal on failure)
#   4. Run idempotent migrations
#   5. Restart birdash + birdengine with health-check
#   6. Write summary + rollback info for the UI
# ══════════════════════════════════════════════════════════════════════════

set -e

REPO_DIR="${BIRDASH_DIR:-$HOME/birdash}"
BRANCH="${BIRDASH_BRANCH:-main}"
BIRDASH_PORT="${BIRDASH_PORT:-7474}"
LOG_FILE="${REPO_DIR}/config/update.log"

STATUS_FILE=""
FORCE=0
while [ $# -gt 0 ]; do
    case "$1" in
        --write-status) STATUS_FILE="$2"; shift 2 ;;
        --force)        FORCE=1; shift ;;
        *)              shift ;;
    esac
done

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# write_status STATE STEP DETAIL [extra JSON fields]
# Atomic write so a poller never reads a half-written file.
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
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() {
    echo -e "${RED}✗${NC} $1" >&2
    # Include previousCommit so the UI can offer rollback
    local extra=""
    [ -n "$OLD_HEAD" ] && extra="\"previousCommit\":\"$OLD_HEAD\",\"previousShort\":\"$(echo "$OLD_HEAD" | cut -c1-7)\""
    write_status failed error "$1" "$extra"
    exit 1
}

if [ ! -d "$REPO_DIR/.git" ]; then
    fail "$REPO_DIR is not a git checkout. Use bootstrap.sh for a fresh install."
fi

cd "$REPO_DIR"

# Redirect all output to log file (tee for both console and file)
mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1
echo ""
echo "════════════════════════════════════════════════════"
echo "  Update started at $(date -Iseconds)"
echo "════════════════════════════════════════════════════"

# ── 1. Handle uncommitted changes in tracked files ───────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
    dirty=$(git diff --name-only; git diff --cached --name-only)
    if [ "$dirty" = "package-lock.json" ]; then
        warn "Resetting auto-modified package-lock.json"
        git checkout -- package-lock.json
    elif [ "$FORCE" = "1" ]; then
        warn "Force mode: resetting all uncommitted changes"
        git checkout -- .
        git clean -fd --exclude=config/ --exclude=data/ 2>/dev/null || true
    else
        warn "Uncommitted changes in tracked files:"
        git status --short | grep -E '^( M|M |A |D |R )' || true
        echo ""
        fail "Uncommitted changes block the update. Use force-update from the UI or run: git stash"
    fi
fi

# ── 2. Fetch and fast-forward ─────────────────────────────────────────────
info "Fetching origin/$BRANCH..."
git fetch --quiet --tags origin "$BRANCH"

OLD_HEAD=$(git rev-parse HEAD)
NEW_HEAD=$(git rev-parse "origin/$BRANCH")

if [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
    ok "Already up to date ($(git rev-parse --short HEAD))"
    if [ -n "$STATUS_FILE" ]; then
        SHORT=$(git rev-parse --short HEAD)
        write_status done up-to-date "Already on $SHORT" "\"newCommit\":\"$SHORT\""
    fi
    exit 0
fi

info "Updating $(git rev-parse --short HEAD) → $(git rev-parse --short "origin/$BRANCH")..."
git checkout --quiet "$BRANCH" 2>/dev/null || true

# ── 2a. Merge strategy ───────────────────────────────────────────────────
_attempt_merge() {
    local err
    err=$(git merge --ff-only --quiet "origin/$BRANCH" 2>&1) && return 0

    # Handle untracked files that conflict with incoming tracked files.
    local files
    files=$(echo "$err" | sed -n '/would be overwritten by merge/,/Aborting/{/^[[:space:]]/p}' | tr -d '\t')
    if [ -n "$files" ]; then
        while IFS= read -r f; do
            [ -z "$f" ] && continue
            [ ! -e "$f" ] && continue
            if git show "origin/$BRANCH:$f" 2>/dev/null | cmp -s - "$f"; then
                warn "untracked $f matches incoming version — removing"
                rm -f "$f"
            else
                fail "Untracked $f differs from remote version. Remove it manually or use force-update."
            fi
        done <<< "$files"
        git merge --ff-only --quiet "origin/$BRANCH" && return 0
    fi

    # If we get here, ff-only failed (diverged history)
    echo "$err" >&2
    return 1
}

if ! _attempt_merge; then
    if [ "$FORCE" = "1" ]; then
        warn "Fast-forward failed — force-resetting to origin/$BRANCH"
        git reset --hard "origin/$BRANCH"
    else
        fail "Fast-forward failed (diverged history). Use force-update from the UI."
    fi
fi
ok "Pulled $(git rev-list --count "$OLD_HEAD..$NEW_HEAD") commit(s)"

# ── 3. Decide what changed ────────────────────────────────────────────────
CHANGED=$(git diff --name-only "$OLD_HEAD" "$NEW_HEAD")

needs_npm=0
needs_pip=0

while IFS= read -r f; do
    case "$f" in
        package.json|package-lock.json)  needs_npm=1 ;;
        engine/requirements.txt)         needs_pip=1 ;;
    esac
done <<< "$CHANGED"

# ── 4. Install dependencies (FATAL on failure) ───────────────────────────
if [ "$needs_npm" = "1" ]; then
    info "Installing Node dependencies..."
    if ! npm install --omit=dev --silent 2>&1; then
        fail "npm install failed. Dependencies are missing — not restarting services."
    fi
    ok "Node dependencies installed"
fi

if [ "$needs_pip" = "1" ]; then
    info "Syncing Python dependencies..."
    VENV=""
    if [ -f "$REPO_DIR/engine/venv/bin/pip" ]; then
        VENV="$REPO_DIR/engine/venv"
    elif [ -f "$HOME/birdengine/venv/bin/pip" ]; then
        VENV="$HOME/birdengine/venv"
    fi
    if [ -n "$VENV" ] && [ -f "$REPO_DIR/engine/requirements.txt" ]; then
        if ! "$VENV/bin/pip" install -r "$REPO_DIR/engine/requirements.txt" -q 2>&1; then
            fail "pip install failed. Python dependencies are missing — not restarting services."
        fi
        ok "Python dependencies synced"
    else
        warn "Python venv or requirements.txt not found — skipping pip sync"
    fi
fi

# ── 4b. Sync engine *.py to ~/birdengine if that's the runtime path ──────
# Some installs (older layouts, BirdNET-Pi descendants) run the engine out
# of $HOME/birdengine instead of $REPO_DIR/engine. The systemd service
# was set up that way at install time and we don't want to rewrite it on
# update. Just rsync the python files so the new code actually runs.
if [ -d "$HOME/birdengine" ] && [ "$HOME/birdengine" != "$REPO_DIR/engine" ]; then
    if grep -q "$HOME/birdengine/engine.py" /etc/systemd/system/birdengine.service 2>/dev/null \
       || systemctl show birdengine.service -p ExecStart 2>/dev/null | grep -q "$HOME/birdengine/engine.py"; then
        info "Syncing engine .py files to $HOME/birdengine (legacy runtime path)..."
        for f in engine.py range_filter_cli.py filter_preview.py yamnet_filter.py; do
            [ -f "$REPO_DIR/engine/$f" ] && cp -f "$REPO_DIR/engine/$f" "$HOME/birdengine/$f"
        done
        # YAMNet model + labels (only sync if newer or missing — they're 4 MB)
        if [ -d "$REPO_DIR/engine/models" ] && [ -d "$HOME/birdengine/models" ]; then
            for f in yamnet.tflite yamnet_class_map.csv; do
                src="$REPO_DIR/engine/models/$f"
                dst="$HOME/birdengine/models/$f"
                if [ -f "$src" ] && [ ! "$dst" -nt "$src" ]; then
                    cp -f "$src" "$dst"
                fi
            done
        fi
        ok "Engine files synced to $HOME/birdengine"
    fi
fi

# ── 5. Run migrations ────────────────────────────────────────────────────
if [ -d "scripts/migrations" ]; then
    info "Running migrations..."
    migration_failed=0
    for m in scripts/migrations/[0-9][0-9][0-9]-*.sh; do
        [ -f "$m" ] || continue
        if ! bash "$m"; then
            warn "migration $(basename "$m") failed"
            migration_failed=1
        fi
    done
    if [ "$migration_failed" = "1" ]; then
        warn "One or more migrations failed — services will still restart"
    fi
fi

# ── 6. Restart services with health-check ─────────────────────────────────
info "Restarting birdash..."
sudo systemctl restart birdash

# Health-check: wait up to 15s for /api/health to respond
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
    # Check if at least systemd says it's running
    if systemctl is-active --quiet birdash; then
        warn "birdash is active but /api/health did not respond in 15s"
    else
        fail "birdash failed to start — check: sudo journalctl -u birdash -n 30"
    fi
fi

info "Restarting birdengine..."
sudo systemctl restart birdengine
sleep 3
if systemctl is-active --quiet birdengine; then
    ok "birdengine active"
else
    fail "birdengine failed to start — check: sudo journalctl -u birdengine -n 30"
fi

# ── 7. Anonymous update ping (best-effort, background) ────────────────────
_ping_update() {
    local version hardware os_name country
    version=$(grep -o '"version": *"[^"]*"' "$REPO_DIR/package.json" 2>/dev/null | grep -o '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*' || echo "unknown")
    hardware=$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0' || echo "unknown")
    os_name=$(grep -oP 'PRETTY_NAME="\K[^"]+' /etc/os-release 2>/dev/null || echo "unknown")
    country=$(curl -s -m 3 https://ipapi.co/country_name/ 2>/dev/null || echo "unknown")
    curl -s -m 5 -X POST "https://ujuaoogpthdlyvyphgpc.supabase.co/rest/v1/pings" \
        -H "apikey: sb_publishable_aM2y1SE0B42oXD05wuGmJQ_FsqmzSHa" \
        -H "Authorization: Bearer sb_publishable_aM2y1SE0B42oXD05wuGmJQ_FsqmzSHa" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=minimal" \
        -d "{\"event\":\"update\",\"version\":\"$version\",\"hardware\":\"$hardware\",\"os\":\"$os_name\",\"country\":\"$country\"}" \
        >/dev/null 2>&1 || true
}
_ping_update &

# ── 8. Summary ────────────────────────────────────────────────────────────
echo ""
echo "Updated to $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
echo "Changed files:"
echo "$CHANGED" | sed 's/^/  /'

if [ -n "$STATUS_FILE" ]; then
    NEW_SHORT=$(git rev-parse --short HEAD)
    OLD_SHORT=$(echo "$OLD_HEAD" | cut -c1-7)
    NEW_SUBJECT=$(git log -1 --format=%s | sed 's/\\/\\\\/g; s/"/\\"/g')
    write_status done complete "Updated to $NEW_SHORT" \
        "\"newCommit\":\"$NEW_SHORT\",\"subject\":\"$NEW_SUBJECT\",\"previousCommit\":\"$OLD_HEAD\",\"previousShort\":\"$OLD_SHORT\""
fi
