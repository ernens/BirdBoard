'use strict';
/**
 * Worker thread for computing whats-new data off the main event loop.
 *
 * Runs the 10 heavy SQLite queries in an isolated thread so the main
 * thread stays responsive (no 11s event-loop freeze).
 *
 * Communication:
 *   parentPort.postMessage({ type: 'result', data })   — success
 *   parentPort.postMessage({ type: 'error', message })  — failure
 *
 * Receives workerData: { dbPath, birdashDbPath, confPath, rulesPath, lat, lon, minConf }
 */
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

let Database;
try { Database = require('better-sqlite3'); } catch {
  parentPort.postMessage({ type: 'error', message: 'better-sqlite3 not available' });
  process.exit(1);
}

const SunCalc = require('suncalc');

// ── Open own DB connections (worker threads cannot share handles) ────────────
const { dbPath, birdashDbPath, lat, lon, minConf, rulesPath } = workerData;

const db = new Database(dbPath, { readonly: true, fileMustExist: true });
// Apply same tuning as the main process so worker reads benefit from
// the bigger cache + mmap on Pi 4/5 (and stay conservative on Pi 3).
require('./db-pragmas').applyReadPragmas(db);

// Attach birdash.db for the active_detections VIEW
try {
  if (birdashDbPath && fs.existsSync(birdashDbPath)) {
    db.exec(`ATTACH '${birdashDbPath}' AS vdb`);
    db.exec(`CREATE TEMP VIEW IF NOT EXISTS active_detections AS
      SELECT d.* FROM detections d
      WHERE NOT EXISTS (
        SELECT 1 FROM vdb.validations v
        WHERE v.date = d.Date AND v.time = d.Time
          AND v.sci_name = d.Sci_Name AND v.status = 'rejected'
      )`);
  } else {
    db.exec('CREATE TEMP VIEW IF NOT EXISTS active_detections AS SELECT * FROM detections');
  }
} catch {
  db.exec('CREATE TEMP VIEW IF NOT EXISTS active_detections AS SELECT * FROM detections');
}

// ── Read rules file ─────────────────────────────────────────────────────────
let rules = {};
try { rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8')); } catch {}

// ── Compute ─────────────────────────────────────────────────────────────────
try {
  const hasGPS = lat !== 0 || lon !== 0;

  // DB stats
  const dbStats = db.prepare(`
    SELECT COUNT(DISTINCT Date) as total_days,
           MIN(Date) as first_date, MAX(Date) as last_date
    FROM active_detections WHERE Date < DATE('now','localtime')
  `).get();
  const totalDays = dbStats.total_days || 0;

  function buildInsufficientCard(type, level, reason) {
    return { type, level, active: false, insufficientData: true, insufficientDataReason: reason, data: null, link: null };
  }

  // ── A1: out_of_season ──
  let cardOutOfSeason = { type: 'out_of_season', level: 'alert', active: false, insufficientData: false, insufficientDataReason: null, data: null, link: '/birds/review.html' };
  try {
    const oosRules = (rules.rules && rules.rules.out_of_season && rules.rules.out_of_season.species_months) || {};
    const currentMonth = new Date().getMonth() + 1;
    const oosSpecies = Object.entries(oosRules)
      .filter(([, months]) => !months.includes(currentMonth))
      .map(([sci]) => sci);
    if (oosSpecies.length > 0) {
      const placeholders = oosSpecies.map(() => '?').join(',');
      const oosRows = db.prepare(`
        SELECT Com_Name, Sci_Name, Confidence, Time, File_Name
        FROM active_detections
        WHERE Date = DATE('now','localtime')
          AND Sci_Name IN (${placeholders})
          AND Confidence >= ?
        ORDER BY Confidence DESC LIMIT 5
      `).all(...oosSpecies, minConf);
      if (oosRows.length > 0) {
        cardOutOfSeason.active = true;
        cardOutOfSeason.data = {
          species: oosRows.map(r => ({
            commonName: r.Com_Name, sciName: r.Sci_Name,
            confidence: parseFloat(r.Confidence.toFixed(2)),
            detectedAt: r.Time ? r.Time.slice(0, 5) : '',
            audioFile: r.File_Name
          })),
          count: oosRows.length
        };
      }
    }
  } catch(e) { console.error('[whats-new-worker] out_of_season:', e.message); }

  // ── A2: activity_spike ──
  let cardActivitySpike;
  if (totalDays < 7) {
    cardActivitySpike = buildInsufficientCard('activity_spike', 'alert', 'needsWeek');
  } else {
    cardActivitySpike = { type: 'activity_spike', level: 'alert', active: false, insufficientData: false, insufficientDataReason: null, data: null, link: null };
    try {
      const spikeRows = db.prepare(`
        WITH today AS (
          SELECT Com_Name, COUNT(*) as count_today
          FROM active_detections WHERE Date = DATE('now','localtime')
          GROUP BY Com_Name
        ),
        baseline AS (
          SELECT Com_Name, ROUND(AVG(daily_count), 1) as avg_7d
          FROM (
            SELECT Com_Name, Date, COUNT(*) as daily_count
            FROM active_detections
            WHERE Date BETWEEN DATE('now','localtime','-7 days') AND DATE('now','localtime','-1 day')
            GROUP BY Com_Name, Date
          ) GROUP BY Com_Name
        )
        SELECT t.Com_Name, t.count_today, b.avg_7d,
               ROUND(t.count_today * 1.0 / b.avg_7d, 1) as ratio
        FROM today t JOIN baseline b ON t.Com_Name = b.Com_Name
        WHERE b.avg_7d >= 3 AND t.count_today >= b.avg_7d * 2.0
        ORDER BY ratio DESC LIMIT 3
      `).all();
      if (spikeRows.length > 0) {
        cardActivitySpike.active = true;
        cardActivitySpike.data = {
          species: spikeRows.map(r => ({
            commonName: r.Com_Name, countToday: r.count_today,
            avg7d: r.avg_7d, ratio: r.ratio
          }))
        };
      }
    } catch(e) { console.error('[whats-new-worker] activity_spike:', e.message); }
  }

  // ── A3: species_return ──
  let cardSpeciesReturn;
  if (totalDays < 15) {
    cardSpeciesReturn = buildInsufficientCard('species_return', 'alert', 'needsTwoWeeks');
  } else {
    cardSpeciesReturn = { type: 'species_return', level: 'alert', active: false, insufficientData: false, insufficientDataReason: null, data: null, link: null };
    try {
      const returnRows = db.prepare(`
        WITH last AS (
          SELECT Com_Name, MAX(Date) as last_date
          FROM active_detections
          WHERE Date < DATE('now','localtime') AND Date >= DATE('now','localtime', '-365 days')
          GROUP BY Com_Name
        ),
        today AS (
          SELECT DISTINCT Com_Name, Sci_Name
          FROM active_detections
          WHERE Date = DATE('now','localtime')
        )
        SELECT t.Com_Name, t.Sci_Name, l.last_date as last_seen_before,
               CAST(JULIANDAY('now','localtime') - JULIANDAY(l.last_date) AS INTEGER) as absent_days
        FROM today t
        JOIN last l ON t.Com_Name = l.Com_Name
        WHERE CAST(JULIANDAY('now','localtime') - JULIANDAY(l.last_date) AS INTEGER) >= 10
          AND CAST(JULIANDAY('now','localtime') - JULIANDAY(l.last_date) AS INTEGER) < 180
        ORDER BY absent_days DESC LIMIT 3
      `).all();
      if (returnRows.length > 0) {
        cardSpeciesReturn.active = true;
        cardSpeciesReturn.data = {
          species: returnRows.map(r => ({
            commonName: r.Com_Name, sciName: r.Sci_Name,
            absentDays: r.absent_days, lastSeenDate: r.last_seen_before
          }))
        };
      }
    } catch(e) { console.error('[whats-new-worker] species_return:', e.message); }
  }

  const alerts = [cardOutOfSeason, cardActivitySpike, cardSpeciesReturn];

  // ── P1: first_of_year ──
  let cardFirstOfYear = { type: 'first_of_year', level: 'phenology', active: false, insufficientData: false, insufficientDataReason: null, data: null, link: null };
  try {
    const wnYearStart = new Date().getFullYear() + '-01-01';
    const foyRows = db.prepare(`
      WITH today AS (
        SELECT Com_Name, Sci_Name, Confidence,
               MIN(Time) as first_time, File_Name
        FROM active_detections
        WHERE Date = DATE('now','localtime') AND Confidence >= ?
        GROUP BY Com_Name
      ),
      prior AS (
        SELECT DISTINCT Com_Name FROM active_detections
        WHERE Date >= ? AND Date < DATE('now','localtime')
      )
      SELECT t.Com_Name, t.Sci_Name, t.Confidence, t.first_time, t.File_Name
      FROM today t
      LEFT JOIN prior p ON t.Com_Name = p.Com_Name
      WHERE p.Com_Name IS NULL
      ORDER BY t.first_time ASC LIMIT 5
    `).all(wnYearStart, minConf);
    if (foyRows.length > 0) {
      cardFirstOfYear.active = true;
      cardFirstOfYear.data = {
        species: foyRows.map(r => ({
          commonName: r.Com_Name, sciName: r.Sci_Name,
          firstTimeToday: r.first_time ? r.first_time.slice(0, 5) : '',
          confidence: parseFloat(parseFloat(r.Confidence).toFixed(2)),
          audioFile: r.File_Name
        })),
        count: foyRows.length
      };
    }
  } catch(e) { console.error('[whats-new-worker] first_of_year:', e.message); }

  // ── P2: species_streak ──
  let cardSpeciesStreak;
  if (totalDays < 6) {
    cardSpeciesStreak = buildInsufficientCard('species_streak', 'phenology', 'needsWeek');
  } else {
    cardSpeciesStreak = { type: 'species_streak', level: 'phenology', active: false, insufficientData: false, insufficientDataReason: null, data: null, link: null };
    try {
      const streakRows = db.prepare(`
        WITH daily_presence AS (
          SELECT Com_Name, Date as day
          FROM active_detections
          WHERE Date <= DATE('now','localtime')
          GROUP BY Com_Name, Date
        ),
        numbered AS (
          SELECT Com_Name, day,
                 JULIANDAY(DATE('now','localtime')) - JULIANDAY(day) as days_ago,
                 ROW_NUMBER() OVER (PARTITION BY Com_Name ORDER BY day DESC) as rn
          FROM daily_presence
        )
        SELECT Com_Name, COUNT(*) as streak_days
        FROM numbered
        WHERE days_ago = rn - 1
        GROUP BY Com_Name
        HAVING COUNT(*) >= 5
        ORDER BY streak_days DESC LIMIT 3
      `).all();
      if (streakRows.length > 0) {
        cardSpeciesStreak.active = true;
        cardSpeciesStreak.data = {
          species: streakRows.map(r => ({
            commonName: r.Com_Name, streakDays: r.streak_days
          }))
        };
      }
    } catch(e) { console.error('[whats-new-worker] species_streak:', e.message); }
  }

  // ── P3: seasonal_peak ──
  let cardSeasonalPeak;
  if (totalDays < 365) {
    cardSeasonalPeak = buildInsufficientCard('seasonal_peak', 'phenology', 'needsSeason');
  } else {
    cardSeasonalPeak = { type: 'seasonal_peak', level: 'phenology', active: false, insufficientData: false, insufficientDataReason: null, data: null, link: null };
    try {
      const peakRows = db.prepare(`
        WITH current_week AS (
          SELECT Com_Name, COUNT(*) as count_this_week
          FROM active_detections WHERE Date >= DATE('now','localtime','-7 days')
          GROUP BY Com_Name
        ),
        historical_week AS (
          SELECT Com_Name, STRFTIME('%W', Date) as week_num,
                 STRFTIME('%Y', Date) as year, COUNT(*) as count_that_week
          FROM active_detections
          WHERE STRFTIME('%W', Date) = STRFTIME('%W', 'now','localtime')
            AND Date < DATE('now','localtime','-7 days')
          GROUP BY Com_Name, week_num, year
        ),
        max_historical AS (
          SELECT Com_Name, MAX(count_that_week) as max_ever
          FROM historical_week GROUP BY Com_Name
        )
        SELECT c.Com_Name, c.count_this_week, m.max_ever
        FROM current_week c
        JOIN max_historical m ON c.Com_Name = m.Com_Name
        WHERE c.count_this_week >= m.max_ever AND c.count_this_week >= 10
        ORDER BY c.count_this_week DESC LIMIT 3
      `).all();
      if (peakRows.length > 0) {
        cardSeasonalPeak.active = true;
        cardSeasonalPeak.data = {
          species: peakRows.map(r => ({
            commonName: r.Com_Name, countThisWeek: r.count_this_week,
            maxEver: r.max_ever
          }))
        };
      }
    } catch(e) { console.error('[whats-new-worker] seasonal_peak:', e.message); }
  }

  const phenology = [cardFirstOfYear, cardSpeciesStreak, cardSeasonalPeak];

  // ── Editorial primary picker ──────────────────────────────────────────
  // Score every active card; the highest score becomes the day's headline.
  // If nothing is striking enough, return a sober "calm" pseudo-card so
  // the frontend always has something to render in the primary slot —
  // user-validated rule: a quiet day stays a quiet day, never simulated.
  function _scoreCard(c) {
    if (!c || !c.active || c.insufficientData) return 0;
    const data = c.data || {};
    const sp0 = (data.species || [])[0] || {};
    switch (c.type) {
      case 'species_return': {
        const days = sp0.absentDays || 0;
        if (days >= 60) return 110;
        if (days >= 30) return 100;
        return 80;
      }
      case 'out_of_season':
        // out_of_season = "an out-of-range species was just detected".
        // Always strong because it's an anomaly worth investigation.
        return 95;
      case 'activity_spike': {
        const r = sp0.ratio || 0;
        if (r >= 5) return 90;
        if (r >= 3) return 75;
        return 60;
      }
      case 'first_of_year':
        return 78;
      case 'species_streak': {
        const d = sp0.streakDays || 0;
        if (d >= 10) return 70;
        if (d >= 7)  return 65;
        return 50;
      }
      case 'seasonal_peak':
        return 55;
      default:
        return 0;
    }
  }
  let primary = null;
  let bestScore = 0;
  for (const c of [...alerts, ...phenology]) {
    const s = _scoreCard(c);
    if (s > bestScore) { bestScore = s; primary = c; }
  }
  if (!primary) {
    // Calm-day fallback. Sober formulation — no simulated drama.
    primary = {
      type: 'calm', level: 'calm', active: false, insufficientData: false,
      insufficientDataReason: null, data: null, link: null,
    };
  }

  // ── C1: dawn_chorus ──
  let cardDawnChorus = { type: 'dawn_chorus', level: 'context', active: false, insufficientData: false, insufficientDataReason: null, data: null, link: null };
  if (!hasGPS) {
    cardDawnChorus.insufficientData = true;
    cardDawnChorus.insufficientDataReason = 'needsGPS';
  } else {
    try {
      const times = SunCalc.getTimes(new Date(), lat, lon);
      const sunrise = times.sunrise;
      const dawnEnd = new Date(sunrise.getTime() + 60 * 60 * 1000);
      const sunriseTime = sunrise.toTimeString().slice(0, 5) + ':00';
      const dawnEndTime = dawnEnd.toTimeString().slice(0, 5) + ':00';
      const chorusRow = db.prepare(`
        SELECT COUNT(DISTINCT Com_Name) as species_count,
               COUNT(*) as detection_count
        FROM active_detections
        WHERE Date = DATE('now','localtime')
          AND Time BETWEEN ? AND ?
      `).get(sunriseTime, dawnEndTime);
      const sunset = times.sunset;
      cardDawnChorus.active = true;
      cardDawnChorus.data = {
        speciesCount: chorusRow.species_count || 0,
        detectionCount: chorusRow.detection_count || 0,
        sunriseTime: sunrise.toTimeString().slice(0, 5),
        sunsetTime: sunset.toTimeString().slice(0, 5),
        windowEnd: dawnEnd.toTimeString().slice(0, 5)
      };
    } catch(e) { console.error('[whats-new-worker] dawn_chorus:', e.message); }
  }

  // ── C2: acoustic_quality ──
  let cardAcousticQuality = { type: 'acoustic_quality', level: 'context', active: false, insufficientData: false, insufficientDataReason: null, data: null, link: null };
  try {
    const aqRow = db.prepare(`
      SELECT COUNT(*) as total_detections,
             SUM(CASE WHEN Confidence >= COALESCE(NULLIF(Cutoff,0),0.15) + (1.0 - COALESCE(NULLIF(Cutoff,0),0.15)) * 0.5 THEN 1 ELSE 0 END) as strong,
             SUM(CASE WHEN Confidence >= COALESCE(NULLIF(Cutoff,0),0.15) + (1.0 - COALESCE(NULLIF(Cutoff,0),0.15)) * 0.33 THEN 1 ELSE 0 END) as acceptable
      FROM active_detections WHERE Date = DATE('now','localtime')
    `).get();
    const total = aqRow.total_detections || 0;
    if (total < 10) {
      cardAcousticQuality.insufficientData = true;
      cardAcousticQuality.insufficientDataReason = 'tooEarly';
    } else {
      const strong = aqRow.strong || 0;
      const acceptable = aqRow.acceptable || 0;
      const strongRate = strong / total;
      const acceptableRate = acceptable / total;
      let qualityLevel = 'good';
      if (acceptableRate < 0.4) qualityLevel = 'poor';
      else if (strongRate < 0.3) qualityLevel = 'moderate';
      cardAcousticQuality.active = true;
      cardAcousticQuality.data = {
        totalDetections: total, strong, acceptable,
        acceptanceRate: parseFloat(acceptableRate.toFixed(3)),
        strongRate: parseFloat(strongRate.toFixed(3)),
        qualityLevel
      };
    }
  } catch(e) { console.error('[whats-new-worker] acoustic_quality:', e.message); }

  // ── C3: species_richness ──
  let cardSpeciesRichness = { type: 'species_richness', level: 'context', active: false, insufficientData: false, insufficientDataReason: null, data: null, link: null };
  if (totalDays < 28) {
    cardSpeciesRichness.insufficientData = true;
    cardSpeciesRichness.insufficientDataReason = 'needsMonth';
  } else {
    try {
      const richRow = db.prepare(`
        WITH today_richness AS (
          SELECT COUNT(DISTINCT Com_Name) as today_count
          FROM active_detections WHERE Date = DATE('now','localtime')
        ),
        historical_avg AS (
          SELECT ROUND(AVG(species_count), 1) as avg_count
          FROM (
            SELECT Date, COUNT(DISTINCT Com_Name) as species_count
            FROM active_detections
            WHERE STRFTIME('%w', Date) = STRFTIME('%w', 'now','localtime')
              AND Date BETWEEN DATE('now','localtime','-28 days') AND DATE('now','localtime','-1 day')
            GROUP BY Date
          )
        )
        SELECT t.today_count, h.avg_count,
               CASE WHEN h.avg_count > 0
                 THEN ROUND((t.today_count - h.avg_count) * 100.0 / h.avg_count, 0)
                 ELSE 0 END as delta_pct
        FROM today_richness t, historical_avg h
      `).get();
      const todayCount = richRow.today_count || 0;
      const avgCount = richRow.avg_count || 0;
      const deltaPct = richRow.delta_pct || 0;
      let trend = 'normal';
      if (deltaPct > 15) trend = 'above';
      else if (deltaPct < -15) trend = 'below';
      cardSpeciesRichness.active = true;
      cardSpeciesRichness.data = {
        todayCount, historicalAvg: avgCount, deltaPct, trend
      };
    } catch(e) { console.error('[whats-new-worker] species_richness:', e.message); }
  }

  // ── C4: moon_phase ──
  let cardMoonPhase = { type: 'moon_phase', level: 'context', active: true, insufficientData: false, insufficientDataReason: null, data: null, link: null };
  try {
    const moonIllum = SunCalc.getMoonIllumination(new Date());
    const phase = moonIllum.phase;
    const illumination = parseFloat(moonIllum.fraction.toFixed(2));
    const MOON = [
      { max: 0.0625, name: 'new_moon' },   { max: 0.1875, name: 'waxing_crescent' },
      { max: 0.3125, name: 'first_quarter' }, { max: 0.4375, name: 'waxing_gibbous' },
      { max: 0.5625, name: 'full_moon' },   { max: 0.6875, name: 'waning_gibbous' },
      { max: 0.8125, name: 'last_quarter' }, { max: 0.9375, name: 'waning_crescent' },
      { max: 1.01,   name: 'new_moon' },
    ];
    const m = MOON.find(x => phase < x.max) || MOON[0];
    let migrationContext = 'limited';
    if (illumination > 0.7) migrationContext = 'favorable';
    else if (illumination >= 0.3) migrationContext = 'moderate';
    cardMoonPhase.data = {
      phase: parseFloat(phase.toFixed(2)),
      phaseName: m.name, illumination, migrationContext
    };
  } catch(e) { console.error('[whats-new-worker] moon_phase:', e.message); }

  // ── C5: species_of_month ──
  // Headline of the current calendar month. Two candidate kinds:
  //   1) "newcomer" — a species whose first_date falls in this month and that
  //      already has ≥ NEWCOMER_MIN_COUNT detections this month.
  //   2) "comeback" — a species absent or scarce for several months and now
  //      back this month, with the highest current/avg-prev ratio.
  // Newcomer wins when both qualify (more interesting story).
  // Card stays inactive when neither qualifies — no card rather than a stale one.
  let cardSpeciesOfMonth = { type: 'species_of_month', level: 'context', active: false, insufficientData: false, insufficientDataReason: null, data: null, link: null };
  const NEWCOMER_MIN_COUNT = 5;
  const COMEBACK_MIN_COUNT = 5;
  const COMEBACK_MIN_RATIO = 3.0;   // current month must be ≥3× the past avg
  const COMEBACK_LOOKBACK_MONTHS = 6;
  try {
    const now = new Date();
    const ym = now.toISOString().slice(0, 7);
    const lookbackDate = new Date(now.getFullYear(), now.getMonth() - COMEBACK_LOOKBACK_MONTHS, 1);
    const lookbackYm = lookbackDate.toISOString().slice(0, 7);

    // 1. Newcomer
    const newcomer = db.prepare(`
      SELECT s.sci_name, s.com_name, s.first_date, ms.count_07
      FROM species_stats s
      JOIN monthly_stats ms ON ms.sci_name = s.sci_name AND ms.year_month = ?
      WHERE strftime('%Y-%m', s.first_date) = ?
        AND ms.count_07 >= ?
      ORDER BY ms.count_07 DESC
      LIMIT 1
    `).get(ym, ym, NEWCOMER_MIN_COUNT);

    if (newcomer) {
      cardSpeciesOfMonth.active = true;
      cardSpeciesOfMonth.data = {
        kind: 'newcomer',
        sci_name: newcomer.sci_name,
        com_name: newcomer.com_name,
        first_date: newcomer.first_date,
        count: newcomer.count_07,
      };
    } else {
      // 2. Comeback — biggest current/avg-prev ratio
      const comeback = db.prepare(`
        WITH curr AS (
          SELECT sci_name, com_name, count_07
          FROM monthly_stats
          WHERE year_month = ? AND count_07 >= ?
        ),
        prev AS (
          SELECT sci_name, AVG(count_07) AS avg_prev, MAX(year_month) AS last_month
          FROM monthly_stats
          WHERE year_month >= ? AND year_month < ?
          GROUP BY sci_name
        )
        SELECT c.sci_name, c.com_name, c.count_07,
               p.avg_prev, p.last_month,
               (c.count_07 * 1.0 / p.avg_prev) AS ratio
        FROM curr c
        JOIN prev p USING (sci_name)
        WHERE p.avg_prev > 0
        ORDER BY ratio DESC
        LIMIT 1
      `).get(ym, COMEBACK_MIN_COUNT, lookbackYm, ym);

      if (comeback && comeback.ratio >= COMEBACK_MIN_RATIO) {
        cardSpeciesOfMonth.active = true;
        cardSpeciesOfMonth.data = {
          kind: 'comeback',
          sci_name: comeback.sci_name,
          com_name: comeback.com_name,
          count: comeback.count_07,
          prev_avg: parseFloat(comeback.avg_prev.toFixed(1)),
          ratio: parseFloat(comeback.ratio.toFixed(1)),
          last_seen_month: comeback.last_month,
        };
      }
    }
  } catch(e) { console.error('[whats-new-worker] species_of_month:', e.message); }

  const result = {
    generatedAt: new Date().toISOString(),
    primary,
    alerts,
    phenology,
    context: {
      dawn_chorus: cardDawnChorus,
      acoustic_quality: cardAcousticQuality,
      species_richness: cardSpeciesRichness,
      moon_phase: cardMoonPhase,
      species_of_month: cardSpeciesOfMonth,
    }
  };

  db.close();
  parentPort.postMessage({ type: 'result', data: result });
} catch(e) {
  try { db.close(); } catch {}
  parentPort.postMessage({ type: 'error', message: e.message });
}
