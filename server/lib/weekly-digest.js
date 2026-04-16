'use strict';
/**
 * weekly-digest.js — Weekly ornithological summary, sent via Apprise
 *
 * Promise: answer in 20 seconds the question "what should an ornithologist
 * remember about this past week?". Five blocks max, one line each.
 *
 *   1. Numbers       — detections, species, delta vs N-1
 *   2. Highlight     — priority: rare > first-of-year > notable
 *   3. Best moment   — highest-confidence detection of the week
 *   4. Phenology     — most-shifted arrival vs last year (early/late)
 *   5. Top 3 species — by count
 *
 * Opt-in via birdnet.conf: NOTIFY_DIGEST_ENABLED=1
 * Optional tag routing:    NOTIFY_DIGEST_TAG=digest
 *
 * Schedule: every Monday 08:00 local. Idempotent across restarts via
 * config/digest.json (lastSentAt).
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PROJECT_ROOT  = path.join(__dirname, '..', '..');
const APPRISE_CONFIG = path.join(PROJECT_ROOT, 'config', 'apprise.txt');
const DIGEST_STATE   = path.join(PROJECT_ROOT, 'config', 'digest.json');

const CONF = 0.7;
let _cronTimer = null;

// ─── i18n ────────────────────────────────────────────────────────────────
const MSG = {
  fr: {
    title:        '🐦 Digest hebdomadaire — semaine du {from} au {to}',
    summary:      '📊 {dets} détections · {sp} espèces · {delta} vs semaine précédente',
    summary_no_prev: '📊 {dets} détections · {sp} espèces',
    delta_up:     '+{n}',
    delta_down:   '{n}',
    delta_zero:   '=',
    hl_rare:      '🌟 Marquant : {name} — espèce rare ({n} détection(s) au total)',
    hl_first:     '🌟 Marquant : {name} — première de l\'année',
    hl_notable:   '🌟 Marquant : {name} — {n} détections cette semaine ({conf}% max)',
    best:         '🎯 Meilleur moment : {name}, {time} le {date}, confiance {conf}%',
    phenology:    '📅 Phénologie : {name} arrivé {n} jour(s) {dir} qu\'en {prevYear}',
    earlier:      'plus tôt',
    later:        'plus tard',
    top3:         '🏆 Top 3 : {a} ({na}), {b} ({nb}), {c} ({nc})',
    empty:        'Aucune donnée significative cette semaine.',
  },
  en: {
    title:        '🐦 Weekly digest — week of {from} to {to}',
    summary:      '📊 {dets} detections · {sp} species · {delta} vs last week',
    summary_no_prev: '📊 {dets} detections · {sp} species',
    delta_up:     '+{n}',
    delta_down:   '{n}',
    delta_zero:   '=',
    hl_rare:      '🌟 Highlight: {name} — rare species ({n} detection(s) all-time)',
    hl_first:     '🌟 Highlight: {name} — first of the year',
    hl_notable:   '🌟 Highlight: {name} — {n} detections this week ({conf}% max)',
    best:         '🎯 Best moment: {name}, {time} on {date}, confidence {conf}%',
    phenology:    '📅 Phenology: {name} arrived {n} day(s) {dir} than in {prevYear}',
    earlier:      'earlier',
    later:        'later',
    top3:         '🏆 Top 3: {a} ({na}), {b} ({nb}), {c} ({nc})',
    empty:        'No significant data this week.',
  },
  nl: {
    title:        '🐦 Weekoverzicht — week van {from} tot {to}',
    summary:      '📊 {dets} detecties · {sp} soorten · {delta} t.o.v. vorige week',
    summary_no_prev: '📊 {dets} detecties · {sp} soorten',
    delta_up:     '+{n}', delta_down: '{n}', delta_zero: '=',
    hl_rare:      '🌟 Opvallend: {name} — zeldzame soort ({n} detectie(s) totaal)',
    hl_first:     '🌟 Opvallend: {name} — eerste van het jaar',
    hl_notable:   '🌟 Opvallend: {name} — {n} detecties deze week ({conf}% max)',
    best:         '🎯 Beste moment: {name}, {time} op {date}, betrouwbaarheid {conf}%',
    phenology:    '📅 Fenologie: {name} kwam {n} dag(en) {dir} dan in {prevYear}',
    earlier:      'eerder',
    later:        'later',
    top3:         '🏆 Top 3: {a} ({na}), {b} ({nb}), {c} ({nc})',
    empty:        'Geen significante gegevens deze week.',
  },
  de: {
    title:        '🐦 Wochenübersicht — Woche vom {from} bis {to}',
    summary:      '📊 {dets} Erkennungen · {sp} Arten · {delta} vs. Vorwoche',
    summary_no_prev: '📊 {dets} Erkennungen · {sp} Arten',
    delta_up:     '+{n}', delta_down: '{n}', delta_zero: '=',
    hl_rare:      '🌟 Höhepunkt: {name} — seltene Art ({n} Erkennung(en) gesamt)',
    hl_first:     '🌟 Höhepunkt: {name} — erste des Jahres',
    hl_notable:   '🌟 Höhepunkt: {name} — {n} Erkennungen diese Woche ({conf}% max)',
    best:         '🎯 Bester Moment: {name}, {time} am {date}, Konfidenz {conf}%',
    phenology:    '📅 Phänologie: {name} kam {n} Tag(e) {dir} als {prevYear}',
    earlier:      'früher',
    later:        'später',
    top3:         '🏆 Top 3: {a} ({na}), {b} ({nb}), {c} ({nc})',
    empty:        'Keine signifikanten Daten diese Woche.',
  },
};

function _t(lang, key, vars = {}) {
  const tpl = (MSG[lang] || MSG.en)[key] || (MSG.en)[key] || key;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? vars[k] : '');
}

// ─── Date helpers ────────────────────────────────────────────────────────
function _isoDate(d) { return d.toISOString().slice(0, 10); }
function _fmtShort(d, lang) {
  // dd/mm or mm/dd depending on locale
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  return lang === 'en' ? `${mon}/${day}` : `${day}/${mon}`;
}

// Returns [from, to] dates for the week ending YESTERDAY (so Monday digest
// covers Mon-Sun of the past week).
function _lastWeekRange() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const eightDaysAgo = new Date(today); eightDaysAgo.setDate(today.getDate() - 7);
  return [eightDaysAgo, yesterday];
}
function _prevWeekRange(weekFrom) {
  const from = new Date(weekFrom); from.setDate(from.getDate() - 7);
  const to   = new Date(weekFrom); to.setDate(to.getDate() - 1);
  return [from, to];
}

// ─── Build digest data ───────────────────────────────────────────────────
function buildDigest(db, lang = 'en', stationName = '') {
  const lines = [];
  const [weekFrom, weekTo] = _lastWeekRange();
  const [prevFrom, prevTo] = _prevWeekRange(weekFrom);
  const fromStr = _isoDate(weekFrom), toStr = _isoDate(weekTo);
  const prevFromStr = _isoDate(prevFrom), prevToStr = _isoDate(prevTo);

  const title = _t(lang, 'title', {
    from: _fmtShort(weekFrom, lang),
    to:   _fmtShort(weekTo, lang),
  });

  // ── 1. Numbers ─────────────────────────────────────────────────────────
  const cur = db.prepare(`
    SELECT COUNT(*) as dets, COUNT(DISTINCT Com_Name) as sp
    FROM active_detections WHERE Date BETWEEN ? AND ? AND Confidence >= ?
  `).get(fromStr, toStr, CONF);

  const prev = db.prepare(`
    SELECT COUNT(*) as dets, COUNT(DISTINCT Com_Name) as sp
    FROM active_detections WHERE Date BETWEEN ? AND ? AND Confidence >= ?
  `).get(prevFromStr, prevToStr, CONF);

  if (!cur || cur.dets === 0) {
    return { title, body: _t(lang, 'empty'), hasContent: false };
  }

  const delta = cur.dets - prev.dets;
  const deltaStr = delta > 0 ? _t(lang, 'delta_up',   { n: delta })
                : delta < 0 ? _t(lang, 'delta_down', { n: delta })
                : _t(lang, 'delta_zero');
  lines.push(prev.dets > 0
    ? _t(lang, 'summary',         { dets: cur.dets.toLocaleString(), sp: cur.sp, delta: deltaStr })
    : _t(lang, 'summary_no_prev', { dets: cur.dets.toLocaleString(), sp: cur.sp }));

  // ── 2. Highlight (priority: rare > first-of-year > notable) ───────────
  const speciesWeek = db.prepare(`
    SELECT Com_Name, MAX(Sci_Name) as Sci_Name, COUNT(*) as n,
           ROUND(MAX(Confidence)*100) as max_conf
    FROM active_detections WHERE Date BETWEEN ? AND ? AND Confidence >= ?
    GROUP BY Com_Name ORDER BY n DESC
  `).all(fromStr, toStr, CONF);

  let highlight = null;

  // 2a. Rarest species this week (lowest all-time count)
  for (const s of speciesWeek) {
    const total = db.prepare(
      `SELECT COUNT(*) as n FROM active_detections WHERE Com_Name=? AND Confidence>=?`
    ).get(s.Com_Name, CONF);
    if (total.n <= 5) { // rare = ≤5 all-time
      highlight = { type: 'rare', name: _spDisplay(s.Com_Name, s.Sci_Name), n: total.n };
      break;
    }
  }

  // 2b. First-of-year detected this week
  if (!highlight) {
    const year = String(weekFrom.getFullYear());
    const firstOfYear = db.prepare(`
      SELECT Com_Name, MAX(Sci_Name) as Sci_Name, MIN(Date) as first_date
      FROM active_detections WHERE substr(Date,1,4)=? AND Confidence>=?
      GROUP BY Com_Name HAVING first_date BETWEEN ? AND ?
      ORDER BY first_date ASC LIMIT 1
    `).get(year, CONF, fromStr, toStr);
    if (firstOfYear) {
      highlight = { type: 'first', name: _spDisplay(firstOfYear.Com_Name, firstOfYear.Sci_Name) };
    }
  }

  // 2c. Notable: best ratio of week-count vs all-time
  if (!highlight && speciesWeek.length) {
    // Pick the species with the highest week-count among the bottom-half
    // by all-time count (so common species don't always win)
    let best = null, bestScore = 0;
    for (const s of speciesWeek.slice(0, 20)) {
      const total = db.prepare(
        `SELECT COUNT(*) as n FROM active_detections WHERE Com_Name=? AND Confidence>=?`
      ).get(s.Com_Name, CONF);
      const score = total.n > 0 ? (s.n / total.n) * Math.log(s.n + 1) : 0;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (best) {
      highlight = { type: 'notable', name: _spDisplay(best.Com_Name, best.Sci_Name), n: best.n, conf: best.max_conf };
    }
  }

  if (highlight) {
    lines.push(_t(lang, 'hl_' + highlight.type, highlight));
  }

  // ── 3. Best moment (highest confidence) ──────────────────────────────
  const best = db.prepare(`
    SELECT Date, Time, Com_Name, Sci_Name, ROUND(Confidence*100) as conf
    FROM detections WHERE Date BETWEEN ? AND ?
    ORDER BY Confidence DESC, Time DESC LIMIT 1
  `).get(fromStr, toStr);
  if (best) {
    lines.push(_t(lang, 'best', {
      name: _spDisplay(best.Com_Name, best.Sci_Name),
      time: best.Time.slice(0, 5),
      date: _fmtShort(new Date(best.Date), lang),
      conf: best.conf,
    }));
  }

  // ── 4. Phenology shift (most-shifted arrival vs N-1) ─────────────────
  const year = weekFrom.getFullYear();
  const arrivals = db.prepare(`
    SELECT Com_Name, MAX(Sci_Name) as Sci_Name, MIN(Date) as first_date
    FROM active_detections WHERE substr(Date,1,4)=? AND Confidence>=?
    GROUP BY Com_Name HAVING first_date BETWEEN ? AND ?
  `).all(String(year), CONF, fromStr, toStr);

  let phenoBest = null, phenoBestShift = 0;
  for (const a of arrivals) {
    const prevYearFirst = db.prepare(`
      SELECT MIN(Date) as first_date FROM active_detections
      WHERE Com_Name=? AND substr(Date,1,4)=? AND Confidence>=?
    `).get(a.Com_Name, String(year - 1), CONF);
    if (!prevYearFirst?.first_date) continue;
    const cur = new Date(a.first_date);
    const prv = new Date(prevYearFirst.first_date);
    const curDOY = Math.floor((cur - new Date(cur.getFullYear(), 0, 1)) / 86400000);
    const prvDOY = Math.floor((prv - new Date(prv.getFullYear(), 0, 1)) / 86400000);
    const shift = curDOY - prvDOY;
    if (Math.abs(shift) > Math.abs(phenoBestShift) && Math.abs(shift) >= 3) {
      phenoBestShift = shift;
      phenoBest = a;
    }
  }
  if (phenoBest) {
    lines.push(_t(lang, 'phenology', {
      name: _spDisplay(phenoBest.Com_Name, phenoBest.Sci_Name),
      n: Math.abs(phenoBestShift),
      dir: phenoBestShift < 0 ? _t(lang, 'earlier') : _t(lang, 'later'),
      prevYear: year - 1,
    }));
  }

  // ── 5. Top 3 species ─────────────────────────────────────────────────
  if (speciesWeek.length >= 3) {
    const [a, b, c] = speciesWeek.slice(0, 3);
    lines.push(_t(lang, 'top3', {
      a: _spDisplay(a.Com_Name, a.Sci_Name), na: a.n,
      b: _spDisplay(b.Com_Name, b.Sci_Name), nb: b.n,
      c: _spDisplay(c.Com_Name, c.Sci_Name), nc: c.n,
    }));
  }

  return { title, body: lines.join('\n'), hasContent: true };
}

function _spDisplay(comName, sciName) {
  // Use Com_Name as-is — server-side lookup of localized names is overkill
  // for a digest. Engine writes Com_Name in the user's UI language.
  return comName;
}

// ─── Apprise sender ──────────────────────────────────────────────────────
function _sendApprise(title, body, tag) {
  return new Promise((resolve, reject) => {
    try {
      const content = fs.readFileSync(APPRISE_CONFIG, 'utf8');
      if (!content.trim()) return reject(new Error('apprise.txt is empty'));
    } catch (e) {
      return reject(new Error('apprise.txt not found'));
    }

    const { APPRISE_BIN } = require('./config');
    const args = ['-t', title, '-b', body, '--config=' + APPRISE_CONFIG];
    if (tag && tag.trim()) args.push('--tag=' + tag.trim());

    execFile(APPRISE_BIN, args, { timeout: 30000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

// ─── Public: send the digest now ─────────────────────────────────────────
async function sendWeeklyDigest(db, parseBirdnetConf) {
  const conf = await parseBirdnetConf().catch(() => ({}));
  if (conf.NOTIFY_DIGEST_ENABLED !== '1') {
    console.log('[digest] Disabled (NOTIFY_DIGEST_ENABLED != 1)');
    return { sent: false, reason: 'disabled' };
  }
  const lang = (conf.DATABASE_LANG || 'en').slice(0, 2);
  const tag = conf.NOTIFY_DIGEST_TAG || '';

  const digest = buildDigest(db, lang, conf.SITE_NAME || '');
  if (!digest.hasContent) {
    console.log('[digest] No content to send for past week');
    return { sent: false, reason: 'empty' };
  }

  try {
    await _sendApprise(digest.title, digest.body, tag);
    _saveState({ lastSentAt: new Date().toISOString() });
    console.log('[digest] Sent:', digest.title);
    return { sent: true, title: digest.title };
  } catch (e) {
    console.error('[digest] Apprise error:', e.message);
    return { sent: false, reason: 'apprise_error', error: e.message };
  }
}

// ─── State persistence (idempotency) ─────────────────────────────────────
function _loadState() {
  try { return JSON.parse(fs.readFileSync(DIGEST_STATE, 'utf8')); }
  catch { return {}; }
}
function _saveState(state) {
  try { fs.writeFileSync(DIGEST_STATE, JSON.stringify(state, null, 2)); }
  catch (e) { console.warn('[digest] Failed to save state:', e.message); }
}

// ─── Cron: every Monday 08:00 local ──────────────────────────────────────
function startWeeklyDigestCron(db, parseBirdnetConf) {
  if (_cronTimer) return;
  // Check every 10 minutes whether it's Monday 8:00-8:09 local AND we
  // haven't sent in the past 6 days
  const tick = async () => {
    const now = new Date();
    if (now.getDay() !== 1) return;        // Monday only
    if (now.getHours() !== 8) return;       // 08:00-08:59
    const last = _loadState().lastSentAt;
    if (last && (Date.now() - new Date(last).getTime()) < 6 * 24 * 3600 * 1000) return;
    await sendWeeklyDigest(db, parseBirdnetConf).catch(e => console.error('[digest] tick:', e.message));
  };
  _cronTimer = setInterval(tick, 10 * 60 * 1000);
  // Run an initial check at startup in case we missed Monday's window
  setTimeout(tick, 30 * 1000);
  console.log('[digest] Weekly cron started (Mondays 08:00 local)');
}

function stopWeeklyDigestCron() {
  if (_cronTimer) { clearInterval(_cronTimer); _cronTimer = null; }
}

module.exports = { buildDigest, sendWeeklyDigest, startWeeklyDigestCron, stopWeeklyDigestCron };
