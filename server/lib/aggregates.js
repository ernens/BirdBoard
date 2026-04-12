'use strict';
/**
 * Pre-aggregated statistics tables.
 * Replaces expensive COUNT/GROUP BY on 1M+ detections with materialized views.
 *
 * Tables: daily_stats, monthly_stats, species_stats
 * Strategy: full rebuild on startup + incremental refresh every 5 min for today.
 */

// Noise floor filter (Confidence >= 0.5) excludes obvious junk so that
// avg_conf in the aggregate is meaningful and downstream avg_conf >= ? filters
// work correctly without inflating counts by ~21%.
const DAILY_REBUILD_SQL = `
  INSERT OR REPLACE INTO daily_stats (date, sci_name, com_name, count, avg_conf, max_conf, first_time, last_time)
  SELECT Date, Sci_Name, Com_Name,
         COUNT(*) as count,
         ROUND(AVG(Confidence), 4) as avg_conf,
         ROUND(MAX(Confidence), 4) as max_conf,
         MIN(Time) as first_time,
         MAX(Time) as last_time
  FROM detections
  WHERE Confidence >= 0.5
  GROUP BY Date, Sci_Name
`;

// Same noise floor as daily — keeps monthly aggregates consistent
const MONTHLY_REBUILD_SQL = `
  INSERT OR REPLACE INTO monthly_stats (year_month, sci_name, com_name, count, avg_conf, day_count)
  SELECT SUBSTR(Date,1,7), Sci_Name, MAX(Com_Name),
         COUNT(*) as count,
         ROUND(AVG(Confidence), 4) as avg_conf,
         COUNT(DISTINCT Date) as day_count
  FROM detections
  WHERE Confidence >= 0.5
  GROUP BY SUBSTR(Date,1,7), Sci_Name
`;

// Same noise floor as daily/monthly — keeps species aggregates consistent
const SPECIES_REBUILD_SQL = `
  INSERT OR REPLACE INTO species_stats (sci_name, com_name, total_count, first_date, last_date, avg_conf, day_count)
  SELECT Sci_Name, MAX(Com_Name),
         COUNT(*) as total_count,
         MIN(Date) as first_date,
         MAX(Date) as last_date,
         ROUND(AVG(Confidence), 4) as avg_conf,
         COUNT(DISTINCT Date) as day_count
  FROM detections
  WHERE Confidence >= 0.5
  GROUP BY Sci_Name
`;

let _lastRefreshDate = '';
let _refreshTimer = null;

/**
 * Create aggregate tables if they don't exist.
 */
function createTables(dbWrite) {
  dbWrite.exec(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      date        TEXT NOT NULL,
      sci_name    TEXT NOT NULL,
      com_name    TEXT NOT NULL,
      count       INTEGER DEFAULT 0,
      avg_conf    REAL DEFAULT 0,
      max_conf    REAL DEFAULT 0,
      first_time  TEXT,
      last_time   TEXT,
      PRIMARY KEY (date, sci_name)
    );
    CREATE INDEX IF NOT EXISTS idx_ds_date ON daily_stats(date);
    CREATE INDEX IF NOT EXISTS idx_ds_sci ON daily_stats(sci_name);

    CREATE TABLE IF NOT EXISTS monthly_stats (
      year_month  TEXT NOT NULL,
      sci_name    TEXT NOT NULL,
      com_name    TEXT NOT NULL,
      count       INTEGER DEFAULT 0,
      avg_conf    REAL DEFAULT 0,
      day_count   INTEGER DEFAULT 0,
      PRIMARY KEY (year_month, sci_name)
    );

    CREATE TABLE IF NOT EXISTS species_stats (
      sci_name     TEXT PRIMARY KEY,
      com_name     TEXT NOT NULL,
      total_count  INTEGER DEFAULT 0,
      first_date   TEXT,
      last_date    TEXT,
      avg_conf     REAL DEFAULT 0,
      day_count    INTEGER DEFAULT 0
    );
  `);
}

/**
 * Full rebuild of all aggregate tables. Takes a few seconds on 1M+ rows.
 */
function rebuildAll(dbWrite) {
  const t0 = Date.now();
  const tx = dbWrite.transaction(() => {
    dbWrite.exec('DELETE FROM daily_stats');
    dbWrite.exec('DELETE FROM monthly_stats');
    dbWrite.exec('DELETE FROM species_stats');
    dbWrite.exec(DAILY_REBUILD_SQL);
    dbWrite.exec(MONTHLY_REBUILD_SQL);
    dbWrite.exec(SPECIES_REBUILD_SQL);
  });
  tx();
  const elapsed = Date.now() - t0;
  const daily = dbWrite.prepare('SELECT COUNT(*) as n FROM daily_stats').get().n;
  const monthly = dbWrite.prepare('SELECT COUNT(*) as n FROM monthly_stats').get().n;
  const species = dbWrite.prepare('SELECT COUNT(*) as n FROM species_stats').get().n;
  console.log(`[BIRDASH] Aggregates rebuilt in ${elapsed}ms — daily:${daily} monthly:${monthly} species:${species}`);
  return { daily, monthly, species, elapsed };
}

/**
 * Incremental refresh for today (and current month / affected species).
 * Fast — only recomputes today's data.
 */
function refreshToday(dbWrite, dateStr) {
  if (!dateStr) {
    const now = new Date();
    dateStr = now.toISOString().split('T')[0];
  }
  const ym = dateStr.substring(0, 7);

  const tx = dbWrite.transaction(() => {
    // Refresh today's daily_stats
    dbWrite.prepare('DELETE FROM daily_stats WHERE date = ?').run(dateStr);
    dbWrite.prepare(`
      INSERT INTO daily_stats (date, sci_name, com_name, count, avg_conf, max_conf, first_time, last_time)
      SELECT Date, Sci_Name, Com_Name,
             COUNT(*), ROUND(AVG(Confidence),4), ROUND(MAX(Confidence),4),
             MIN(Time), MAX(Time)
      FROM detections WHERE Date = ? AND Confidence >= 0.5
      GROUP BY Sci_Name
    `).run(dateStr);

    // Refresh current month's monthly_stats
    dbWrite.prepare('DELETE FROM monthly_stats WHERE year_month = ?').run(ym);
    dbWrite.prepare(`
      INSERT INTO monthly_stats (year_month, sci_name, com_name, count, avg_conf, day_count)
      SELECT SUBSTR(Date,1,7), Sci_Name, MAX(Com_Name),
             COUNT(*), ROUND(AVG(Confidence),4), COUNT(DISTINCT Date)
      FROM detections WHERE SUBSTR(Date,1,7) = ? AND Confidence >= 0.5
      GROUP BY Sci_Name
    `).run(ym);

    // Refresh species_stats for species seen today
    const todaySpecies = dbWrite.prepare(
      'SELECT DISTINCT Sci_Name FROM detections WHERE Date = ? AND Confidence >= 0.5'
    ).all(dateStr);
    const spUpdate = dbWrite.prepare(`
      INSERT OR REPLACE INTO species_stats (sci_name, com_name, total_count, first_date, last_date, avg_conf, day_count)
      SELECT Sci_Name, MAX(Com_Name), COUNT(*), MIN(Date), MAX(Date),
             ROUND(AVG(Confidence),4), COUNT(DISTINCT Date)
      FROM detections WHERE Sci_Name = ? AND Confidence >= 0.5
      GROUP BY Sci_Name
    `);
    for (const { Sci_Name } of todaySpecies) {
      spUpdate.run(Sci_Name);
    }
  });
  tx();
  _lastRefreshDate = dateStr;
}

/**
 * Start the periodic refresh timer (every 5 minutes).
 */
function startPeriodicRefresh(dbWrite, intervalMs = 5 * 60 * 1000) {
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(() => {
    try { refreshToday(dbWrite); }
    catch (e) { console.error('[BIRDASH] Aggregate refresh error:', e.message); }
  }, intervalMs);
  // Also do a midnight full rebuild check
  setInterval(() => {
    const today = new Date().toISOString().split('T')[0];
    if (_lastRefreshDate && _lastRefreshDate !== today) {
      console.log('[BIRDASH] New day detected, full aggregate rebuild');
      try { rebuildAll(dbWrite); } catch (e) { console.error('[BIRDASH] Rebuild error:', e.message); }
    }
  }, 60 * 60 * 1000); // Check every hour
}

function stopPeriodicRefresh() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

module.exports = { createTables, rebuildAll, refreshToday, startPeriodicRefresh, stopPeriodicRefresh };
