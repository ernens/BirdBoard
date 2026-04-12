#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 003-normalize-model-names
#
# The engine renamed Perch model variants between March and April 2026:
#   Perch_v2      → perch_v2_original   (FP32 variant)
#   Perch_v2_int8 → perch_v2_dynint8    (INT8 variant)
#
# Detections in the DB kept the old names, so the model comparison page
# shows them as separate models instead of grouping them. This migration
# updates the Model column in-place.
#
# Idempotent: checks if old names still exist before running.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="003-normalize-model-names"
REPO_DIR="${BIRDASH_DIR:-$HOME/birdash}"
# Prefer the env var (set in birdash.service for production), then the
# BirdNET-Pi legacy path, then the fresh-install path.
DB="${BIRDASH_DB:-}"
if [ -z "$DB" ] || [ ! -f "$DB" ]; then DB="$HOME/BirdNET-Pi/scripts/birds.db"; fi
if [ ! -f "$DB" ]; then DB="$REPO_DIR/data/birds.db"; fi
if [ ! -f "$DB" ]; then
    echo "[migrate $NAME] no birds.db found — skipping"
    exit 0
fi

# Check if old names still exist
OLD_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM detections WHERE Model IN ('Perch_v2','Perch_v2_int8')" 2>/dev/null || echo "0")

if [ "$OLD_COUNT" = "0" ]; then
    echo "[migrate $NAME] already applied"
    exit 0
fi

echo "[migrate $NAME] normalizing $OLD_COUNT rows..."

sqlite3 "$DB" "
UPDATE detections SET Model = 'perch_v2_original' WHERE Model = 'Perch_v2';
UPDATE detections SET Model = 'perch_v2_dynint8'  WHERE Model = 'Perch_v2_int8';
"

NEW_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM detections WHERE Model IN ('Perch_v2','Perch_v2_int8')" 2>/dev/null || echo "0")
echo "[migrate $NAME] done — $OLD_COUNT rows normalized, $NEW_COUNT remaining"
