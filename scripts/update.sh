#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# update.sh — Pull latest birdash from origin/main and restart services
#
# Run on a remote Pi:
#   ssh user@pi.local 'cd ~/birdash && bash scripts/update.sh'
#
# Or one-shot from your dev machine for several Pis at once:
#   for h in mickey donald papier; do
#     ssh "$h.local" 'bash ~/birdash/scripts/update.sh'
#   done
#
# What it does:
#   1. Refuse to run if there are uncommitted local changes that would
#      conflict with the pull.
#   2. git fetch + fast-forward to origin/main.
#   3. npm install if package-lock.json changed.
#   4. Restart birdash + birdengine if any server-side / engine file
#      moved (skip if only docs/UI changed and the tab cache reload is
#      enough — the dashboard JS is statically served so it picks up new
#      versions on browser reload anyway).
#   5. Print a summary of what changed.
# ══════════════════════════════════════════════════════════════════════════

set -e

REPO_DIR="${BIRDASH_DIR:-$HOME/birdash}"
BRANCH="${BIRDASH_BRANCH:-main}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}▶${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1" >&2; exit 1; }

if [ ! -d "$REPO_DIR/.git" ]; then
    fail "$REPO_DIR is not a git checkout. Use bootstrap.sh for a fresh install."
fi

cd "$REPO_DIR"

# ── 1. Refuse to run with uncommitted changes that would conflict ─────────
# Untracked files are fine (data/, config/apprise.txt, etc. are gitignored).
# Modified tracked files would be lost by git pull --ff-only.
if ! git diff --quiet || ! git diff --cached --quiet; then
    warn "Uncommitted changes in tracked files:"
    git status --short | grep -E '^( M|M |A |D |R )' || true
    echo ""
    fail "Refusing to update. Stash or commit them first: git stash"
fi

# ── 2. Fetch and fast-forward ─────────────────────────────────────────────
info "Fetching origin/$BRANCH..."
git fetch --quiet origin "$BRANCH"

OLD_HEAD=$(git rev-parse HEAD)
NEW_HEAD=$(git rev-parse "origin/$BRANCH")

if [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
    ok "Already up to date ($(git rev-parse --short HEAD))"
    exit 0
fi

info "Updating $(git rev-parse --short HEAD) → $(git rev-parse --short "origin/$BRANCH")..."
git checkout --quiet "$BRANCH" 2>/dev/null || true
git merge --ff-only --quiet "origin/$BRANCH" || fail "Fast-forward failed (diverged history?)"
ok "Pulled $(git rev-list --count "$OLD_HEAD..$NEW_HEAD") commit(s)"

# ── 3. Decide what changed ────────────────────────────────────────────────
CHANGED=$(git diff --name-only "$OLD_HEAD" "$NEW_HEAD")

needs_npm=0
needs_birdash=0
needs_birdengine=0

while IFS= read -r f; do
    case "$f" in
        package.json|package-lock.json) needs_npm=1; needs_birdash=1 ;;
        server/*|server.js)             needs_birdash=1 ;;
        engine/*.py|engine/*.toml|engine/*.sh) needs_birdengine=1 ;;
        public/*|*.html|*.css|*.js)     ;;  # static, browser reload picks up
    esac
done <<< "$CHANGED"

# ── 4. npm install if dependencies moved ──────────────────────────────────
if [ "$needs_npm" = "1" ]; then
    info "Installing Node dependencies..."
    npm install --omit=dev --silent || warn "npm install failed (non-fatal)"
fi

# ── 5. Restart services if needed ─────────────────────────────────────────
if [ "$needs_birdash" = "1" ]; then
    info "Restarting birdash..."
    sudo systemctl restart birdash
    sleep 2
    if systemctl is-active --quiet birdash; then ok "birdash active"
    else fail "birdash failed to start — check: sudo journalctl -u birdash -n 30"
    fi
fi
if [ "$needs_birdengine" = "1" ]; then
    info "Restarting birdengine..."
    sudo systemctl restart birdengine
    sleep 3
    if systemctl is-active --quiet birdengine; then ok "birdengine active"
    else warn "birdengine state: $(systemctl is-active birdengine)"
    fi
fi

# ── 6. Summary ────────────────────────────────────────────────────────────
echo ""
echo "Updated to $(git rev-parse --short HEAD): $(git log -1 --format=%s)"
echo "Changed files:"
echo "$CHANGED" | sed 's/^/  /'
