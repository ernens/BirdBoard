#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# Birdash — One-line installer bootstrap
# https://github.com/ernens/birdash
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/ernens/birdash/main/bootstrap.sh | bash
#
# What it does:
#   1. Verifies the host (Debian-based, sudo available)
#   2. Installs git if missing
#   3. Clones the birdash repo into ~/birdash
#   4. Runs install.sh in non-interactive mode
# ══════════════════════════════════════════════════════════════════════════

set -e

REPO_URL="https://github.com/ernens/birdash.git"
BRANCH="${BIRDASH_BRANCH:-main}"
TARGET_DIR="$HOME/birdash"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}▶${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1" >&2; exit 1; }

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Birdash — Automated bootstrap installer${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""

# ── Sanity checks ─────────────────────────────────────────────────────────
if [ "$EUID" -eq 0 ]; then
    fail "Do not run this script as root. Run it as the user that will own birdash."
fi

if ! command -v sudo >/dev/null 2>&1; then
    fail "sudo is required. Install it with: apt install sudo"
fi

if ! command -v apt-get >/dev/null 2>&1; then
    fail "This installer targets Debian-based systems (Raspberry Pi OS, Debian, Ubuntu)."
fi

info "User:     $(whoami)"
info "Home:     $HOME"
info "Target:   $TARGET_DIR"
info "Branch:   $BRANCH"
echo ""

# ── Install git if missing ────────────────────────────────────────────────
if ! command -v git >/dev/null 2>&1; then
    info "Installing git..."
    sudo apt-get update -qq
    sudo apt-get install -y git
    ok "git installed"
else
    ok "git already installed"
fi

# ── Clone or update the repo ──────────────────────────────────────────────
if [ -d "$TARGET_DIR/.git" ]; then
    info "Existing birdash repo detected — updating..."
    git -C "$TARGET_DIR" fetch --quiet origin "$BRANCH"
    git -C "$TARGET_DIR" checkout --quiet "$BRANCH"
    git -C "$TARGET_DIR" pull --quiet --ff-only origin "$BRANCH" || warn "Could not fast-forward (local changes?)"
    ok "Repo updated"
elif [ -e "$TARGET_DIR" ]; then
    fail "$TARGET_DIR exists but is not a git checkout. Remove it and re-run."
else
    info "Cloning $REPO_URL → $TARGET_DIR"
    git clone --quiet --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
    ok "Repo cloned"
fi

# ── Run the installer non-interactively ───────────────────────────────────
cd "$TARGET_DIR"
chmod +x install.sh
echo ""
info "Launching install.sh --yes ..."
echo ""
./install.sh --yes

# ── Anonymous install ping (best-effort, silent) ─────────────────────────
# One-shot anonymous ping: {event, version, hardware, os, country}.
# No PII, no GPS, no UUID. Helps track adoption. Disable in Settings.
_ping_install() {
    local version hardware os_name country
    version=$(grep -o '"version": *"[^"]*"' "$TARGET_DIR/package.json" 2>/dev/null | grep -o '[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*' || echo "unknown")
    hardware=$(cat /proc/device-tree/model 2>/dev/null | tr -d '\0' || echo "unknown")
    os_name=$(grep -oP 'PRETTY_NAME="\K[^"]+' /etc/os-release 2>/dev/null || echo "unknown")
    country=$(curl -s -m 3 https://ipapi.co/country_name/ 2>/dev/null || echo "unknown")
    curl -s -m 5 -X POST "https://ujuaoogpthdlyvyphgpc.supabase.co/rest/v1/pings" \
        -H "apikey: sb_publishable_aM2y1SE0B42oXD05wuGmJQ_FsqmzSHa" \
        -H "Authorization: Bearer sb_publishable_aM2y1SE0B42oXD05wuGmJQ_FsqmzSHa" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=minimal" \
        -d "{\"event\":\"install\",\"version\":\"$version\",\"hardware\":\"$hardware\",\"os\":\"$os_name\",\"country\":\"$country\"}" \
        >/dev/null 2>&1 || true
}
_ping_install &

echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Bootstrap complete${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Dashboard: http://$(hostname -I | awk '{print $1}')/birds/"
echo "             http://$(hostname).local/birds/"
echo ""
