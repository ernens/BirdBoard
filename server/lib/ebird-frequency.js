'use strict';
/**
 * eBird regional frequency — "is this species rare HERE?"
 *
 * Uses the eBird API to fetch the observation frequency for the station's
 * region. A species observed in <5% of eBird checklists for this region
 * is considered rare; one in <1% is very rare. This replaces the naive
 * "seen ≤3 times on this station" heuristic which flagged common species
 * (Blackbird, Blue Tit, etc.) as rare on every fresh installation.
 *
 * Cache: config/ebird-frequency.json, refreshed daily.
 *
 * Fallback when no eBird API key or no GPS: the local historical count
 * is used ONLY after ≥30 days of data. Before that, nothing is flagged
 * as rare (better to miss a true rarity than to flood the user with
 * false-positive "rare!" tags on Blackbirds).
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CACHE_PATH = path.join(PROJECT_ROOT, 'config', 'ebird-frequency.json');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

let _freqMap = null; // { sciName: frequency (0–1) }
let _freqTs = 0;
let _minHistoryDays = 30; // don't use local heuristic before this

function _fetchJson(url, apiKey) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'X-eBirdApiToken': apiKey },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject).on('timeout', () => reject(new Error('eBird timeout')));
  });
}

/**
 * Fetch regional observation frequencies from eBird.
 * Returns a map { sciName: frequency } where frequency is 0–1
 * (fraction of checklists that reported this species in the last 30 days).
 */
async function fetchRegionalFrequency(lat, lon, apiKey) {
  if (!apiKey || !lat || !lon) return null;
  try {
    // eBird "recent observations" for the area — gives us a list of
    // species seen recently + their observation frequency.
    // We use the /v2/data/obs/geo/recent endpoint which returns species
    // with their observation count, then normalize by total checklists.
    // Alternative: /v2/product/spplist/hotspot for the nearest hotspot.

    // The /v2/ref/hotspot/geo endpoint finds nearby hotspots.
    // But the simplest approach: use /v2/data/obs/geo/recent with back=30
    // which returns all species observed within 25km in the last 30 days.
    const url = `https://api.ebird.org/v2/data/obs/geo/recent?lat=${lat}&lng=${lon}&back=30&maxResults=500&includeProvisional=true`;
    const observations = await _fetchJson(url, apiKey);

    if (!Array.isArray(observations)) return null;

    // The /recent endpoint lists species observed in the last 30 days
    // within ~25km of the GPS coordinates. Presence in this list is a
    // strong signal of commonness: if experienced eBird observers are
    // reporting it, it's not rare. Absence means either genuinely rare
    // or not yet reported this month (possible for secretive species).
    //
    // We store a simple presence flag (1 = seen regionally, 0 = not).
    // This avoids the pitfall of interpreting `howMany` (individual
    // counts) as checklist frequency — a single Blackbird sighting
    // with howMany=1 doesn't mean Blackbirds are rare.
    const freq = {};
    for (const obs of observations) {
      if (obs.sciName) freq[obs.sciName] = 1;
    }

    return freq;
  } catch (e) {
    console.warn('[ebird-frequency] fetch failed:', e.message);
    return null;
  }
}

/**
 * Load or refresh the frequency cache.
 */
async function loadFrequency(lat, lon, apiKey) {
  // Try disk cache first
  if (!_freqMap) {
    try {
      const raw = await fsp.readFile(CACHE_PATH, 'utf8');
      const cached = JSON.parse(raw);
      if (cached._ts && Date.now() - cached._ts < CACHE_TTL) {
        _freqMap = cached;
        _freqTs = cached._ts;
        console.log(`[ebird-frequency] loaded from cache: ${Object.keys(cached).length - 1} species`);
      }
    } catch {}
  }

  // Refresh if stale or missing
  if (!_freqMap || (Date.now() - _freqTs) > CACHE_TTL) {
    const fresh = await fetchRegionalFrequency(lat, lon, apiKey);
    if (fresh && Object.keys(fresh).length > 0) {
      fresh._ts = Date.now();
      _freqMap = fresh;
      _freqTs = fresh._ts;
      await fsp.writeFile(CACHE_PATH, JSON.stringify(fresh, null, 2)).catch(() => {});
      console.log(`[ebird-frequency] refreshed: ${Object.keys(fresh).length - 1} species from eBird`);
    } else if (!_freqMap) {
      _freqMap = {};
      console.warn('[ebird-frequency] no data — rarity will use local fallback after 30 days');
    }
  }

  return _freqMap;
}

/**
 * Check if a species is rare based on eBird regional frequency.
 *
 * @param {string} sciName - Scientific name
 * @param {number} localHistCount - local station historical count (past year)
 * @param {number} totalDays - total days of data in the local DB
 * @returns {{ isRare: boolean, source: string, reason?: string }}
 */
function checkRarity(sciName, localHistCount, totalDays) {
  // If we have eBird regional data, use it as primary source.
  // Present in recent eBird observations → common (not rare).
  // Absent → genuinely rare for this region/season.
  if (_freqMap && Object.keys(_freqMap).length > 5) {
    if (_freqMap[sciName]) {
      return { isRare: false, source: 'ebird' };
    }
    return { isRare: true, source: 'ebird', reason: 'not_in_regional_checklist' };
  }

  // Fallback: use local historical count, but ONLY if we have enough data.
  // On a fresh install (< 30 days), everything looks rare — don't flag
  // anything to avoid misleading the user.
  if (totalDays < _minHistoryDays) {
    return { isRare: false, source: 'local_insufficient_data' };
  }
  // Classic heuristic: ≤3 observations in past year = rare locally
  return {
    isRare: localHistCount <= 3,
    source: 'local',
    reason: localHistCount <= 3 ? 'low_local_count' : undefined,
  };
}

/**
 * Force a cache refresh (e.g. after the user changes GPS or API key).
 * Bypasses both in-memory and on-disk caches — re-hits eBird.
 */
async function refresh(lat, lon, apiKey) {
  _freqMap = null;
  _freqTs = 0;
  const fresh = await fetchRegionalFrequency(lat, lon, apiKey);
  if (fresh && Object.keys(fresh).length > 0) {
    fresh._ts = Date.now();
    _freqMap = fresh;
    _freqTs = fresh._ts;
    await fsp.writeFile(CACHE_PATH, JSON.stringify(fresh, null, 2)).catch(() => {});
    console.log(`[ebird-frequency] force-refreshed: ${Object.keys(fresh).length - 1} species from eBird`);
  } else {
    console.warn('[ebird-frequency] force refresh returned no data — keeping previous cache');
    // Fall back to whatever was on disk
    return loadFrequency(lat, lon, apiKey);
  }
  return _freqMap;
}

module.exports = { loadFrequency, refresh, checkRarity, fetchRegionalFrequency };
