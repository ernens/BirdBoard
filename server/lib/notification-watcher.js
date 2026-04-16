'use strict';
/**
 * Notification Watcher — polls detections DB and sends push notifications
 * via Apprise based on user-configured rules.
 *
 * Replaces the engine-side ntfy.sh notifier. Runs in the birdash Node.js
 * process, has full access to DB (detections, favorites, validations).
 *
 * Rules (same as engine Notifier, now unified):
 *   1. Rare species (total count ≤ threshold)
 *   2. First of season (absent ≥ N days)
 *   3. New species ever (first detection all-time)
 *   4. First of the day (noisy — warning in UI)
 *   5. Favorite species (first of the day)
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const APPRISE_CONFIG = path.join(PROJECT_ROOT, 'config', 'apprise.txt');
const COOLDOWN_MS = 5 * 60 * 1000; // 5 min per species
const POLL_INTERVAL = 30 * 1000;   // 30 seconds

// Notification message templates (4 languages)
const MESSAGES = {
  fr: {
    rare: (src) => src === 'ebird'
      ? 'Espèce rare (hors check-list eBird régionale)'
      : 'Espèce rare (≤3 observations locales sur 1 an)',
    season: (d) => `Première de saison (absente depuis ${d} jours)`,
    new_species: 'Nouvelle espèce — jamais détectée',
    daily: 'Première du jour',
    favorite: 'Favori détecté — première du jour',
    conf: 'Confiance',
  },
  en: {
    rare: (src) => src === 'ebird'
      ? 'Rare species (not in eBird regional checklist)'
      : 'Rare species (≤3 local observations in past year)',
    season: (d) => `First of season (absent for ${d} days)`,
    new_species: 'New species — never detected before',
    daily: 'First of the day',
    favorite: 'Favorite detected — first of the day',
    conf: 'Confidence',
  },
  de: {
    rare: (src) => src === 'ebird'
      ? 'Seltene Art (nicht in eBird-Regionalliste)'
      : 'Seltene Art (≤3 lokale Beobachtungen im letzten Jahr)',
    season: (d) => `Erste der Saison (seit ${d} Tagen abwesend)`,
    new_species: 'Neue Art — noch nie erkannt',
    daily: 'Erste des Tages',
    favorite: 'Favorit erkannt — erste des Tages',
    conf: 'Konfidenz',
  },
  nl: {
    rare: (src) => src === 'ebird'
      ? 'Zeldzame soort (niet op eBird regionale checklist)'
      : 'Zeldzame soort (≤3 lokale waarnemingen afgelopen jaar)',
    season: (d) => `Eerste van het seizoen (${d} dagen afwezig)`,
    new_species: 'Nieuwe soort — nooit eerder gedetecteerd',
    daily: 'Eerste van de dag',
    favorite: 'Favoriet gedetecteerd — eerste van de dag',
    conf: 'Betrouwbaarheid',
  },
};

let _db = null;
let _birdashDb = null;
let _parseBirdnetConf = null;
let _ebirdFreq = null;
let _pollTimer = null;
let _lastPollTime = null;   // ISO time string of last poll
let _speciesToday = new Set();
let _currentDay = null;
let _lastNotif = {};         // sci_name → timestamp
let _speciesCounts = null;   // sci_name → total count (loaded once)
let _speciesLastSeen = null; // sci_name → last date (loaded once)
let _speciesHistCount = null; // sci_name → past-year count (for checkRarity)
let _totalDays = 0;           // span of DB data, in days
let _rarityRefreshedAt = 0;   // ms timestamp of last hist refresh
const RARITY_CACHE_TTL = 3600 * 1000; // 1h

// ── Cache loaders ─────────────────────────────────────────────────────────
function _loadSpeciesCache() {
  if (_speciesCounts) return;
  _speciesCounts = {};
  _speciesLastSeen = {};
  try {
    const rows = _db.prepare('SELECT Sci_Name, COUNT(*) as n, MAX(Date) as last FROM detections GROUP BY Sci_Name').all();
    for (const r of rows) {
      _speciesCounts[r.Sci_Name] = r.n;
      _speciesLastSeen[r.Sci_Name] = r.last;
    }
    console.log(`[notif-watcher] Species cache loaded: ${rows.length} species`);
  } catch (e) {
    console.error('[notif-watcher] Failed to load species cache:', e.message);
  }
}

function _loadRarityCache() {
  // Refresh past-year counts + totalDays once an hour. Used by checkRarity()
  // to decide whether a detection qualifies as a rare species.
  if (Date.now() - _rarityRefreshedAt < RARITY_CACHE_TTL) return;
  try {
    const oneYearAgo = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
    const rows = _db.prepare(
      'SELECT Sci_Name, COUNT(*) as n FROM detections WHERE Date >= ? GROUP BY Sci_Name'
    ).all(oneYearAgo);
    const next = {};
    for (const r of rows) next[r.Sci_Name] = r.n;
    _speciesHistCount = next;
    const span = _db.prepare('SELECT MIN(Date) as first, MAX(Date) as last FROM detections').get();
    if (span && span.first && span.last) {
      _totalDays = Math.max(0, Math.floor(
        (new Date(span.last) - new Date(span.first)) / 86400000
      ));
    }
    _rarityRefreshedAt = Date.now();
  } catch (e) {
    console.error('[notif-watcher] Failed to load rarity cache:', e.message);
  }
}

function _loadFavorites() {
  try {
    if (!_birdashDb) return new Set();
    const rows = _birdashDb.prepare('SELECT com_name FROM favorites').all();
    return new Set(rows.map(r => r.com_name));
  } catch {
    return new Set();
  }
}

// ── Download species photo to temp file ───────────────────────────────────
const https = require('https');
const http = require('http');

function _downloadPhoto(sciName) {
  return new Promise((resolve) => {
    const tmpPath = `/tmp/birdash_notif_${Date.now()}.jpg`;
    const url = `http://127.0.0.1:7474/api/photo?sci=${encodeURIComponent(sciName)}`;
    const req = http.get(url, { timeout: 5000 }, (res) => {
      if (res.statusCode !== 200) { resolve(null); return; }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const buf = Buffer.concat(chunks);
          if (buf.length < 1000) { resolve(null); return; } // too small = error page
          fs.writeFileSync(tmpPath, buf);
          resolve(tmpPath);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ── Apprise sender ────────────────────────────────────────────────────────
function _sendApprise(title, body, photoPath) {
  return new Promise((resolve) => {
    // Check apprise.txt exists and has content
    try {
      const content = fs.readFileSync(APPRISE_CONFIG, 'utf8');
      if (!content.trim()) { resolve(); return; }
    } catch { resolve(); return; }

    const { APPRISE_BIN } = require('./config');
    const appriseBin = APPRISE_BIN;

    const args = ['-t', title, '-b', body];
    if (photoPath && fs.existsSync(photoPath)) args.push('--attach=' + photoPath);
    args.push('--config=' + APPRISE_CONFIG);

    execFile(appriseBin, args, { timeout: 20000 }, (err) => {
      if (err) console.error('[notif-watcher] Apprise error:', err.message);
      else console.log(`[notif-watcher] Sent: ${title}`);
      // Clean up temp photo
      if (photoPath) try { fs.unlinkSync(photoPath); } catch {}
      resolve();
    });
  });
}

// ── Read notification config from birdnet.conf ────────────────────────────
async function _getNotifConfig() {
  try {
    const conf = await _parseBirdnetConf();
    // Min confidence: explicit NOTIFY_MIN_CONFIDENCE wins; else fall back to
    // the detection threshold (BIRDNET_CONFIDENCE) so default matches settings.
    const explicitMin = parseFloat(conf.NOTIFY_MIN_CONFIDENCE);
    const birdnetMin  = parseFloat(conf.BIRDNET_CONFIDENCE);
    const minConf = !isNaN(explicitMin) ? explicitMin
                  : !isNaN(birdnetMin)  ? birdnetMin
                  : 0;
    return {
      enabled:        conf.NOTIFY_ENABLED !== '0',
      rareSpecies:    conf.NOTIFY_RARE_SPECIES === '1',
      rareThreshold:  parseInt(conf.NOTIFY_RARE_THRESHOLD || '10', 10),
      firstSeason:    conf.NOTIFY_FIRST_SEASON === '1',
      seasonDays:     parseInt(conf.NOTIFY_SEASON_DAYS || '30', 10),
      newSpecies:     conf.APPRISE_NOTIFY_NEW_SPECIES === '1',
      newDaily:       conf.APPRISE_NOTIFY_NEW_SPECIES_EACH_DAY === '1',
      favorites:      conf.NOTIFY_FAVORITES === '1',
      minConfidence:  minConf,
      lang:           (conf.DATABASE_LANG || 'fr').substring(0, 2),
      stationName:    conf.SITE_NAME || conf.SITE_BRAND || require('os').hostname(),
    };
  } catch {
    return { enabled: false };
  }
}

// ── Poll and check ────────────────────────────────────────────────────────
async function _poll() {
  const conf = await _getNotifConfig();
  if (!conf.enabled) return;

  _loadSpeciesCache();
  _loadRarityCache();
  const msgs = MESSAGES[conf.lang] || MESSAGES.en;

  // Day rollover
  const today = new Date().toISOString().slice(0, 10);
  if (_currentDay !== today) {
    _speciesToday.clear();
    _lastNotif = {};
    _currentDay = today;
  }

  // Get recent detections since last poll
  const since = _lastPollTime || new Date(Date.now() - POLL_INTERVAL).toISOString().slice(11, 19);
  let rows;
  try {
    rows = _db.prepare(
      'SELECT Date, Time, Com_Name, Sci_Name, Confidence, Model FROM detections WHERE Date = ? AND Time > ? ORDER BY Time ASC'
    ).all(today, since);
  } catch (e) {
    console.error('[notif-watcher] Query error:', e.message);
    return;
  }
  if (rows.length) {
    _lastPollTime = rows[rows.length - 1].Time;
  }

  const favorites = conf.favorites ? _loadFavorites() : new Set();

  for (const det of rows) {
    // Skip low-confidence detections (configurable, defaults to BIRDNET_CONFIDENCE)
    if (conf.minConfidence > 0 && det.Confidence < conf.minConfidence) continue;
    const sci = det.Sci_Name;
    const com = det.Com_Name;
    const isNewToday = !_speciesToday.has(sci);
    _speciesToday.add(sci);

    // Update cache
    _speciesCounts[sci] = (_speciesCounts[sci] || 0) + 1;

    // Determine matching rule
    let reason = null;
    const totalCount = _speciesCounts[sci] || 1;
    const lastSeen = _speciesLastSeen[sci];

    // Rule 1: Rare species — based on ornithological categorization (eBird
    // regional checklist, with ≤3 local observations as fallback after 30d),
    // not on cumulative detection count.
    if (conf.rareSpecies && _ebirdFreq) {
      const histCount = (_speciesHistCount && _speciesHistCount[sci]) || 0;
      const rarity = _ebirdFreq.checkRarity(sci, histCount, _totalDays);
      if (rarity.isRare) reason = msgs.rare(rarity.source);
    }
    // Rule 2: First of season
    else if (conf.firstSeason && isNewToday && lastSeen) {
      try {
        const lastDt = new Date(lastSeen + 'T00:00:00');
        const todayDt = new Date(today + 'T00:00:00');
        const daysAbsent = Math.floor((todayDt - lastDt) / 86400000);
        if (daysAbsent >= conf.seasonDays) {
          reason = msgs.season(daysAbsent);
        }
      } catch {}
    }
    // Rule 3: New species ever
    else if (conf.newSpecies && totalCount === 1) {
      reason = msgs.new_species;
    }
    // Rule 4: First of the day
    else if (conf.newDaily && isNewToday) {
      reason = msgs.daily;
    }

    // Rule 5: Favorite (if no other reason matched)
    if (!reason && conf.favorites && isNewToday && favorites.has(com)) {
      reason = msgs.favorite;
    }

    if (!reason) continue;

    // Cooldown per species
    const now = Date.now();
    if (_lastNotif[sci] && (now - _lastNotif[sci]) < COOLDOWN_MS) continue;
    _lastNotif[sci] = now;

    // Update last seen
    _speciesLastSeen[sci] = today;

    const title = `[${conf.stationName}] ${com} — ${reason}`;
    const body = `${com} (${sci})\n${msgs.conf}: ${Math.round(det.Confidence * 100)}% — ${det.Model || ''}`;

    // Download species photo + send async (don't block poll loop)
    _downloadPhoto(sci).then(photoPath => {
      _sendApprise(title, body, photoPath).catch(() => {});
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────
function start(db, birdashDb, parseBirdnetConf, ebirdFreq) {
  _db = db;
  _birdashDb = birdashDb;
  _parseBirdnetConf = parseBirdnetConf;
  _ebirdFreq = ebirdFreq || null;
  // First poll after 10s (let server finish booting)
  setTimeout(() => _poll().catch(e => console.error('[notif-watcher]', e.message)), 10000);
  _pollTimer = setInterval(() => _poll().catch(e => console.error('[notif-watcher]', e.message)), POLL_INTERVAL);
  console.log('[notif-watcher] Started (poll every 30s)');
}

function stop() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

module.exports = { start, stop };
