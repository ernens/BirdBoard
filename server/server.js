#!/usr/bin/env node
/**
 * BIRDASH — Backend API
 * Expose birds.db (SQLite) via HTTP POST /api/query
 * Port 7474 — proxifié par Caddy sous /birds/api/
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const { spawn } = require('child_process');

// --- Dépendance : better-sqlite3 (npm install better-sqlite3)
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('[BIRDASH] better-sqlite3 non trouvé. Exécute : npm install better-sqlite3');
  process.exit(1);
}

const https = require('https');
const SunCalc = require('suncalc');
const _backupRoutes = require('./routes/backup');
const _alerts = require('./lib/alerts');
const _timelineRoutes = require('./routes/timeline');
const _systemRoutes = require('./routes/system');
const _whatsNewRoutes = require('./routes/whats-new');
const _dataRoutes = require('./routes/data');
const _detectionRoutes = require('./routes/detections');
const _audioRoutes = require('./routes/audio');
const _photoRoutes = require('./routes/photos');
const _externalRoutes = require('./routes/external');
const _settingsRoutes = require('./routes/settings');

const JSON_CT = { 'Content-Type': 'application/json' };

// --- Configuration
const PORT      = process.env.BIRDASH_PORT || 7474;
const DB_PATH   = process.env.BIRDASH_DB   || path.join(
  process.env.HOME, 'birdash', 'data', 'birds.db'
);
const SONGS_DIR = process.env.BIRDASH_SONGS_DIR || path.join(
  process.env.HOME, 'BirdSongs', 'Extracted', 'By_Date'
);

// ── Security ─────────────────────────────────────────────────────────────────
// Optional API token for write operations (POST/DELETE).
// If set, mutating endpoints require: Authorization: Bearer <token>
const API_TOKEN = process.env.BIRDASH_API_TOKEN || '';

// Content-Security-Policy — restrict what the browser can load
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// ── Settings helpers ────────────────────────────────────────────────────────
const BIRDNET_CONF = '/etc/birdnet/birdnet.conf';
const _birdashEngine = path.join(process.env.HOME, 'birdash', 'engine');
const _birdengine = path.join(process.env.HOME, 'birdengine');
// Use birdengine if it has .tflite models, otherwise fall back to birdash/engine
const _hasModels = (dir) => { try { return fs.readdirSync(path.join(dir, 'models')).some(f => f.endsWith('.tflite')); } catch { return false; } };
const BIRDNET_DIR = _hasModels(_birdengine) ? _birdengine : _hasModels(_birdashEngine) ? _birdashEngine : _birdengine;

// Parse birdnet.conf → { KEY: value } — cached 60s
let _birdnetConfCache = null;
let _birdnetConfTs = 0;
const BIRDNET_CONF_TTL = 60 * 1000;

async function parseBirdnetConf() {
  const now = Date.now();
  if (_birdnetConfCache && (now - _birdnetConfTs) < BIRDNET_CONF_TTL) {
    return _birdnetConfCache;
  }
  const raw = await fsp.readFile(BIRDNET_CONF, 'utf8');
  const conf = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    conf[key] = val;
  }
  _birdnetConfCache = conf;
  _birdnetConfTs = now;
  return conf;
}

// Write updates to birdnet.conf (preserves comments, ordering, creates backup)
async function writeBirdnetConf(updates) {
  // Backup first
  await fsp.copyFile(BIRDNET_CONF, BIRDNET_CONF + '.bak').catch(() => {});
  const raw = await fsp.readFile(BIRDNET_CONF, 'utf8');
  const lines = raw.split('\n');
  const written = new Set();
  const result = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key in updates) {
      written.add(key);
      const val = updates[key];
      // Quote if contains spaces or special chars
      const needsQuote = /[\s#"'$]/.test(String(val));
      return needsQuote ? `${key}="${val}"` : `${key}=${val}`;
    }
    return line;
  });
  // Append keys that weren't already in the file
  for (const key of Object.keys(updates)) {
    if (!written.has(key)) {
      const val = updates[key];
      const needsQuote = /[\s#"'$]/.test(String(val));
      result.push(needsQuote ? `${key}="${val}"` : `${key}=${val}`);
      written.add(key);
    }
  }
  // Write via temp file + sudo cp
  const tmpFile = '/tmp/birdnet.conf.tmp';
  await fsp.writeFile(tmpFile, result.join('\n'));
  await execCmd('sudo', ['cp', tmpFile, BIRDNET_CONF]);
  await fsp.unlink(tmpFile).catch(() => {});
}

// Execute a command, return stdout
function execCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `exit ${code}`)));
  });
}

// Validation whitelist for settings
const SETTINGS_VALIDATORS = {
  SITE_NAME:       v => typeof v === 'string' && v.length <= 100,
  SITE_BRAND:      v => typeof v === 'string' && v.length <= 50,
  LATITUDE:        v => !isNaN(v) && v >= -90 && v <= 90,
  LONGITUDE:       v => !isNaN(v) && v >= -180 && v <= 180,
  MODEL:           v => typeof v === 'string' && /^[a-zA-Z0-9_.\-]+$/.test(v),
  SF_THRESH:       v => !isNaN(v) && v >= 0 && v <= 1,
  CONFIDENCE:      v => !isNaN(v) && v >= 0.01 && v <= 0.99,
  BIRDNET_CONFIDENCE: v => !isNaN(v) && v >= 0.01 && v <= 0.99,
  PERCH_CONFIDENCE:   v => !isNaN(v) && v >= 0.01 && v <= 0.99,
  PERCH_MIN_MARGIN:   v => !isNaN(v) && v >= 0 && v <= 0.5,
  SENSITIVITY:     v => !isNaN(v) && v >= 0.5 && v <= 1.5,
  OVERLAP:         v => !isNaN(v) && v >= 0 && v <= 2.9,
  RECORDING_LENGTH: v => !isNaN(v) && v >= 6 && v <= 120,
  EXTRACTION_LENGTH: v => v === '' || (!isNaN(v) && v >= 3 && v <= 30),
  AUDIOFMT:        v => ['mp3','wav','flac','ogg'].includes(v),
  CHANNELS:        v => v == 1 || v == 2,
  DATABASE_LANG:   v => /^[a-z]{2}(_[A-Z]{2})?$/.test(v),
  BIRDWEATHER_ID:  v => typeof v === 'string' && v.length <= 64,
  FULL_DISK:       v => ['purge','keep'].includes(v),
  PURGE_THRESHOLD: v => !isNaN(v) && v >= 50 && v <= 99,
  MAX_FILES_SPECIES: v => !isNaN(v) && v >= 0,
  PRIVACY_THRESHOLD: v => !isNaN(v) && v >= 0 && v <= 3,
  DUAL_MODEL_ENABLED: v => v == 0 || v == 1,
  SECONDARY_MODEL: v => typeof v === 'string' && v.length <= 100,
  NOTIFY_RARE_SPECIES: v => v == 0 || v == 1,
  NOTIFY_RARE_THRESHOLD: v => !isNaN(v) && v >= 1 && v <= 1000,
  NOTIFY_FIRST_SEASON: v => v == 0 || v == 1,
  NOTIFY_FAVORITES:    v => v == 0 || v == 1,
  NOTIFY_SEASON_DAYS: v => !isNaN(v) && v >= 7 && v <= 365,
  AUDIO_RETENTION_DAYS: v => !isNaN(v) && v >= 7 && v <= 365,
  NOTIFY_ENABLED: v => v == 0 || v == 1,
  REC_CARD:        v => typeof v === 'string' && v.length <= 200,
  RTSP_STREAM:     v => typeof v === 'string' && v.length <= 500,
  APPRISE_NOTIFY_EACH_DETECTION: v => v == 0 || v == 1,
  APPRISE_NOTIFY_NEW_SPECIES: v => v == 0 || v == 1,
  APPRISE_NOTIFY_NEW_SPECIES_EACH_DAY: v => v == 0 || v == 1,
  APPRISE_WEEKLY_REPORT: v => v == 0 || v == 1,
  APPRISE_NOTIFICATION_TITLE: v => typeof v === 'string' && v.length <= 200,
  APPRISE_NOTIFICATION_BODY: v => typeof v === 'string' && v.length <= 500,
  APPRISE_MINIMUM_SECONDS_BETWEEN_NOTIFICATIONS_PER_SPECIES: v => !isNaN(v) && v >= 0,
  BIRDASH_ALERT_TEMP_WARN: v => !isNaN(v) && v >= 30 && v <= 100,
  BIRDASH_ALERT_TEMP_CRIT: v => !isNaN(v) && v >= 30 && v <= 100,
  BIRDASH_ALERT_DISK_WARN: v => !isNaN(v) && v >= 30 && v <= 99,
  BIRDASH_ALERT_DISK_CRIT: v => !isNaN(v) && v >= 30 && v <= 99,
  BIRDASH_ALERT_RAM_WARN:  v => !isNaN(v) && v >= 30 && v <= 99,
  BIRDASH_ALERT_BACKLOG:   v => !isNaN(v) && v >= 1 && v <= 1000,
  BIRDASH_ALERT_NO_DET_H:  v => !isNaN(v) && v >= 1 && v <= 168,
  BIRDASH_ALERT_ON_TEMP:      v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_TEMP_CRIT: v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_DISK:      v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_RAM:       v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_BACKLOG:   v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_NO_DET:    v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_INFLUX:    v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_MISSING:   v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_RARE_VISITOR: v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_SVC_DOWN: v => v == 0 || v == 1,
  IMAGE_PROVIDER:  v => ['WIKIPEDIA','FLICKR'].includes(v),
  RARE_SPECIES_THRESHOLD: v => !isNaN(v) && v >= 1 && v <= 365,
  RAW_SPECTROGRAM: v => v == 0 || v == 1,
  DATA_MODEL_VERSION: v => v == 1 || v == 2,
};

// ── Backup cron helper ────────────────────────────────────────────────────────
// Allowed services for restart
const ALLOWED_SERVICES = ['birdengine', 'birdengine-recording', 'birdash', 'caddy', 'ttyd'];

// Charger la config locale (birdash-local.js) si disponible
// — silencieux si le fichier n'existe pas (installation fraîche)
let _localConfig = {};
try {
  const fs_test = require('fs');
  const localPath = require('path').join(__dirname, '..', 'public', 'js', 'birdash-local.js');
  if (fs_test.existsSync(localPath)) {
    _localConfig = require(localPath);
    console.log('[BIRDASH] Config locale chargée : birdash-local.js');
  }
} catch(e) {
  console.warn('[BIRDASH] birdash-local.js non chargé :', e.message);
}

// Clé API eBird — configurable via birdash-local.js (ebirdApiKey)
// ou variable d'environnement EBIRD_API_KEY
const EBIRD_API_KEY  = process.env.EBIRD_API_KEY  || _localConfig.ebirdApiKey        || '';
const EBIRD_REGION   = (_localConfig.location && _localConfig.location.region) || 'BE';
const BW_STATION_ID  = process.env.BW_STATION_ID  || _localConfig.birdweatherStationId || '';

// Bootstrap DB if missing (fresh install)
if (!fs.existsSync(DB_PATH)) {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  console.log(`[BIRDASH] Creating new birds.db at ${DB_PATH}`);
  const initDb = new Database(DB_PATH);
  initDb.exec(`CREATE TABLE IF NOT EXISTS detections (
    Date DATE, Time TIME, Sci_Name VARCHAR(100) NOT NULL, Com_Name VARCHAR(100) NOT NULL,
    Confidence FLOAT, Lat FLOAT, Lon FLOAT, Cutoff FLOAT,
    Week INT, Sens FLOAT, Overlap FLOAT, File_Name VARCHAR(100) NOT NULL, Model VARCHAR(50)
  )`);
  initDb.exec('CREATE INDEX IF NOT EXISTS idx_date_time ON detections(Date, Time DESC)');
  initDb.exec('CREATE INDEX IF NOT EXISTS idx_com_name ON detections(Com_Name)');
  initDb.exec('CREATE INDEX IF NOT EXISTS idx_sci_name ON detections(Sci_Name)');
  initDb.exec('CREATE INDEX IF NOT EXISTS idx_date_com ON detections(Date, Com_Name)');
  initDb.exec('CREATE INDEX IF NOT EXISTS idx_date_conf ON detections(Date, Confidence)');
  initDb.pragma('journal_mode = WAL');
initDb.pragma('busy_timeout = 5000');
  initDb.close();
  console.log('[BIRDASH] Empty birds.db created successfully');
}

// Ouvre en lecture seule (requêtes SELECT)
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');

// Connexion en écriture pour les suppressions uniquement
const dbWrite = new Database(DB_PATH, { fileMustExist: true });
dbWrite.pragma('journal_mode = WAL');
dbWrite.pragma('busy_timeout = 5000');

// Ensure indexes exist on existing databases
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_date_time ON detections(Date, Time DESC)');
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_com_name ON detections(Com_Name)');
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_sci_name ON detections(Sci_Name)');
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_date_com ON detections(Date, Com_Name)');
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_date_conf ON detections(Date, Confidence)');

// ── Favorites table ──────────────────────────────────────────────────────────
dbWrite.exec(`CREATE TABLE IF NOT EXISTS favorites (
  com_name TEXT PRIMARY KEY,
  sci_name TEXT,
  added_at TEXT DEFAULT (datetime('now'))
)`);

// ── Notes table ─────────────────────────────────────────────────────────────
dbWrite.exec(`CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  com_name TEXT NOT NULL,
  sci_name TEXT,
  date TEXT,
  time TEXT,
  note TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`);
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_notes_species ON notes(com_name)');
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(com_name, date)');

dbWrite.exec(`CREATE TABLE IF NOT EXISTS photo_preferences (
  sci_name TEXT NOT NULL,
  preferred_idx INTEGER DEFAULT 0,
  banned_urls TEXT DEFAULT '[]',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sci_name)
)`);

console.log(`[BIRDASH] birds.db ouvert : ${DB_PATH}`);

// ── Birdash validation database ──────────────────────────────────────────────
const BIRDASH_DB_PATH = path.join(process.env.HOME, 'birdash', 'birdash.db');
let birdashDb;
try {
  birdashDb = new Database(BIRDASH_DB_PATH);
  birdashDb.pragma('journal_mode = WAL');
  birdashDb.pragma('busy_timeout = 5000');
  birdashDb.exec(`CREATE TABLE IF NOT EXISTS validations (
    date       TEXT,
    time       TEXT,
    sci_name   TEXT,
    status     TEXT DEFAULT 'unreviewed',
    notes      TEXT DEFAULT '',
    updated_at TEXT,
    PRIMARY KEY(date, time, sci_name)
  )`);
  console.log(`[BIRDASH] birdash.db ouvert : ${BIRDASH_DB_PATH}`);
} catch(e) {
  console.error('[BIRDASH] birdash.db error:', e.message);
  birdashDb = null;
}

// ── Taxonomy database ─────────────────────────────────────────────────────────
const TAXONOMY_DB_PATH = path.join(__dirname, '..', 'config', 'taxonomy.db');
const TAXONOMY_CSV_URL = 'https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=csv&cat=species';
const TAXONOMY_CACHE_PATH = path.join(__dirname, '..', 'config', 'ebird-taxonomy.csv');
// Synonymes BirdNET → eBird (noms scientifiques qui diffèrent)
const TAXONOMY_SYNONYMS = {
  'Charadrius dubius': 'Thinornis dubius',
  'Corvus monedula': 'Coloeus monedula',
  'Carduelis carduelis': 'Carduelis carduelis',
};

let taxonomyDb;
try {
  taxonomyDb = new Database(TAXONOMY_DB_PATH);
  taxonomyDb.pragma('journal_mode = WAL');
  taxonomyDb.pragma('busy_timeout = 5000');
  taxonomyDb.exec(`CREATE TABLE IF NOT EXISTS species_taxonomy (
    sci_name    TEXT PRIMARY KEY,
    order_name  TEXT,
    family_sci  TEXT,
    family_com  TEXT,
    ebird_code  TEXT,
    taxon_order REAL
  )`);
  taxonomyDb.exec(`CREATE INDEX IF NOT EXISTS idx_tax_order ON species_taxonomy(order_name)`);
  taxonomyDb.exec(`CREATE INDEX IF NOT EXISTS idx_tax_family ON species_taxonomy(family_sci)`);
  taxonomyDb.exec(`CREATE TABLE IF NOT EXISTS family_translations (
    family_sci  TEXT NOT NULL,
    locale      TEXT NOT NULL,
    family_com  TEXT,
    PRIMARY KEY (family_sci, locale)
  )`);
  console.log('[BIRDASH] taxonomy.db ouvert');
} catch(e) {
  console.error('[BIRDASH] taxonomy.db error:', e.message);
  taxonomyDb = null;
}

// Download eBird taxonomy CSV and populate the taxonomy DB
async function refreshTaxonomy() {
  if (!taxonomyDb) return;
  const count = taxonomyDb.prepare('SELECT COUNT(*) as n FROM species_taxonomy').get().n;
  if (count > 1000) {
    console.log(`[BIRDASH] Taxonomy already populated (${count} species)`);
    console.log(`[BIRDASH] Family translations: ${taxonomyDb.prepare('SELECT COUNT(*) as n FROM family_translations').get().n} entries`);
    return;
  }

  console.log('[BIRDASH] Downloading eBird taxonomy...');
  let csvData;
  // Try cached file first
  try {
    const stat = await fsp.stat(TAXONOMY_CACHE_PATH);
    const age = Date.now() - stat.mtimeMs;
    if (age < 30 * 24 * 3600 * 1000) { // less than 30 days old
      csvData = await fsp.readFile(TAXONOMY_CACHE_PATH, 'utf8');
      console.log('[BIRDASH] Using cached eBird taxonomy CSV');
    }
  } catch(e) {}

  if (!csvData) {
    try {
      csvData = await new Promise((resolve, reject) => {
        https.get(TAXONOMY_CSV_URL, res => {
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve(data));
          res.on('error', reject);
        }).on('error', reject);
      });
      await fsp.writeFile(TAXONOMY_CACHE_PATH, csvData);
      console.log('[BIRDASH] eBird taxonomy downloaded and cached');
    } catch(e) {
      console.error('[BIRDASH] Failed to download eBird taxonomy:', e.message);
      return;
    }
  }

  // Parse CSV and populate DB
  const lines = csvData.split('\n');
  const header = lines[0];
  // Find column indices by header names
  const cols = header.split(',');
  const iSci = cols.indexOf('SCIENTIFIC_NAME');
  const iOrder = cols.indexOf('ORDER');
  const iFamCom = cols.indexOf('FAMILY_COM_NAME');
  const iFamSci = cols.indexOf('FAMILY_SCI_NAME');
  const iCode = cols.indexOf('SPECIES_CODE');
  const iTaxon = cols.indexOf('TAXON_ORDER');

  if (iSci < 0 || iOrder < 0) {
    console.error('[BIRDASH] eBird CSV format unrecognized');
    return;
  }

  const insert = taxonomyDb.prepare(
    'INSERT OR REPLACE INTO species_taxonomy (sci_name, order_name, family_sci, family_com, ebird_code, taxon_order) VALUES (?,?,?,?,?,?)'
  );
  const tx = taxonomyDb.transaction((rows) => { for (const r of rows) insert.run(...r); });

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Parse CSV respecting quoted fields
    const fields = [];
    let field = '', inQuote = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { fields.push(field); field = ''; continue; }
      field += ch;
    }
    fields.push(field);
    if (fields.length <= Math.max(iSci, iOrder, iFamSci, iFamCom)) continue;
    rows.push([
      fields[iSci], fields[iOrder], fields[iFamSci] || '', fields[iFamCom] || '',
      fields[iCode] || '', parseFloat(fields[iTaxon]) || 0
    ]);
  }
  tx(rows);

  // Add synonyms for BirdNET species that use different names
  const synInsert = taxonomyDb.prepare(
    'INSERT OR IGNORE INTO species_taxonomy (sci_name, order_name, family_sci, family_com, ebird_code, taxon_order) ' +
    'SELECT ?, order_name, family_sci, family_com, ebird_code, taxon_order FROM species_taxonomy WHERE sci_name = ?'
  );
  for (const [birdnet, ebird] of Object.entries(TAXONOMY_SYNONYMS)) {
    synInsert.run(birdnet, ebird);
  }

  console.log(`[BIRDASH] Taxonomy populated: ${rows.length} species`);

  console.log(`[BIRDASH] Family translations: ${taxonomyDb.prepare('SELECT COUNT(*) as n FROM family_translations').get().n} entries`);
}

// Populate taxonomy in background after startup
setTimeout(() => refreshTaxonomy().catch(e => console.error('[BIRDASH] Taxonomy refresh error:', e.message)), 3000);

// ══════════════════════════════════════════════════════════════════════════════

// Start alert monitoring system
_alerts.startAlerts({ db, execCmd, parseBirdnetConf, ALLOWED_SERVICES });

// --- Validation de sécurité
const ALLOWED_START = /^\s*(SELECT|PRAGMA|WITH)\s/i;
const FORBIDDEN     = /(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|ATTACH|DETACH|REINDEX|VACUUM)\s/i;
const FORBIDDEN_CHARS = /;/; // Interdit les requêtes multiples

function validateQuery(sql) {
  if (!sql || typeof sql !== 'string') return false;
  if (sql.length > 4000)               return false;
  if (!ALLOWED_START.test(sql))        return false;
  // Retirer les string literals avant de vérifier les mots-clés dangereux
  const stripped = sql.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
  if (FORBIDDEN.test(stripped))        return false;
  // Interdire les points-virgules (requêtes multiples)
  if (FORBIDDEN_CHARS.test(stripped))  return false;
  return true;
}

// --- Origines autorisées pour CORS (configurable via env)
const ALLOWED_ORIGINS = (process.env.BIRDASH_CORS_ORIGINS || '').split(',').filter(Boolean);

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  // Si aucune origine configurée, autoriser localhost uniquement
  if (ALLOWED_ORIGINS.length === 0) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
    return null;
  }
  // Vérifier si l'origine est dans la liste autorisée
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) return origin;
  return null;
}

// --- Rate limiter en mémoire (par IP, token bucket)
const _rateBuckets = new Map();
const RATE_WINDOW  = 60 * 1000; // 1 minute
const RATE_MAX     = 120;       // max requêtes par minute par IP
// Nettoyage périodique des buckets expirés
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

// ── Auth helper: check Bearer token for write operations ─────────────────────
function requireAuth(req, res) {
  if (!API_TOKEN) return true; // no token configured → open access (LAN-only deployment)
  const auth = req.headers['authorization'] || '';
  // Only accept Bearer token in header (no query string — avoids log/proxy leaks)
  if (auth === `Bearer ${API_TOKEN}`) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized — set Authorization: Bearer <token> header' }));
  return false;
}
if (!API_TOKEN) console.warn('[BIRDASH] WARNING: No BIRDASH_API_TOKEN set — write endpoints are unprotected. Set Environment=BIRDASH_API_TOKEN=... in birdash.service for production.');

// --- Adaptive gain state & logic (module-level for background collector access)
function readJsonFile(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function writeJsonFileAtomic(p, data) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}
// --- Shared context for route modules
const _routeCtx = {
  requireAuth, execCmd, readJsonFile, writeJsonFileAtomic, JSON_CT,
  db, dbWrite, birdashDb, taxonomyDb, parseBirdnetConf, SONGS_DIR,
  ALLOWED_SERVICES, BIRDNET_DIR, validateQuery,
  photoCacheKey: _photoRoutes.photoCacheKey, PHOTO_CACHE_DIR: _photoRoutes.PHOTO_CACHE_DIR,
  writeBirdnetConf, SETTINGS_VALIDATORS, BIRDNET_CONF, _alerts,
};

// --- Handler HTTP
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB max for POST bodies

const server = http.createServer((req, res) => {
  // Body size limit for POST requests
  if (req.method === 'POST') {
    let bodySize = 0;
    let bodyLimited = false;
    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE && !bodyLimited) {
        bodyLimited = true;
        req.removeAllListeners('data'); // Stop reading
        req._aborted = true;
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
        }
      }
    });
    // Expose flag for route handlers to check
    req._bodyLimited = () => bodyLimited;
  }

  // Headers de sécurité
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // CSP set below after pathname is parsed

  // CORS — restrictif par défaut
  const allowedOrigin = getCorsOrigin(req);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Rate limiting
  if (rateLimit(req)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Too many requests' }));
    return;
  }

  // Skip if body was already rejected (413)
  if (req._aborted) return;
  // Extraire le pathname proprement (ignore query string éventuel)
  const pathname = req.url.split('?')[0].replace(/\/$/, '') || '/';
  // CSP only for non-API routes (HTML pages)
  if (!pathname.startsWith('/api/')) res.setHeader('Content-Security-Policy', CSP);
  console.log(`[BIRDASH] ${req.method} ${req.url} → pathname: ${pathname}`);

  // ── Route delegations ──────────────────────────────────────────────────
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

  console.warn(`[BIRDASH] 404 — route inconnue : ${req.method} ${pathname}`);
  if (res.headersSent) return;
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Route inconnue : ${req.method} ${pathname}` }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[BIRDASH] API démarrée sur http://127.0.0.1:${PORT}`);
});

function gracefulShutdown() {
  _alerts.stopAlerts();
  if (_rateBucketCleanup) clearInterval(_rateBucketCleanup);
  _backupRoutes.shutdown();
  _audioRoutes.shutdown();
  try { db.close(); } catch{} try { dbWrite.close(); } catch{}
  try { if (taxonomyDb) taxonomyDb.close(); } catch{} try { if (birdashDb) birdashDb.close(); } catch{}
  process.exit(0);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT',  gracefulShutdown);
