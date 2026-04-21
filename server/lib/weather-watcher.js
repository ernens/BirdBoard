'use strict';
/**
 * Weather Watcher — fetches hourly weather snapshots from Open-Meteo and
 * stores them in birdash.db so each detection can be tagged with its
 * weather context (temperature, humidity, wind, precipitation, etc.).
 *
 * - On startup: backfills the past 7 days in one call.
 * - Then polls hourly: re-fetches the last 24h (cheap UPSERT, also catches
 *   any backfilled corrections from Open-Meteo).
 * - Silently skips when lat/lon are missing or Open-Meteo is unreachable —
 *   detections still flow, weather chips just won't show until next poll.
 *
 * Open-Meteo free tier: ~10K requests/day, no API key. Hourly poll = 24/day.
 */
const https = require('https');

const POLL_INTERVAL = 60 * 60 * 1000;  // 1 hour
const BACKFILL_DAYS = 7;
const REQUEST_TIMEOUT = 15000;

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

async function fetchHourly(lat, lon, pastDays) {
  const params = [
    `latitude=${lat}`,
    `longitude=${lon}`,
    'hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover,surface_pressure,weather_code',
    `past_days=${pastDays}`,
    'forecast_days=1',
    'timezone=auto',
  ].join('&');
  return fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
}

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

function start(birdashDb, parseBirdnetConf) {
  if (!birdashDb || _timer) return;
  _birdashDb = birdashDb;
  _parseBirdnetConf = parseBirdnetConf;
  poll(BACKFILL_DAYS, 'backfill');
  _timer = setInterval(() => poll(2, 'poll'), POLL_INTERVAL);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop };
