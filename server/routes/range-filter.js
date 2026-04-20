'use strict';
/**
 * Range filter preview — runs the Python CLI that asks the BirdNET MData
 * model which species are expected at the station's GPS for the current
 * (or specified) week + threshold. Lets the user SEE what the slider in
 * Settings → Detection actually does.
 *
 * Cached 5 min by (lat, lon, week, threshold, lang) — the underlying
 * inference is ~200ms on Pi 5 but the user moves the slider a lot.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CACHE_TTL_MS = 5 * 60 * 1000;

// Locate a Python venv with the engine's deps. Mirrors the BIRDNET_DIR
// resolution in lib/config.js — engine can sit at ~/birdengine OR
// ~/birdash/engine depending on the install.
function _resolvePython() {
  const home = process.env.HOME || '';
  const candidates = [
    path.join(home, 'birdengine', 'venv', 'bin', 'python'),
    path.join(home, 'birdash', 'engine', 'venv', 'bin', 'python'),
  ];
  return candidates.find(p => fs.existsSync(p)) || 'python3';
}

function _resolveModelsDir(BIRDNET_DIR) {
  return path.join(BIRDNET_DIR, 'models');
}

function _isoWeek1to48() {
  // BirdNET MData uses a custom 48-week year (cosine-warped in engine.py).
  // The engine passes ISO week (1-53) and the model handles the rest.
  // ISO week computed without external deps.
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

const _cache = new Map();   // key → {data, ts}

function _cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL_MS) { _cache.delete(key); return null; }
  return e.data;
}
function _cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() });
  if (_cache.size > 200) {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [k, v] of _cache) if (v.ts < cutoff) _cache.delete(k);
  }
}

function _runCli(pythonBin, cliPath, args, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(pythonBin, [cliPath, ...args]);
    let stdout = '', stderr = '';
    const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} reject(new Error('timeout')); }, timeoutMs);
    proc.stdout.on('data', c => stdout += c);
    proc.stderr.on('data', c => stderr += c);
    proc.on('close', code => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`exit ${code}: ${stderr.trim().slice(-200)}`));
      try { resolve(JSON.parse(stdout)); }
      catch (e) { reject(new Error('invalid JSON from cli: ' + e.message)); }
    });
    proc.on('error', err => { clearTimeout(t); reject(err); });
  });
}

function handle(req, res, pathname, ctx) {
  // ── GET /api/range-filter/preview ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/range-filter/preview') {
    (async () => {
      try {
        const { parseBirdnetConf, BIRDNET_DIR } = ctx;
        const conf = await parseBirdnetConf();
        const url = new URL(req.url, 'http://localhost');
        const lat = parseFloat(url.searchParams.get('lat') || conf.LATITUDE || '0');
        const lon = parseFloat(url.searchParams.get('lon') || conf.LONGITUDE || '0');
        const week = parseInt(url.searchParams.get('week') || _isoWeek1to48(), 10);
        const threshold = parseFloat(url.searchParams.get('threshold') || conf.SF_THRESH || '0.03');
        const lang = (url.searchParams.get('lang') || conf.DATABASE_LANG || 'en').slice(0, 2);
        const mdataVersion = parseInt(conf.MDATA_VERSION || '2', 10);

        if (!isFinite(lat) || !isFinite(lon) || lat === 0 || lon === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'gps_not_set', message: 'Set LATITUDE / LONGITUDE in Settings → Station first.' }));
          return;
        }
        if (!(week >= 1 && week <= 53) || !(threshold >= 0 && threshold <= 1)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_params' }));
          return;
        }

        const cacheKey = `${lat}|${lon}|${week}|${threshold}|${lang}|${mdataVersion}`;
        const cached = _cacheGet(cacheKey);
        if (cached) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ...cached, cached: true }));
          return;
        }

        const pythonBin = _resolvePython();
        const cliPath   = path.join(PROJECT_ROOT, 'engine', 'range_filter_cli.py');
        const modelsDir = _resolveModelsDir(BIRDNET_DIR);
        if (!fs.existsSync(cliPath) || !fs.existsSync(modelsDir)) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'engine_missing', cli: cliPath, models: modelsDir }));
          return;
        }

        const data = await _runCli(pythonBin, cliPath, [
          '--lat', String(lat),
          '--lon', String(lon),
          '--week', String(week),
          '--threshold', String(threshold),
          '--models-dir', modelsDir,
          '--mdata-version', String(mdataVersion),
          '--lang', lang,
        ]);
        if (data.error) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
          return;
        }
        _cacheSet(cacheKey, data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...data, cached: false }));
      } catch (e) {
        console.error('[range-filter]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'preview_failed', message: e.message }));
      }
    })();
    return true;
  }
  return false;
}

module.exports = { handle };
