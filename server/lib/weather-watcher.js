'use strict';
/**
 * Weather Watcher — fetches hourly weather snapshots from Open-Meteo and
 * stores them in birdash.db so each detection can be tagged with its
 * weather context (temperature, humidity, wind, precipitation, etc.).
 *
 * Three data sources, all free, no API key:
 * - Forecast API (api.open-meteo.com): hourly polling for the last ~2 days.
 * - Forecast API past_days=7: startup refresh of the past week.
 * - Archive API (archive-api.open-meteo.com): one-shot historical backfill
 *   from the oldest detection in the DB up to ~6 days ago. Runs once per
 *   process when a coverage gap is detected, chunked 1 year per request.
 *
 * Silent skip when lat/lon are missing or Open-Meteo is unreachable —
 * detections still flow, weather chips just won't show until next poll.
 */
const https = require('https');

const POLL_INTERVAL = 60 * 60 * 1000;  // 1 hour
const RECENT_BACKFILL_DAYS = 7;        // forecast API on start
const ARCHIVE_LAG_DAYS = 6;             // archive API runs ~5 days behind real-time
const ARCHIVE_CHUNK_DAYS = 365;         // chunk huge ranges to stay polite
const REQUEST_TIMEOUT = 30000;

let _timer = null;
let _birdashDb = null;
let _parseBirdnetConf = null;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: REQUEST_TIMEOUT }, (resp) => {
      let body = '';
      resp.on('data', c => { body += c; });
      resp.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
      });
      resp.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

const HOURLY_VARS = 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover,surface_pressure,weather_code';

async function fetchHourly(lat, lon, pastDays) {
  const params = [
    `latitude=${lat}`,
    `longitude=${lon}`,
    `hourly=${HOURLY_VARS}`,
    `past_days=${pastDays}`,
    'forecast_days=1',
    'timezone=auto',
  ].join('&');
  return fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
}

async function fetchArchive(lat, lon, startDate, endDate) {
  const params = [
    `latitude=${lat}`,
    `longitude=${lon}`,
    `hourly=${HOURLY_VARS}`,
    `start_date=${startDate}`,
    `end_date=${endDate}`,
    'timezone=auto',
  ].join('&');
  return fetchJson(`https://archive-api.open-meteo.com/v1/archive?${params}`);
}

function isoDate(d) { return d.toISOString().slice(0, 10); }
function addDays(date, days) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + days); return d; }

function upsertSnapshots(data) {
  if (!data || !data.hourly || !Array.isArray(data.hourly.time)) return 0;
  const h = data.hourly;
  const stmt = _birdashDb.prepare(`INSERT INTO weather_hourly
    (date, hour, temp_c, humidity_pct, wind_kmh, wind_dir_deg,
     precip_mm, cloud_pct, pressure_hpa, weather_code, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, hour) DO UPDATE SET
      temp_c=excluded.temp_c, humidity_pct=excluded.humidity_pct,
      wind_kmh=excluded.wind_kmh, wind_dir_deg=excluded.wind_dir_deg,
      precip_mm=excluded.precip_mm, cloud_pct=excluded.cloud_pct,
      pressure_hpa=excluded.pressure_hpa, weather_code=excluded.weather_code,
      fetched_at=excluded.fetched_at`);
  const now = Math.floor(Date.now() / 1000);
  const tx = _birdashDb.transaction((rows) => {
    for (const row of rows) stmt.run(...row, now);
  });
  const rows = [];
  for (let i = 0; i < h.time.length; i++) {
    const ts = h.time[i];          // "2026-04-21T14:00"
    if (!ts || typeof ts !== 'string') continue;
    const [date, clock] = ts.split('T');
    const hour = parseInt((clock || '').split(':')[0], 10);
    if (isNaN(hour)) continue;
    rows.push([
      date,
      hour,
      h.temperature_2m?.[i] ?? null,
      h.relative_humidity_2m?.[i] ?? null,
      h.wind_speed_10m?.[i] ?? null,
      h.wind_direction_10m?.[i] != null ? Math.round(h.wind_direction_10m[i]) : null,
      h.precipitation?.[i] ?? null,
      h.cloud_cover?.[i] ?? null,
      h.surface_pressure?.[i] ?? null,
      h.weather_code?.[i] != null ? Math.round(h.weather_code[i]) : null,
    ]);
  }
  tx(rows);
  return rows.length;
}

async function poll(pastDays, label) {
  if (!_birdashDb || !_parseBirdnetConf) return;
  try {
    const conf = await _parseBirdnetConf();
    const lat = conf.LATITUDE || conf.LAT;
    const lon = conf.LONGITUDE || conf.LON;
    if (!lat || !lon) return;
    const data = await fetchHourly(lat, lon, pastDays);
    if (data && data.error) {
      console.warn(`[weather-watcher] ${label} error: ${data.reason || data.error}`);
      return;
    }
    const n = upsertSnapshots(data);
    if (n > 0) console.log(`[weather-watcher] ${label}: ${n} hourly snapshots`);
  } catch (e) {
    console.warn(`[weather-watcher] ${label} failed: ${e.message}`);
  }
}

// Historical backfill via the archive API. Runs once on startup if the
// oldest snapshot is newer than the oldest detection (or the table is empty).
// Chunked by ARCHIVE_CHUNK_DAYS to keep individual responses manageable.
async function backfillArchive(detectionsDb) {
  if (!_birdashDb || !_parseBirdnetConf || !detectionsDb) return;
  try {
    const conf = await _parseBirdnetConf();
    const lat = conf.LATITUDE || conf.LAT;
    const lon = conf.LONGITUDE || conf.LON;
    if (!lat || !lon) return;

    const det = detectionsDb.prepare('SELECT MIN(Date) AS oldest FROM detections').get();
    if (!det || !det.oldest) return;
    const oldestDet = new Date(det.oldest + 'T00:00:00Z');

    const cov = _birdashDb.prepare('SELECT MIN(date) AS oldest FROM weather_hourly').get();
    const oldestCov = cov && cov.oldest ? new Date(cov.oldest + 'T00:00:00Z') : null;

    // Archive API stops ~5 days before today; our forecast poll covers the rest.
    const archiveEnd = addDays(new Date(), -ARCHIVE_LAG_DAYS);
    // Stop right before the existing coverage so we don't re-fetch what we have.
    const target = oldestCov && oldestCov < archiveEnd ? addDays(oldestCov, -1) : archiveEnd;

    if (oldestDet >= target) return;  // already covered

    console.log(`[weather-watcher] archive backfill: ${isoDate(oldestDet)} → ${isoDate(target)}`);
    let cursor = new Date(oldestDet);
    while (cursor <= target) {
      const chunkEnd = new Date(Math.min(addDays(cursor, ARCHIVE_CHUNK_DAYS - 1).getTime(), target.getTime()));
      try {
        const data = await fetchArchive(lat, lon, isoDate(cursor), isoDate(chunkEnd));
        if (data && data.error) {
          console.warn(`[weather-watcher] archive ${isoDate(cursor)}..${isoDate(chunkEnd)}: ${data.reason || data.error}`);
        } else {
          const n = upsertSnapshots(data);
          console.log(`[weather-watcher] archive ${isoDate(cursor)}..${isoDate(chunkEnd)}: ${n} snapshots`);
        }
      } catch (e) {
        console.warn(`[weather-watcher] archive chunk failed: ${e.message}`);
      }
      cursor = addDays(chunkEnd, 1);
      // Be a polite citizen — small pause between chunks.
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (e) {
    console.warn(`[weather-watcher] archive backfill error: ${e.message}`);
  }
}

function start(birdashDb, parseBirdnetConf, detectionsDb) {
  if (!birdashDb || _timer) return;
  _birdashDb = birdashDb;
  _parseBirdnetConf = parseBirdnetConf;
  poll(RECENT_BACKFILL_DAYS, 'recent');
  // Historical backfill runs in the background; doesn't block startup.
  if (detectionsDb) setTimeout(() => backfillArchive(detectionsDb), 5000);
  _timer = setInterval(() => poll(2, 'poll'), POLL_INTERVAL);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop };
