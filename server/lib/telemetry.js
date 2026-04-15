'use strict';
/**
 * Telemetry — opt-in station registration + daily reports to Supabase.
 *
 * - On opt-in: registers the station (UUID, GPS, hardware, version)
 * - Daily cron: sends heartbeat + detection summary (top species, rare)
 * - All data is public and queryable via Supabase REST API
 * - Fully opt-in: nothing is sent until the user explicitly enables it
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'telemetry.json');

// Supabase credentials (public anon key — read/insert only via RLS)
const SUPABASE_URL = 'https://ujuaoogpthdlyvyphgpc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_aM2y1SE0B42oXD05wuGmJQ_FsqmzSHa';

let _config = null;    // { enabled, stationId, stationName, optInDate }
let _dailyTimer = null;

// ── Config persistence ──────────────────────────────────────────────────────
function _loadConfig() {
  try {
    _config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    _config = { enabled: false, stationId: null, stationName: '', optInDate: null };
  }
  return _config;
}

function _saveConfig() {
  const tmp = CONFIG_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(_config, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
}

// ── Hardware detection ──────────────────────────────────────────────────────
function _getHardwareInfo() {
  let hardware = 'unknown';
  let os = 'unknown';
  try {
    const model = fs.readFileSync('/proc/device-tree/model', 'utf8').replace(/\0/g, '').trim();
    hardware = model || 'unknown';
  } catch {}
  try {
    const release = fs.readFileSync('/etc/os-release', 'utf8');
    const pretty = release.match(/PRETTY_NAME="(.+)"/);
    if (pretty) os = pretty[1];
  } catch {}
  return { hardware, os };
}

function _getVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    return pkg.version || 'unknown';
  } catch { return 'unknown'; }
}

// ── Supabase REST helpers ───────────────────────────────────────────────────
function _supabaseRequest(method, table, body, query) {
  return new Promise((resolve, reject) => {
    const qs = query ? '?' + query : '';
    const postData = body ? JSON.stringify(body) : '';
    const options = {
      hostname: new URL(SUPABASE_URL).hostname,
      path: `/rest/v1/${table}${qs}`,
      method,
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=minimal',
      },
    };
    if (postData) options.headers['Content-Length'] = Buffer.byteLength(postData);

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : null);
        } else {
          reject(new Error(`Supabase ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Supabase timeout')); });
    if (postData) req.write(postData);
    req.end();
  });
}

// ── Registration ────────────────────────────────────────────────────────────
async function register(stationName, lat, lon, detectionModel) {
  _loadConfig();
  if (!_config.stationId) {
    _config.stationId = crypto.randomUUID();
  }
  _config.stationName = stationName || '';
  _config.enabled = true;
  _config.optInDate = new Date().toISOString();
  _saveConfig();

  const { hardware, os } = _getHardwareInfo();
  const version = _getVersion();

  // Determine country from coordinates (rough — just for display)
  let country = '';
  if (lat && lon) {
    // Simple reverse geocode via nominatim (optional, best-effort)
    try {
      country = await new Promise((resolve, reject) => {
        const req = https.get(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=3`,
          { headers: { 'User-Agent': 'birdash-telemetry/1.0' } },
          res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => {
              try { resolve(JSON.parse(d).address?.country || ''); }
              catch { resolve(''); }
            });
          }
        );
        req.on('error', () => resolve(''));
        req.setTimeout(5000, () => { req.destroy(); resolve(''); });
      });
    } catch { country = ''; }
  }

  const station = {
    id: _config.stationId,
    name: stationName || '',
    lat: lat || null,
    lon: lon || null,
    country,
    hardware,
    os,
    version,
    model: detectionModel || '',
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
  };

  await _supabaseRequest('POST', 'stations', station, 'on_conflict=id');
  console.log(`[telemetry] Station registered: ${_config.stationId} (${stationName})`);
  return { stationId: _config.stationId };
}

// ── Daily report ────────────────────────────────────────────────────────────
async function sendDailyReport(db, parseBirdnetConf) {
  _loadConfig();
  if (!_config.enabled || !_config.stationId) return;

  try {
    const version = _getVersion();
    const { hardware, os } = _getHardwareInfo();
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10);
    // Yesterday's complete data (today is still accumulating)
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().slice(0, 10);

    // Re-read GPS from birdnet.conf (may have changed since registration)
    let lat = null, lon = null, model = '';
    if (parseBirdnetConf) {
      try {
        const conf = await parseBirdnetConf();
        lat = parseFloat(conf.LATITUDE || conf.LAT || '0') || null;
        lon = parseFloat(conf.LONGITUDE || conf.LON || '0') || null;
        model = conf.MODEL || conf.BIRDNET_MODEL || '';
      } catch {}
    }

    // Get yesterday's stats
    const stats = db.prepare(`
      SELECT COUNT(*) as det, COUNT(DISTINCT Com_Name) as sp
      FROM detections WHERE Date = ?
    `).get(yStr);

    // Top 10 species yesterday
    const topSpecies = db.prepare(`
      SELECT Com_Name as name, Sci_Name as sci, COUNT(*) as count
      FROM detections WHERE Date = ?
      GROUP BY Com_Name ORDER BY count DESC LIMIT 10
    `).all(yStr);

    // Rare species (≤3 detections yesterday, if station has 30+ days of data)
    let rareSpecies = [];
    try {
      const dayCount = db.prepare(`SELECT COUNT(DISTINCT Date) as n FROM detections`).get().n;
      if (dayCount >= 30) {
        rareSpecies = db.prepare(`
          SELECT Com_Name as name, Sci_Name as sci, COUNT(*) as count
          FROM detections WHERE Date = ? GROUP BY Com_Name HAVING count <= 3
          ORDER BY count ASC LIMIT 5
        `).all(yStr);
      }
    } catch {}

    // Total station stats
    const totals = db.prepare(`
      SELECT COUNT(*) as det, COUNT(DISTINCT Com_Name) as sp FROM detections
    `).get();

    // Update station heartbeat (includes GPS refresh)
    const heartbeat = { last_seen: new Date().toISOString(), version, hardware, os, model, total_detections: totals.det, total_species: totals.sp };
    if (lat) heartbeat.lat = lat;
    if (lon) heartbeat.lon = lon;
    await _supabaseRequest('PATCH', 'stations', heartbeat, `id=eq.${_config.stationId}`);

    // Send daily report (upsert on station_id + date)
    if (stats.det > 0) {
      await _supabaseRequest('POST', 'daily_reports', {
        station_id: _config.stationId,
        date: yStr,
        detections: stats.det,
        species: stats.sp,
        top_species: topSpecies,
        rare_species: rareSpecies,
      }, 'on_conflict=station_id,date');
    }

    console.log(`[telemetry] Daily report sent: ${yStr} — ${stats.det} det, ${stats.sp} sp`);
  } catch (e) {
    console.error('[telemetry] Daily report failed:', e.message);
  }
}

// ── Opt-out ─────────────────────────────────────────────────────────────────
function disable() {
  _loadConfig();
  _config.enabled = false;
  _saveConfig();
  if (_dailyTimer) { clearInterval(_dailyTimer); _dailyTimer = null; }
  console.log('[telemetry] Disabled');
}

// ── Status ──────────────────────────────────────────────────────────────────
function getStatus() {
  _loadConfig();
  return {
    enabled: _config.enabled,
    stationId: _config.stationId,
    stationName: _config.stationName,
    optInDate: _config.optInDate,
  };
}

// ── Start daily cron ────────────────────────────────────────────────────────
function startDailyCron(db, parseBirdnetConf) {
  _loadConfig();
  if (!_config.enabled) return;

  // Send once at startup (catches up if missed), then every 6 hours
  setTimeout(() => sendDailyReport(db, parseBirdnetConf).catch(e => console.error('[telemetry]', e.message)), 10000);
  _dailyTimer = setInterval(() => {
    sendDailyReport(db, parseBirdnetConf).catch(e => console.error('[telemetry]', e.message));
  }, 6 * 60 * 60 * 1000);
  console.log('[telemetry] Daily cron started');
}

function stopDailyCron() {
  if (_dailyTimer) { clearInterval(_dailyTimer); _dailyTimer = null; }
}

module.exports = { register, disable, getStatus, sendDailyReport, startDailyCron, stopDailyCron };
