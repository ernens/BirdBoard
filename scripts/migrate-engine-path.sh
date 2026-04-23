#!/bin/bash
# migrate-engine-path.sh
#
# One-shot migration for legacy installs running birdengine.service from
# ~/birdengine/engine.py instead of the repo's ~/birdash/engine/engine.py.
#
# Why migrate: the engine code lives in the repo. Sync-on-update has bitten
# us twice (1.44.0 split into modules → only engine.py was synced → broken).
# Pointing the service straight at the repo eliminates the duplication.
#
# What this changes:
#   ExecStart=...birdengine/engine.py
#     →
#   ExecStart=...birdash/engine/engine.py /home/bjorn/birdengine/config.toml
#
# What this PRESERVES:
#   - WorkingDirectory=~/birdengine    (audio/, processed/ paths still resolve)
#   - venv at ~/birdengine/venv        (no need to recreate)
#   - config.toml at ~/birdengine/     (user tuning untouched)
#
# Idempotent: running twice is a no-op. Safe to run repeatedly.

set -e

UNIT=/etc/systemd/system/birdengine.service
LEGACY_EXEC="${HOME}/birdengine/engine.py"
NEW_EXEC="${HOME}/birdash/engine/engine.py"
CONFIG_PATH="${HOME}/birdengine/config.toml"

if [ ! -f "$UNIT" ]; then
    echo "✗ $UNIT not found — birdengine not installed?"
    exit 1
fi

if ! grep -q "ExecStart=.*${LEGACY_EXEC}" "$UNIT"; then
    if grep -q "ExecStart=.*${NEW_EXEC}" "$UNIT"; then
        echo "✓ Already migrated — ExecStart points at $NEW_EXEC"
        exit 0
    fi
    echo "✗ Unit doesn't match expected pattern. Inspect it manually:"
    grep ExecStart "$UNIT"
    exit 1
fi

if [ ! -f "$NEW_EXEC" ]; then
    echo "✗ $NEW_EXEC not found — repo is incomplete?"
    exit 1
fi

if [ ! -f "$CONFIG_PATH" ]; then
    echo "✗ $CONFIG_PATH not found — engine has no config to read"
    exit 1
fi

echo "Migrating birdengine.service to use the repo as the engine source of truth"
echo "  before: $(grep ExecStart "$UNIT")"

# Replace just the script path, leave the venv and config args intact.
# Quote the config path so paths with spaces don't break.
sudo sed -i "s|ExecStart=\(.*\)${LEGACY_EXEC}.*|ExecStart=\1${NEW_EXEC} ${CONFIG_PATH}|" "$UNIT"

echo "  after:  $(grep ExecStart "$UNIT")"

sudo systemctl daemon-reload
sudo systemctl restart birdengine

# Wait briefly and verify
sleep 3
if systemctl is-active --quiet birdengine; then
    echo "✓ birdengine restarted successfully"
else
    echo "✗ birdengine failed to start. Logs:"
    sudo journalctl -u birdengine -n 20 --no-pager
    exit 1
fi
