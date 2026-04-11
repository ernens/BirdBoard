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

# --write-status PATH — when set, every step also appends a JSON object
# to the named file (overwriting it each time so the dashboard can poll
# for progress while update.sh is running detached).
STATUS_FILE=""
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

# write_status STATE STEP DETAIL
# Atomic write so a poller never reads a half-written file.
write_status() {
    [ -z "$STATUS_FILE" ] && return 0
    local state="$1" step="$2" detail="$3"
    local tmp="${STATUS_FILE}.$$"
    # Escape double quotes in detail to keep the JSON valid.
    local esc
    esc=$(printf '%s' "$detail" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr '\n' ' ')
    cat > "$tmp" <<EOF
{"state":"$state","step":"$step","detail":"$esc","updatedAt":"$(date -Iseconds)"}
EOF
    mv "$tmp" "$STATUS_FILE"
}

info() { echo -e "${BLUE}▶${NC} $1"; write_status running "${1%%...*}" "$1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1" >&2; write_status failed error "$1"; exit 1; }

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

# Resolve "untracked working tree file would be overwritten" automatically.
# Common case: a file was scp'd to this host before being committed upstream.
# If the untracked local copy is byte-identical to the incoming version, the
# safest move is to remove it and let git pull put the tracked version in
# place. If contents differ, abort with a clear message.
_attempt_merge() {
    local err
    err=$(git merge --ff-only --quiet "origin/$BRANCH" 2>&1) && return 0
    # Pull out the offending file list from git's error output.
    local files
    files=$(echo "$err" | sed -n '/would be overwritten by merge/,/Aborting/{/^[[:space:]]/p}' | tr -d '\t')
    [ -z "$files" ] && { echo "$err" >&2; return 1; }

    while IFS= read -r f; do
        [ -z "$f" ] && continue
        [ ! -e "$f" ] && continue
        # Compare local untracked content to the incoming tracked version.
        if git show "origin/$BRANCH:$f" 2>/dev/null | cmp -s - "$f"; then
            warn "untracked $f matches incoming version — removing"
            rm -f "$f"
        else
            echo "" >&2
            fail "untracked $f differs from origin/$BRANCH:$f. Inspect and remove manually."
        fi
    done <<< "$files"

    git merge --ff-only --quiet "origin/$BRANCH"
}

_attempt_merge || fail "Fast-forward failed (diverged history?)"
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

# Final status for the dashboard poller. Includes the new commit so the
# UI can confirm the apply landed and offer "reload page".
if [ -n "$STATUS_FILE" ]; then
    NEW_SHORT=$(git rev-parse --short HEAD)
    NEW_SUBJECT=$(git log -1 --format=%s | sed 's/\\/\\\\/g; s/"/\\"/g')
    cat > "${STATUS_FILE}.$$" <<EOF
{"state":"done","step":"complete","detail":"Updated to $NEW_SHORT","newCommit":"$NEW_SHORT","subject":"$NEW_SUBJECT","updatedAt":"$(date -Iseconds)"}
EOF
    mv "${STATUS_FILE}.$$" "$STATUS_FILE"
fi
