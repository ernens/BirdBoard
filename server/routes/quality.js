'use strict';
/**
 * Quality routes — backs the "Detection Quality" page (Phase A).
 *
 * Phase A: every number here is computed from `detections` + `validations`
 * after-the-fact. The engine is not yet instrumented; counters that
 * REQUIRE engine instrumentation (cross-confirm rejections, privacy/dog
 * drops, real throttle drops) are absent — the UI shows a "Counter not
 * yet wired" placeholder for those. Phase B adds a `quality_events`
 * table + engine emit; the response shape stays compatible so the page
 * doesn't change.
 *
 * Honest labelling: anything inferred is tagged in the response with a
 * `source` field set to "observed" | "inferred". Frontend uses this to
 * show "(observed)" / "(inferred)" suffixes — never as "measured by
 * engine" until Phase B replaces those values.
 */

function handle(req, res, pathname, ctx) {
  const { db, birdashDb, parseBirdnetConf } = ctx;

  if (req.method !== 'GET' || pathname !== '/api/quality') return false;

  const url = new URL(req.url, 'http://x');
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '30')));
  const minVolume = Math.max(1, parseInt(url.searchParams.get('min_volume') || '20'));

  (async () => {
    try {
      const result = {
        days,
        minVolume,
        review: await reviewOutcomes(db, birdashDb, days),
        agreement: await modelAgreement(db, days, minVolume),
        prefilter: prefilterFromEvents(db, days),
        throttle: throttleEffect(db, parseBirdnetConf),
        throttle_measured: throttleMeasured(db, days),
        timeline: dailyTimeline(db, days),
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error('[quality]', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  })();
  return true;
}

// ── Review outcomes ─────────────────────────────────────────────────────────
// Only counts ACTIVE detections (excludes trashed). Validation states come
// from birdash.db `validations` table; rows with no validation row are
// treated as "unreviewed".
async function reviewOutcomes(db, birdashDb, days) {
  const fromDate = isoDateOffset(-days);
  const total = db.prepare(
    'SELECT COUNT(*) AS n FROM detections WHERE Date >= ?'
  ).get(fromDate).n;

  // birdash.db is on a separate connection. Fetch validation states by
  // (date, time, com_name) keys — pulling all of them is fine: the
  // validations table is much smaller than detections.
  const valRows = birdashDb.prepare(
    'SELECT status FROM validations WHERE date >= ?'
  ).all(fromDate);

  const counts = { confirmed: 0, doubtful: 0, rejected: 0 };
  for (const v of valRows) {
    if (v.status in counts) counts[v.status]++;
  }
  const reviewed = counts.confirmed + counts.doubtful + counts.rejected;
  return {
    source: 'observed',
    total,
    confirmed: counts.confirmed,
    doubtful: counts.doubtful,
    rejected: counts.rejected,
    unreviewed: Math.max(0, total - reviewed),
  };
}

// ── Model agreement (observed proxy) ───────────────────────────────────────
// For each species, count Perch detections that have at least one BirdNET
// detection of the same sci_name within ±3 s on the same day. This is a
// proxy: it doesn't rerun the engine's actual cross-confirm decision (that
// looks at chunk overlap + raw scores + per-model thresholds), it just
// observes what made it to the DB. Useful as a directional health signal,
// not as a verdict on the cross-confirm rule itself.
//
// Volume guard: minVolume filters out species with too few Perch hits, so
// "Bernache du Canada at 38% on 7 hits" doesn't dominate the list.
async function modelAgreement(db, days, minVolume) {
  const fromDate = isoDateOffset(-days);
  const rows = db.prepare(`
    SELECT Date, Sci_Name, Com_Name, Time, Model
    FROM detections
    WHERE Date >= ?
      AND (Model LIKE 'perch%' OR Model NOT LIKE 'perch%')
  `).all(fromDate);

  // Group by (date, sci_name, time-bin-3s); each bin has {birdnet, perch}.
  // Then per species: agreed_bins = bins with both / total_bins-with-perch.
  const bins = new Map();   // key = date|sci|bin → { birdnet, perch, com }
  for (const r of rows) {
    const t = r.Time || '00:00:00';
    const seconds = (parseInt(t.slice(0,2)) || 0) * 3600
                  + (parseInt(t.slice(3,5)) || 0) * 60
                  + (parseInt(t.slice(6,8)) || 0);
    const bin = Math.floor(seconds / 3);
    const key = `${r.Date}|${r.Sci_Name}|${bin}`;
    if (!bins.has(key)) bins.set(key, { com: r.Com_Name, birdnet: false, perch: false });
    const e = bins.get(key);
    if (String(r.Model || '').toLowerCase().startsWith('perch')) e.perch = true;
    else e.birdnet = true;
  }

  // Per-species rollup
  const sp = new Map();   // sci → { com, perch, agreed }
  for (const [key, v] of bins) {
    if (!v.perch) continue;  // we only care about Perch coverage
    const sci = key.split('|')[1];
    if (!sp.has(sci)) sp.set(sci, { com: v.com, perch: 0, agreed: 0 });
    const s = sp.get(sci);
    s.perch++;
    if (v.birdnet) s.agreed++;
  }

  const list = [];
  for (const [sci, v] of sp) {
    if (v.perch < minVolume) continue;
    list.push({
      sci_name: sci,
      com_name: v.com,
      perch_count: v.perch,
      agreed_count: v.agreed,
      agreement_pct: v.perch ? Math.round((v.agreed / v.perch) * 100) : 0,
    });
  }
  list.sort((a, b) => b.perch_count - a.perch_count);
  return {
    source: 'observed',
    bin_seconds: 3,
    min_volume: minVolume,
    species: list.slice(0, 25),
  };
}

// ── Pre-filter impact (Phase B: from quality_events) ──────────────────────
// Reads the engine-emitted hourly counters. If the table is empty (engine
// not yet upgraded, or no events in the period), falls back to the
// "not instrumented" placeholder so the UI behaves identically — same
// shape, just a different `source` badge.
//
// `cross_confirm_rejected` stays null even in Phase B: the cross-confirm
// rule was added to docs/UI/config in v1.38.0 but never wired into the
// engine inference loop. The card carries an explicit note so the user
// knows the gap. See docs/QUALITY_METRICS.md "Out of scope" section.
function prefilterFromEvents(db, days) {
  // Check the table exists first — old engine deployments won't have it.
  const tableExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='quality_events'"
  ).get();
  if (!tableExists) {
    return {
      source: 'not_instrumented',
      privacy_dropped: null, dog_dropped: null, dog_cooldown_skipped: null,
      cross_confirm_rejected: null, files_processed: null,
      note_key: 'quality_prefilter_note_no_table',
    };
  }
  const fromDate = isoDateOffset(-days);
  const row = db.prepare(`
    SELECT
      SUM(privacy_dropped)        AS privacy_dropped,
      SUM(dog_dropped)            AS dog_dropped,
      SUM(dog_cooldown_skipped)   AS dog_cooldown_skipped,
      SUM(throttle_dropped)       AS throttle_dropped,
      SUM(files_processed)        AS files_processed,
      SUM(cross_confirm_rejected) AS cross_confirm_rejected
    FROM quality_events WHERE Date >= ?
  `).get(fromDate);
  const total = (row.files_processed || 0) + (row.privacy_dropped || 0) + (row.dog_dropped || 0);
  if (total === 0) {
    return {
      source: 'not_instrumented',
      privacy_dropped: null, dog_dropped: null, dog_cooldown_skipped: null,
      cross_confirm_rejected: null, files_processed: null,
      note_key: 'quality_prefilter_note_no_events',
    };
  }
  return {
    source: 'measured',
    privacy_dropped:        row.privacy_dropped || 0,
    dog_dropped:            row.dog_dropped || 0,
    dog_cooldown_skipped:   row.dog_cooldown_skipped || 0,
    throttle_dropped:       row.throttle_dropped || 0,
    files_processed:        row.files_processed || 0,
    cross_confirm_rejected: null,  // not implemented in engine — see spec
    cross_confirm_note_key: 'quality_cross_confirm_note',
  };
}

// Engine-measured throttle drops, per period (Phase B).
function throttleMeasured(db, days) {
  const tableExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='quality_events'"
  ).get();
  if (!tableExists) return { source: 'not_instrumented', dropped: null };
  const fromDate = isoDateOffset(-days);
  const row = db.prepare(
    'SELECT SUM(throttle_dropped) AS n FROM quality_events WHERE Date >= ?'
  ).get(fromDate);
  return { source: 'measured', dropped: row.n || 0 };
}

// ── Throttle effect (inferred) ─────────────────────────────────────────────
// Compares average detections/day in the 30 days BEFORE the throttle was
// activated vs after, restricted to the most-noisy species (the ones the
// throttle is supposed to dampen). Without an activation timestamp, we
// fall back to "throttle currently off — no effect to measure".
function throttleEffect(db, parseBirdnetConf) {
  // Read birdnet.conf SYNCHRONOUSLY via the cached path. parseBirdnetConf
  // is async (cache TTL), but this endpoint isn't latency-critical and
  // the cache hit makes it instant.
  // (Falls back gracefully if the cache miss races — we just skip the
  //  card and return 'not_enabled' for now.)
  let enabled = false;
  try {
    // Best-effort: peek at the sync file read result
    const fs = require('fs');
    const conf = fs.readFileSync('/etc/birdnet/birdnet.conf', 'utf8');
    const m = conf.match(/^NOISY_THROTTLE_ENABLED=(.+)/m);
    enabled = m ? m[1].trim().replace(/['"]/g, '') === '1' : false;
  } catch (_) { /* no birdnet.conf — leave disabled */ }

  if (!enabled) {
    return {
      source: 'inferred',
      enabled: false,
      note_key: 'quality_throttle_note_off',
    };
  }

  // We don't have an "activated_at" timestamp anywhere. Use the current
  // throttle COOLDOWN_SECONDS to find the dominant species and report the
  // last-7-days vs prior-30-days delta as a proxy for the throttle's
  // ongoing effect.
  const recent = db.prepare(`
    SELECT Com_Name, COUNT(*) AS n
    FROM detections
    WHERE Date >= date('now', '-7 days')
    GROUP BY Com_Name
    ORDER BY n DESC
    LIMIT 5
  `).all();
  const byName = {};
  for (const r of recent) byName[r.Com_Name] = { recent7: r.n };

  const prior = db.prepare(`
    SELECT Com_Name, COUNT(*) AS n
    FROM detections
    WHERE Date >= date('now', '-37 days')
      AND Date <  date('now', '-7 days')
      AND Com_Name IN (${recent.map(() => '?').join(',') || "''"})
    GROUP BY Com_Name
  `).all(...recent.map(r => r.Com_Name));
  for (const r of prior) byName[r.Com_Name].prior30 = r.n;

  const list = recent.map(r => {
    const e = byName[r.Com_Name];
    const recentPerDay = (e.recent7 || 0) / 7;
    const priorPerDay = (e.prior30 || 0) / 30;
    return {
      com_name: r.Com_Name,
      recent_per_day: Math.round(recentPerDay * 10) / 10,
      prior_per_day: Math.round(priorPerDay * 10) / 10,
      delta_pct: priorPerDay > 0
        ? Math.round((recentPerDay - priorPerDay) / priorPerDay * 100)
        : null,
    };
  });
  return {
    source: 'inferred',
    enabled: true,
    note_key: 'quality_throttle_note_on',
    species: list,
  };
}

// ── Daily timeline ─────────────────────────────────────────────────────────
// Detections per day broken down by model. Lets the user eyeball volume
// trends + dual-model balance over the period.
function dailyTimeline(db, days) {
  const fromDate = isoDateOffset(-days);
  const rows = db.prepare(`
    SELECT Date,
           SUM(CASE WHEN Model LIKE 'perch%' THEN 1 ELSE 0 END) AS perch,
           SUM(CASE WHEN Model NOT LIKE 'perch%' THEN 1 ELSE 0 END) AS birdnet,
           COUNT(*) AS total
    FROM detections
    WHERE Date >= ?
    GROUP BY Date
    ORDER BY Date
  `).all(fromDate);
  return { source: 'observed', days: rows };
}

// ── Helpers ────────────────────────────────────────────────────────────────
function isoDateOffset(deltaDays) {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

module.exports = { handle };
