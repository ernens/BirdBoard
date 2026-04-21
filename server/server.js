#!/usr/bin/env node
/**
 * BIRDASH — Backend API
 * Expose birds.db (SQLite) via HTTP POST /api/query
 * Port 7474 — proxifié par Caddy sous /birds/api/
 */

const http = require('http');
const fs   = require('fs');

// ── Modules ──────────────────────────────────────────────────────────────────
const { BIRDNET_CONF, BIRDNET_DIR, ALLOWED_SERVICES, SETTINGS_VALIDATORS,
        parseBirdnetConf, writeBirdnetConf, execCmd } = require('./lib/config');
const { db, dbWrite, birdashDb, taxonomyDb, SONGS_DIR,
        EBIRD_API_KEY, EBIRD_REGION, BW_STATION_ID,
        aggregates, refreshTaxonomy, closeAll: closeAllDbs } = require('./lib/db');
const _alerts        = require('./lib/alerts');
const _backupRoutes  = require('./routes/backup');
const _timelineRoutes = require('./routes/timeline');
const _systemRoutes  = require('./routes/system');
const _whatsNewRoutes = require('./routes/whats-new');
const _dataRoutes    = require('./routes/data');
const _detectionRoutes = require('./routes/detections');
const _audioRoutes   = require('./routes/audio');
const _photoRoutes   = require('./routes/photos');
const _externalRoutes = require('./routes/external');
const _settingsRoutes = require('./routes/settings');
const _comparisonRoutes = require('./routes/comparison');
const _updateRoutes  = require('./routes/updates');
const _bugReportRoutes = require('./routes/bug-report');
const _telemetryRoutes = require('./routes/telemetry');
const _powerRoutes   = require('./routes/power');
const _tftDisplayRoutes = require('./routes/tft-display');
const _telemetry = require('./lib/telemetry');
const _notifWatcher = require('./lib/notification-watcher');
const _weatherWatcher = require('./lib/weather-watcher');
const _weeklyDigest = require('./lib/weekly-digest');
const _mqttPublisher = require('./lib/mqtt-publisher');
const _metrics = require('./lib/metrics');
const _metricsRoutes = require('./routes/metrics');
const _auth = require('./lib/auth');
const _authRoutes = require('./routes/auth');
const _rangeFilterRoutes = require('./routes/range-filter');
const _soundLevelRoutes = require('./routes/sound-level');

const JSON_CT = { 'Content-Type': 'application/json' };

// ── Response helpers (reduce boilerplate in route handlers) ──────────────
function jsonOk(res, data) { res.writeHead(200, JSON_CT); res.end(JSON.stringify(data)); }
function jsonErr(res, code, msg) { res.writeHead(code, JSON_CT); res.end(JSON.stringify({ error: msg })); }
const PORT    = process.env.BIRDASH_PORT || 7474;

// ── Security ─────────────────────────────────────────────────────────────────
const API_TOKEN = process.env.BIRDASH_API_TOKEN || '';
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com https://cdn.jsdelivr.net",
  "img-src 'self' blob: data: https://upload.wikimedia.org https://live.staticflickr.com https://images.unsplash.com https://inaturalist-open-data.s3.amazonaws.com",
  "connect-src 'self'",
  "frame-ancestors 'self'",
].join('; ');

// ── SQL validation ───────────────────────────────────────────────────────────
const ALLOWED_START   = /^\s*(SELECT|PRAGMA|WITH)\s/i;
const FORBIDDEN       = /(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|ATTACH|DETACH|REINDEX|VACUUM)\s/i;
const FORBIDDEN_CHARS = /;/;

function validateQuery(sql) {
  if (!sql || typeof sql !== 'string') return false;
  if (sql.length > 4000)               return false;
  if (!ALLOWED_START.test(sql))        return false;
  const stripped = sql.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
  if (FORBIDDEN.test(stripped))        return false;
  if (FORBIDDEN_CHARS.test(stripped))  return false;
  return true;
}

// ── CORS ─────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.BIRDASH_CORS_ORIGINS || '').split(',').filter(Boolean);

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  if (ALLOWED_ORIGINS.length === 0) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
    return null;
  }
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) return origin;
  return null;
}

// ── Rate limiter ─────────────────────────────────────────────────────────────
const _rateBuckets = new Map();
const RATE_WINDOW  = 60 * 1000;
const RATE_MAX     = 300;
const _rateBucketCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of _rateBuckets) {
    if (now - b.ts > RATE_WINDOW * 2) _rateBuckets.delete(ip);
  }
}, 5 * 60 * 1000);

function rateLimit(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = _rateBuckets.get(ip);
  if (!bucket || now - bucket.ts > RATE_WINDOW) {
    bucket = { count: 0, ts: now };
    _rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > RATE_MAX;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
function requireAuth(req, res) {
  if (!API_TOKEN) return true;
  const auth = req.headers['authorization'] || '';
  if (auth === `Bearer ${API_TOKEN}`) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized — set Authorization: Bearer <token> header' }));
  return false;
}
if (!API_TOKEN) console.warn('[BIRDASH] WARNING: No BIRDASH_API_TOKEN set — write endpoints are unprotected. Set Environment=BIRDASH_API_TOKEN=... in birdash.service for production.');

// ── JSON file helpers ────────────────────────────────────────────────────────
const safeConfig = require('./lib/safe-config');
const { readJsonFile } = require('./lib/config');
// Legacy synchronous helper kept only for code paths that can't yet be made
// async (e.g. periodic background tasks). All new writes — and any
// read-modify-write cycle from a route handler — MUST go through
// safeConfig.updateConfig / writeRaw so the per-file mutex is honoured.
function writeJsonFileAtomic(p, data) {
  const tmp = p + '.' + process.pid + '.' + Date.now() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

// ── Start subsystems ─────────────────────────────────────────────────────────
_alerts.startAlerts({ db, execCmd, parseBirdnetConf, ALLOWED_SERVICES });
setTimeout(() => refreshTaxonomy().catch(e => console.error('[BIRDASH] Taxonomy refresh error:', e.message)), 3000);
// eBird regional frequency — determines "is this species rare?" from actual
// ornithological data instead of the naive "≤3 local observations" heuristic
// that flagged Blackbirds as rare on every fresh install.
const ebirdFreq = require('./lib/ebird-frequency');
// Prefer birdnet.conf (UI-editable) over env/local for the API key so changes
// in Settings propagate without a service restart.
async function _resolveEbirdKey() {
  try {
    const conf = await parseBirdnetConf();
    return (conf.EBIRD_API_KEY || '').trim() || EBIRD_API_KEY || '';
  } catch { return EBIRD_API_KEY || ''; }
}
async function _reloadEbirdFreq({ force = false } = {}) {
  const conf = await parseBirdnetConf();
  const lat = parseFloat(conf.LATITUDE || '0');
  const lon = parseFloat(conf.LONGITUDE || '0');
  const apiKey = (conf.EBIRD_API_KEY || '').trim() || EBIRD_API_KEY || '';
  return force
    ? ebirdFreq.refresh(lat, lon, apiKey)
    : ebirdFreq.loadFrequency(lat, lon, apiKey);
}
setTimeout(() => {
  _reloadEbirdFreq().catch(e => console.warn('[BIRDASH] eBird frequency init:', e.message));
}, 4000);
// Daily refresh — the regional species list shifts with seasons (migrants).
setInterval(() => {
  _reloadEbirdFreq({ force: true }).catch(e => console.warn('[BIRDASH] eBird daily refresh:', e.message));
}, 24 * 3600 * 1000);
// Pre-aggregated stats: smart rebuild on startup.
// Full rebuild takes ~14s on 1M+ rows and BLOCKS the event loop (better-sqlite3
// is synchronous), causing 502s for every request during that window. So we
// only do a full rebuild when the aggregates are empty or stale (migration,
// first boot). Otherwise we just refresh today's data (~200ms) and start the
// 5-min periodic timer. The sentinel file .rebuild-aggregates forces a full
// rebuild (created by migration 004).
setTimeout(() => {
  try {
    const fs = require('fs');
    const sentinelPath = require('path').join(__dirname, '..', 'config', '.rebuild-aggregates');
    const hasSentinel = fs.existsSync(sentinelPath);
    const aggCount = dbWrite.prepare('SELECT COUNT(*) as n FROM daily_stats').get().n;

    if (aggCount === 0 || hasSentinel) {
      console.log(`[BIRDASH] Full aggregate rebuild needed (rows=${aggCount}, sentinel=${hasSentinel})`);
      aggregates.rebuildAll(dbWrite);
      try { fs.unlinkSync(sentinelPath); } catch {}
    } else {
      // Just refresh today — fast (~200ms), no event-loop block
      aggregates.refreshToday(dbWrite);
      console.log('[BIRDASH] Aggregates: refreshToday only (full rebuild skipped, ' + aggCount + ' rows already present)');
    }
  } catch(e) { console.error('[BIRDASH] Aggregate error:', e.message); }
  aggregates.startPeriodicRefresh(dbWrite);
}, 2000);
// Telemetry: opt-in daily reports to Supabase
_telemetry.startDailyCron(db, parseBirdnetConf);
// Notification watcher: polls detections, sends via Apprise
_notifWatcher.start(db, birdashDb, parseBirdnetConf, ebirdFreq);
// Weather watcher: hourly Open-Meteo snapshots so detections can show
// the weather context they were recorded in.
_weatherWatcher.start(birdashDb, parseBirdnetConf);
// Weekly digest: every Monday 08:00 local (opt-in via NOTIFY_DIGEST_ENABLED)
_weeklyDigest.startWeeklyDigestCron(db, parseBirdnetConf);
// MQTT publisher: opt-in (MQTT_ENABLED=1), publishes detections to a broker
_mqttPublisher.start(db, parseBirdnetConf);
// Prometheus metrics: lazily refreshed on each scrape of /metrics
_metrics.init({ db, execCmd, parseBirdnetConf });
// Auth: cookie sessions, opt-in (AUTH_MODE in birdnet.conf). Init is
// async (eager AUTH_SECRET generation) — until it resolves, gate falls
// back to mode='off', which matches pre-feature behaviour. Safe.
_auth.init({ parseBirdnetConf, writeBirdnetConf })
  .then(() => console.log(`[auth] mode=${_auth.getConfig().mode}`))
  .catch(e => console.error('[auth] init failed:', e.message));

// ── Route context ────────────────────────────────────────────────────────────
const _routeCtx = {
  requireAuth, execCmd, readJsonFile, writeJsonFileAtomic, JSON_CT, jsonOk, jsonErr,
  safeConfig, ebirdFreq, reloadEbirdFreq: _reloadEbirdFreq,
  db, dbWrite, birdashDb, taxonomyDb, parseBirdnetConf, SONGS_DIR,
  ALLOWED_SERVICES, BIRDNET_DIR, validateQuery,
  photoCacheKey: _photoRoutes.photoCacheKey, PHOTO_CACHE_DIR: _photoRoutes.PHOTO_CACHE_DIR,
  writeBirdnetConf, SETTINGS_VALIDATORS, BIRDNET_CONF, _alerts,
  EBIRD_API_KEY, EBIRD_REGION, BW_STATION_ID,
};

// ── HTTP server ──────────────────────────────────────────────────────────────
const MAX_BODY_SIZE = 1024 * 1024;

const server = http.createServer((req, res) => {
  if (req.method === 'POST') {
    let bodySize = 0;
    let bodyLimited = false;
    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE && !bodyLimited) {
        bodyLimited = true;
        req.removeAllListeners('data');
        req._aborted = true;
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
        }
      }
    });
    req._bodyLimited = () => bodyLimited;
  }

  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // CORS
  const allowedOrigin = getCorsOrigin(req);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (rateLimit(req)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Too many requests' }));
    return;
  }
  if (req._aborted) return;

  const pathname = req.url.split('?')[0].replace(/\/$/, '') || '/';
  if (!pathname.startsWith('/api/')) res.setHeader('Content-Security-Policy', CSP);
  console.log(`[BIRDASH] ${req.method} ${req.url} → pathname: ${pathname}`);

  // ── Auth gate (synchronous, attaches req.user) ─────────────────────────
  // Returns false + responds 401 if the route requires auth and the
  // caller isn't authenticated. Sync to avoid losing POST body chunks
  // between the body-size listener and the route handler's own listener.
  if (!_auth.gate(req, res, pathname)) return;

  // ── Route delegations ──────────────────────────────────────────────────
  if (_authRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_photoRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_audioRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_backupRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_timelineRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_systemRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_whatsNewRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_dataRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_detectionRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_externalRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_settingsRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_comparisonRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_updateRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_bugReportRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_telemetryRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_powerRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_tftDisplayRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_metricsRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_rangeFilterRoutes.handle(req, res, pathname, _routeCtx)) return;
  if (_soundLevelRoutes.handle(req, res, pathname, _routeCtx)) return;

  console.warn(`[BIRDASH] 404 — route inconnue : ${req.method} ${pathname}`);
  if (res.headersSent) return;
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Route inconnue : ${req.method} ${pathname}` }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[BIRDASH] API démarrée sur http://127.0.0.1:${PORT}`);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────
function gracefulShutdown() {
  _alerts.stopAlerts();
  if (_rateBucketCleanup) clearInterval(_rateBucketCleanup);
  _backupRoutes.shutdown();
  _audioRoutes.shutdown();
  _whatsNewRoutes.shutdown();
  _telemetry.stopDailyCron();
  _notifWatcher.stop();
  _weatherWatcher.stop();
  _mqttPublisher.stop();
  closeAllDbs();
  process.exit(0);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT',  gracefulShutdown);
