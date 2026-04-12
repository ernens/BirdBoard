'use strict';
/**
 * Network routes — multi-station federation.
 *
 * Public API (exposed to other stations):
 *   GET /api/public/station-info
 *   GET /api/public/summary?date=...
 *   GET /api/public/species?date=...
 *
 * Internal API (managing peer stations):
 *   GET /api/stations
 *   POST /api/stations
 *   DELETE /api/stations/:id
 *   POST /api/stations/:id/sync
 *   GET /api/network/overview
 */
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const https = require('https');
const http  = require('http');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const STATIONS_FILE = path.join(PROJECT_ROOT, 'config', 'stations.json');
const SNAPSHOTS_FILE = path.join(PROJECT_ROOT, 'config', 'station-snapshots.json');

// ── Station persistence ─────────────────────────────────────────────────────
// Reads are sync (cheap, infrequent). Writes go through safe-config so the
// background sync (every 30 min) cannot lost-update a fresh user add.
const safeConfig = require('../lib/safe-config');

function loadStations() {
  try { return JSON.parse(fs.readFileSync(STATIONS_FILE, 'utf8')); }
  catch(e) { return []; }
}
function loadSnapshots() {
  try { return JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8')); }
  catch(e) { return {}; }
}
// updateStations((stations) => mutated) — guaranteed serial against any
// other writer of stations.json (e.g. background sync) on this process.
function updateStations(mutator, label) {
  return safeConfig.updateConfig(STATIONS_FILE, mutator, null,
    { label: label || 'updateStations', defaultValue: [] });
}
function updateSnapshots(mutator, label) {
  return safeConfig.updateConfig(SNAPSHOTS_FILE, mutator, null,
    { label: label || 'updateSnapshots', defaultValue: {} });
}

// ── Fetch helper ──────────────────────────────────────────────────────────────
function fetchJSON(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function handle(req, res, pathname, ctx) {
  const { requireAuth, db, JSON_CT, parseBirdnetConf } = ctx;

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC API — exposed to peer stations (no auth required)
  // ══════════════════════════════════════════════════════════════════════════

  // ── GET /api/public/station-info ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/public/station-info') {
    (async () => {
      try {
        const conf = await parseBirdnetConf();
        // Raw table for global counts (VIEW is 200× slower on full scans)
        const totalDet = db.prepare('SELECT COUNT(*) as n FROM detections').get().n;
        const totalSp = db.prepare('SELECT COUNT(DISTINCT Sci_Name) as n FROM detections').get().n;
        const lastDate = db.prepare('SELECT MAX(Date) as d FROM active_detections').get().d;
        const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          name: conf.STATION_NAME || 'BirdStation',
          location: { lat: parseFloat(conf.LATITUDE) || null, lon: parseFloat(conf.LONGITUDE) || null },
          version: pkg.version,
          totalDetections: totalDet,
          totalSpecies: totalSp,
          lastDetectionDate: lastDate,
          uptime: process.uptime(),
        }));
      } catch(e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── GET /api/public/summary?date=... ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/public/summary') {
    const qs = new URL(req.url, 'http://x').searchParams;
    const date = qs.get('date') || new Date().toISOString().split('T')[0];
    try {
      const rows = db.prepare(`
        SELECT SUM(count) as total, COUNT(DISTINCT sci_name) as species, ROUND(AVG(avg_conf),3) as avg_conf
        FROM daily_stats WHERE date = ?
      `).get(date);
      const top = db.prepare(`
        SELECT com_name, sci_name, count as total FROM daily_stats
        WHERE date = ? ORDER BY count DESC LIMIT 5
      `).all(date);

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ date, ...(rows || { total: 0, species: 0 }), topSpecies: top }));
    } catch(e) {
      res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── GET /api/public/species?date=... ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/public/species') {
    const qs = new URL(req.url, 'http://x').searchParams;
    const date = qs.get('date') || new Date().toISOString().split('T')[0];
    try {
      const rows = db.prepare(`
        SELECT com_name, sci_name, count as total, avg_conf, first_time, last_time
        FROM daily_stats WHERE date = ? ORDER BY count DESC
      `).all(date);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(rows));
    } catch(e) {
      res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNAL API — station management (auth required for writes)
  // ══════════════════════════════════════════════════════════════════════════

  // ── GET /api/stations ─────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/stations') {
    const stations = loadStations();
    res.writeHead(200, JSON_CT);
    res.end(JSON.stringify(stations));
    return true;
  }

  // ── POST /api/stations ────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/stations') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id, name, url: stUrl } = JSON.parse(body);
        if (!id || !name || !stUrl) { res.writeHead(400, JSON_CT); res.end('{"error":"id, name, url required"}'); return; }
        const entry = { id, name, url: stUrl.replace(/\/+$/, ''), addedAt: new Date().toISOString() };
        await updateStations((stations) => {
          const existing = stations.findIndex(s => s.id === id);
          if (existing >= 0) stations[existing] = { ...stations[existing], ...entry };
          else stations.push(entry);
          return stations;
        }, 'POST /api/stations');
        res.writeHead(200, JSON_CT); res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message })); }
    });
    return true;
  }

  // ── DELETE /api/stations/:id ──────────────────────────────────────────────
  if (req.method === 'DELETE' && pathname.startsWith('/api/stations/')) {
    if (!requireAuth(req, res)) return true;
    const id = pathname.split('/').pop();
    (async () => {
      try {
        await updateStations(
          (stations) => stations.filter(s => s.id !== id),
          'DELETE /api/stations/:id'
        );
        res.writeHead(200, JSON_CT); res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message })); }
    })();
    return true;
  }

  // ── POST /api/stations/:id/sync ───────────────────────────────────────────
  if (req.method === 'POST' && pathname.match(/^\/api\/stations\/[^/]+\/sync$/)) {
    if (!requireAuth(req, res)) return true;
    const id = pathname.split('/')[3];
    (async () => {
      try {
        // Read just to validate the station exists. We re-read inside the
        // updater so we don't lose changes from a concurrent add/delete.
        const stationsForCheck = loadStations();
        const station = stationsForCheck.find(s => s.id === id);
        if (!station) { res.writeHead(404, JSON_CT); res.end('{"error":"Station not found"}'); return; }

        const date = new Date().toISOString().split('T')[0];
        const [info, summary] = await Promise.allSettled([
          fetchJSON(`${station.url}/api/public/station-info`),
          fetchJSON(`${station.url}/api/public/summary?date=${date}`),
        ]);

        await updateSnapshots((snaps) => {
          if (!snaps[id]) snaps[id] = {};
          snaps[id][date] = {
            info: info.status === 'fulfilled' ? info.value : null,
            summary: summary.status === 'fulfilled' ? summary.value : null,
            fetchedAt: new Date().toISOString(),
          };
          // Keep only last 30 days
          const keys = Object.keys(snaps[id]).sort();
          if (keys.length > 30) { for (const k of keys.slice(0, keys.length - 30)) delete snaps[id][k]; }
          return snaps;
        }, 'POST /api/stations/:id/sync (snapshots)');

        if (info.status === 'fulfilled') {
          await updateStations((stations) => {
            const s = stations.find(x => x.id === id);
            if (s) {
              s.lastSync = new Date().toISOString();
              s.lat = info.value.location?.lat;
              s.lon = info.value.location?.lon;
              s.version = info.value.version;
            }
            return stations;
          }, 'POST /api/stations/:id/sync (metadata)');
        }

        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({ ok: true, info: info.value || null, summary: summary.value || null }));
      } catch(e) { res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message })); }
    })();
    return true;
  }

  // ── GET /api/network/overview ─────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/network/overview') {
    (async () => {
      try {
        const stations = loadStations();
        const snaps = loadSnapshots();
        const date = new URL(req.url, 'http://x').searchParams.get('date') || new Date().toISOString().split('T')[0];

        // Add local station data
        const localSummary = db.prepare(`
          SELECT SUM(count) as total, COUNT(DISTINCT sci_name) as species
          FROM daily_stats WHERE date = ?
        `).get(date);
        const conf = await parseBirdnetConf();

        const overview = {
          date,
          local: {
            name: conf.STATION_NAME || 'BirdStation',
            lat: parseFloat(conf.LATITUDE) || null,
            lon: parseFloat(conf.LONGITUDE) || null,
            ...(localSummary || { total: 0, species: 0 }),
          },
          peers: stations.map(s => ({
            ...s,
            snapshot: snaps[s.id]?.[date] || null,
          })),
        };

        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify(overview));
      } catch(e) { res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message })); }
    })();
    return true;
  }

  return false;
}

// ── Background sync (every 30 min) ──────────────────────────────────────────
let _syncTimer = null;

function startBackgroundSync(db, parseBirdnetConf) {
  if (_syncTimer) clearInterval(_syncTimer);
  _syncTimer = setInterval(async () => {
    // Snapshot the station list at the START of the cycle so we know what
    // to fetch. We do NOT keep this list to write back later — that was
    // the bug: a station added by the user mid-cycle would be wiped on
    // save. Instead, all writes go through updateStations/updateSnapshots
    // which re-read fresh state inside the per-file lock.
    const initial = loadStations();
    if (!initial.length) return;
    const date = new Date().toISOString().split('T')[0];

    const fetched = {};   // id → { info, summary }
    for (const station of initial) {
      try {
        const [info, summary] = await Promise.allSettled([
          fetchJSON(`${station.url}/api/public/station-info`),
          fetchJSON(`${station.url}/api/public/summary?date=${date}`),
        ]);
        fetched[station.id] = {
          info: info.status === 'fulfilled' ? info.value : null,
          summary: summary.status === 'fulfilled' ? summary.value : null,
        };
      } catch(e) { /* silent */ }
    }

    // Now apply the fetched data via fresh-read updaters so any
    // concurrent user mutation is preserved.
    await updateSnapshots((snaps) => {
      for (const [id, data] of Object.entries(fetched)) {
        if (!snaps[id]) snaps[id] = {};
        snaps[id][date] = {
          info: data.info,
          summary: data.summary,
          fetchedAt: new Date().toISOString(),
        };
      }
      return snaps;
    }, 'background-sync (snapshots)').catch(() => {});

    await updateStations((stations) => {
      for (const s of stations) {
        const data = fetched[s.id];
        if (data && data.info) {
          s.lastSync = new Date().toISOString();
          s.lat = data.info.location?.lat;
          s.lon = data.info.location?.lon;
        }
      }
      return stations;
    }, 'background-sync (metadata)').catch(() => {});
  }, 30 * 60 * 1000);
}

function stopBackgroundSync() {
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
}

module.exports = { handle, startBackgroundSync, stopBackgroundSync };
