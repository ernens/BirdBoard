#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════
# 004-daily-stats-filtered-count
#
# The daily_stats table stored a single `count` column counting ALL
# detections per species-day (with a 0.5 noise floor). Downstream
# queries filtered by `avg_conf >= 0.7`, which is semantically wrong:
# avg_conf is the AVERAGE over the day, not a per-detection threshold.
# This produced a 21% inflation vs raw per-detection filtering.
#
# Fix: add a `count_07` column = number of detections where Confidence
# >= 0.7 (the system default). Downstream queries use count_07 for
# totals instead of filtering by avg_conf. The existing `count` column
# remains for backward compat and for users who want unfiltered counts.
#
# Same treatment for monthly_stats and species_stats.
#
# After adding the column, triggers a full rebuild of aggregates on
# the next birdash restart (by touching a sentinel file that the
# rebuild logic checks).
#
# Idempotent: checks if count_07 column already exists.
# ══════════════════════════════════════════════════════════════════════════

set -e

NAME="004-daily-stats-filtered-count"
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

# Check if column already exists
HAS_COL=$(sqlite3 "$DB" "SELECT COUNT(*) FROM pragma_table_info('daily_stats') WHERE name='count_07'" 2>/dev/null || echo "0")
if [ "$HAS_COL" != "0" ]; then
    echo "[migrate $NAME] already applied"
    exit 0
fi

echo "[migrate $NAME] adding count_07 columns to aggregate tables..."

sqlite3 "$DB" "
ALTER TABLE daily_stats ADD COLUMN count_07 INTEGER DEFAULT 0;
ALTER TABLE monthly_stats ADD COLUMN count_07 INTEGER DEFAULT 0;
ALTER TABLE species_stats ADD COLUMN count_07 INTEGER DEFAULT 0;
"

echo "[migrate $NAME] columns added — aggregates will be rebuilt on next birdash restart"
# Touch sentinel so the next rebuild populates the new column
touch "$REPO_DIR/config/.rebuild-aggregates"

echo "[migrate $NAME] done"
