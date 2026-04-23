/**
 * BIRDASH — Route smoke tests
 *
 * One GET per page-loadbearing endpoint, asserting the route is *registered*
 * and doesn't throw a 5xx on an empty database. Catches the regression we
 * hit twice:
 *   - "Route inconnue : GET /api/quality" (route file forgotten in
 *     server.js dispatcher)
 *   - hasUpdate=true on equal commits (handler returning a wrong shape)
 *
 * Doesn't validate response bodies — that's the job of feature tests in
 * server.test.js. The signal here is "the wiring still works" across all
 * the pages.
 *
 * Server boot is shared with server.test.js via spawn — node:test's test
 * runner runs files in separate processes, so they don't conflict.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 17475;  // distinct from server.test.js (17474) to avoid collision
let serverProc = null;

before(async () => {
  serverProc = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, BIRDASH_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 8000);
    let stderr = '';
    serverProc.stderr.on('data', c => { stderr += c; });
    serverProc.stdout.on('data', (data) => {
      if (data.toString().includes('API')) { clearTimeout(timeout); resolve(); }
    });
    serverProc.on('error', (err) => { clearTimeout(timeout); reject(err); });
    serverProc.on('exit', (code) => {
      if (code !== null && code !== 0) { clearTimeout(timeout); reject(new Error(`Exit ${code}: ${stderr}`)); }
    });
  });
});

after(() => { if (serverProc) serverProc.kill('SIGTERM'); });

function get(reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: reqPath, method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => resolve({ status: res.statusCode, data }));
      });
    req.on('error', reject);
    req.end();
  });
}

// Page-loadbearing GET endpoints. Each must be registered and not 5xx
// on an empty DB. Some endpoints might 401 (auth-protected) or 404
// (resource missing) — both are valid signals of "route exists".
//
// Anything returning 500 means the handler crashed on the empty fixture
// path — surfaces real wiring bugs.
const ENDPOINTS = [
  // Core / global
  '/api/health',
  '/api/settings',
  '/api/auth/status',
  '/api/hardware',
  '/api/network-info',
  '/api/system-health',
  '/api/services',
  '/api/analysis-status',
  // Data (note: /api/detections is DELETE-only; pages fetch via POST /api/query)
  '/api/flagged-detections?limit=5',
  '/api/rare-today',
  '/api/comparison/weekly',
  '/api/seasons/report',
  '/api/model-comparison',
  // Cockpit / quality
  '/api/quality',
  // Audio
  '/api/audio-device',
  '/api/audio/config',
  '/api/audio/adaptive-gain/state',
  // Favorites / purge
  '/api/favorites',
  '/api/favorites/stats',
  '/api/purge/stats',
  '/api/purge/list?limit=5',
  // Settings dependencies
  '/api/species-lists',
  '/api/birdweather/status',
  '/api/apprise',
  '/api/alert-thresholds',
  '/api/alert-status',
  '/api/alerts/history?limit=5',
  '/api/backup-status',
  '/api/backup-history',
  '/api/backup-config',
  '/api/backup-schedule',
  // Update / system
  '/api/update-status',
  '/api/bug-report/status',
  '/api/telemetry/status',
  // Setup wizard
  '/api/setup/status',
  '/api/setup/hardware-profile',
];

describe('Route smoke — every page-essential GET responds without 5xx', () => {
  for (const ep of ENDPOINTS) {
    it(`GET ${ep}`, async () => {
      const res = await get(ep);
      // 5xx = the route exists but the handler crashed on empty fixture.
      // 404 with the server's "Route inconnue" body = route NOT registered
      // (the regression we want to catch).
      const isUnknownRoute = res.status === 404 && res.data.includes('Route inconnue');
      assert.ok(!isUnknownRoute, `route not registered: ${ep}`);
      assert.ok(res.status < 500, `5xx from ${ep}: ${res.status} ${res.data.slice(0, 200)}`);
    });
  }
});
