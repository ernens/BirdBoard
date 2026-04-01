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

// --- Configuration
const PORT      = process.env.BIRDASH_PORT || 7474;
const DB_PATH   = process.env.BIRDASH_DB   || path.join(
  process.env.HOME, 'birdash', 'data', 'birds.db'
);
const SONGS_DIR = process.env.BIRDASH_SONGS_DIR || path.join(
  process.env.HOME, 'BirdSongs', 'Extracted', 'By_Date'
);
const PHOTO_CACHE_DIR = path.join(process.env.HOME, 'birdash', 'photo-cache');
const AUDIO_RATE = 48000;

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

// Parse birdnet.conf → { KEY: value }
async function parseBirdnetConf() {
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
  LATITUDE:        v => !isNaN(v) && v >= -90 && v <= 90,
  LONGITUDE:       v => !isNaN(v) && v >= -180 && v <= 180,
  MODEL:           v => typeof v === 'string' && /^[a-zA-Z0-9_.\-]+$/.test(v),
  SF_THRESH:       v => !isNaN(v) && v >= 0 && v <= 1,
  CONFIDENCE:      v => !isNaN(v) && v >= 0.01 && v <= 0.99,
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
  IMAGE_PROVIDER:  v => ['WIKIPEDIA','FLICKR'].includes(v),
  RARE_SPECIES_THRESHOLD: v => !isNaN(v) && v >= 1 && v <= 365,
  RAW_SPECTROGRAM: v => v == 0 || v == 1,
  DATA_MODEL_VERSION: v => v == 1 || v == 2,
};

// ── Backup cron helper ────────────────────────────────────────────────────────
async function updateBackupCron(config) {
  const cronTag = '# BIRDASH_BACKUP';
  const oldBackupPattern = /backup-biloute\.sh/;
  const scriptPath = path.join(__dirname, '..', 'scripts', 'backup.sh');
  const cfgPath = path.join(__dirname, '..', 'config', 'backup.json');
  try {
    // Read current crontab
    let crontab = '';
    try { crontab = await execCmd('crontab', ['-l']); } catch(e) {}
    const lines = crontab.split('\n');
    const result = [];
    for (const line of lines) {
      // Remove old BIRDASH_BACKUP lines
      if (line.includes(cronTag)) continue;
      // Comment out old backup-biloute.sh if new schedule is active
      if (config.schedule && config.schedule !== 'manual' && oldBackupPattern.test(line) && !line.trim().startsWith('#')) {
        result.push('# [disabled by birdash] ' + line);
        continue;
      }
      result.push(line);
    }
    if (config.schedule && config.schedule !== 'manual') {
      const [hour, min] = (config.scheduleTime || '02:00').split(':').map(Number);
      let cronExpr;
      if (config.schedule === 'daily') cronExpr = `${min} ${hour} * * *`;
      else if (config.schedule === 'weekly') cronExpr = `${min} ${hour} * * 0`;
      else return;
      result.push(`${cronExpr} BACKUP_CONFIG=${cfgPath} bash ${scriptPath} >> /var/log/birdash-backup.log 2>&1 ${cronTag}`);
    }
    const tmpCron = '/tmp/birdash-crontab.tmp';
    await fsp.writeFile(tmpCron, result.filter(l => l.trim() !== '').join('\n') + '\n');
    await execCmd('crontab', [tmpCron]);
    await fsp.unlink(tmpCron).catch(() => {});
  } catch(e) {
    console.warn('[BIRDASH] Failed to update backup cron:', e.message);
  }
}

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
// Cache BirdWeather (TTL 5 min — données live)
let _bwCache = null, _bwCacheTs = 0;
let _backupSizeCache = 0, _backupSizeRefreshing = false;
const BW_TTL = 5 * 60 * 1000;
let _ebirdCache = null;
let _ebirdCacheTs = 0;
let _weatherCache = null;
let _weatherCacheTs = 0;
const WEATHER_TTL = 3600 * 1000; // 1 heure
const _speciesNamesCache = {}; // lang → { sci: comName }
let _detectedSpeciesCache = null; // [sci, sci, …]
let _detectedSpeciesCacheTs = 0;
const EBIRD_TTL = 3600 * 1000; // 1 heure

// Créer le répertoire cache photos si absent
if (!fs.existsSync(PHOTO_CACHE_DIR)) {
  fs.mkdirSync(PHOTO_CACHE_DIR, { recursive: true });
  console.log(`[BIRDASH] Dossier photo-cache créé : ${PHOTO_CACHE_DIR}`);
}

// ── Photo cache helpers ─────────────────────────────────────────────────────

// Nom de fichier sûr : "Pica pica" → "Pica_pica"
function photoCacheKey(sciName) {
  return sciName.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/__+/g, '_');
}

// Fetch HTTPS avec redirect (max 3 sauts) — retourne Buffer ou null
function fetchBuffer(url, hops = 3) {
  return new Promise((resolve) => {
    if (hops <= 0) return resolve(null);
    const lib = url.startsWith('https') ? https : require('http');
    lib.get(url, { headers: { 'User-Agent': 'BIRDASH/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchBuffer(res.headers.location, hops - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// Fetch JSON depuis une URL HTTPS
function fetchJson(url, extraHeaders = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : require('http');
    const headers = { 'User-Agent': 'BIRDASH/1.0', 'Accept': 'application/json', ...extraHeaders };
    lib.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(null); } });
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// Résoudre l'URL de photo pour un nom scientifique (iNat → Wikipedia)
async function resolvePhotoUrl(sciName) {
  // 1. iNaturalist
  const tn   = encodeURIComponent(sciName);
  const data = await fetchJson(
    `https://api.inaturalist.org/v1/taxa?taxon_name=${tn}&rank=species&per_page=3`
  );
  if (data?.results) {
    const taxon = data.results.find(t => t.name.toLowerCase() === sciName.toLowerCase());
    const url   = taxon?.default_photo?.medium_url
               || taxon?.default_photo?.square_url
               || taxon?.default_photo?.url;
    if (url) return { url, src: 'iNaturalist' };
  }
  // 2. Wikipedia
  const title = sciName.replace(/ /g, '_');
  const wiki  = await fetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  );
  const wUrl  = wiki?.thumbnail?.source || wiki?.originalimage?.source;
  if (wUrl) return { url: wUrl, src: 'Wikipedia' };

  return null;
}

// ── Scan des MP3 récents ────────────────────────────────────────────────────
// Retourne la liste des MP3 des dernières 48h, triés par mtime croissant
async function getRecentMp3s() {
  const files  = [];
  const cutoff = Date.now() - 48 * 3600 * 1000;

  for (let daysAgo = 0; daysAgo <= 1; daysAgo++) {
    const d = new Date(Date.now() - daysAgo * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    const dayDir  = path.join(SONGS_DIR, dateStr);
    let species;
    try { species = await fsp.readdir(dayDir); } catch(e) { continue; }

    for (const sp of species) {
      const spDir = path.join(dayDir, sp);
      let entries;
      try { entries = await fsp.readdir(spDir); } catch(e) { continue; }
      for (const f of entries) {
        if (!f.endsWith('.mp3')) continue;
        const fp = path.join(spDir, f);
        try {
          const { mtimeMs } = await fsp.stat(fp);
          if (mtimeMs >= cutoff) files.push({ path: fp, mtime: mtimeMs });
        } catch(e) {}
      }
    }
  }
  // Tri chronologique
  return files.sort((a, b) => a.mtime - b.mtime);
}

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
  initDb.pragma('journal_mode = WAL');
  initDb.close();
  console.log('[BIRDASH] Empty birds.db created successfully');
}

// Ouvre en lecture seule (requêtes SELECT)
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

// Connexion en écriture pour les suppressions uniquement
const dbWrite = new Database(DB_PATH, { fileMustExist: true });
dbWrite.pragma('journal_mode = WAL');
dbWrite.pragma('busy_timeout = 5000');

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
//  SYSTEM ALERTS — background monitoring loop
// ══════════════════════════════════════════════════════════════════════════════
const ALERT_CHECK_INTERVAL = 60000; // 60 seconds
const ALERT_COOLDOWN = 600000;      // 10 minutes between same alert type
const _alertLastSent = {};          // { alertType: timestamp }

// ── Alert message translations ──────────────────────────────────────────────
const ALERT_I18N = {
  en: {
    temp_crit_title:   '🔥 BIRDASH — Critical temperature!',
    temp_crit_body:    (temp, th) => `Temperature: ${temp}°C (threshold: ${th}°C). Risk of thermal throttling or shutdown.`,
    temp_warn_title:   '🌡️ BIRDASH — High temperature',
    temp_warn_body:    (temp, th) => `Temperature: ${temp}°C (threshold: ${th}°C).`,
    disk_crit_title:   '💾 BIRDASH — Disk almost full!',
    disk_crit_body:    (pct, th) => `Disk usage: ${pct}% (threshold: ${th}%). Recordings may stop.`,
    disk_warn_title:   '💾 BIRDASH — Disk space low',
    disk_warn_body:    (pct, th) => `Disk usage: ${pct}% (threshold: ${th}%).`,
    ram_warn_title:    '🧠 BIRDASH — RAM critical',
    ram_warn_body:     (pct, th) => `RAM usage: ${pct}% (threshold: ${th}%).`,
    svc_state_title:   (svc, state) => `⚠️ BIRDASH — Service ${svc} is ${state}`,
    svc_state_body:    (svc, state) => `The service ${svc} is ${state}. Detection may have stopped. Check system page for details.`,
    svc_down_title:    (svc) => `⚠️ BIRDASH — Service ${svc} is down`,
    svc_down_body:     (svc) => `The service ${svc} is not running. Detection may have stopped.`,
    backlog_title:     '📊 BIRDASH — Analysis backlog growing',
    backlog_body:      (count, th) => `${count} files pending analysis (threshold: ${th}). The analysis pipeline may be stuck or overloaded.`,
    no_det_title:      '🔇 BIRDASH — No detections',
    no_det_body:       (hours, th) => `No bird detections in the last ${hours} hours (threshold: ${th}h). Recording or analysis may be offline.`,
    bird_influx_title: '📈 BIRDASH — Unusual activity',
    bird_influx_body:  (species, count, avg) => `Unusual activity: ${species} - ${count} detections today (avg: ${avg}/day)`,
    bird_missing_title:'🔍 BIRDASH — Missing common species',
    bird_missing_body: (species, avg) => `Missing today: ${species} (usually ${avg}/day)`,
    bird_rare_title:   '🦅 BIRDASH — Rare visitor',
    bird_rare_body:    (species, total) => `Rare visitor: ${species} detected (only ${total} records total)`,
  },
  fr: {
    temp_crit_title:   '🔥 BIRDASH — Température critique !',
    temp_crit_body:    (temp, th) => `Température : ${temp}°C (seuil : ${th}°C). Risque de ralentissement thermique ou d'arrêt.`,
    temp_warn_title:   '🌡️ BIRDASH — Température élevée',
    temp_warn_body:    (temp, th) => `Température : ${temp}°C (seuil : ${th}°C).`,
    disk_crit_title:   '💾 BIRDASH — Disque presque plein !',
    disk_crit_body:    (pct, th) => `Utilisation disque : ${pct}% (seuil : ${th}%). Les enregistrements peuvent s'arrêter.`,
    disk_warn_title:   '💾 BIRDASH — Espace disque faible',
    disk_warn_body:    (pct, th) => `Utilisation disque : ${pct}% (seuil : ${th}%).`,
    ram_warn_title:    '🧠 BIRDASH — RAM critique',
    ram_warn_body:     (pct, th) => `Utilisation RAM : ${pct}% (seuil : ${th}%).`,
    svc_state_title:   (svc, state) => `⚠️ BIRDASH — Le service ${svc} est ${state}`,
    svc_state_body:    (svc, state) => `Le service ${svc} est ${state}. La détection a peut-être cessé. Vérifiez la page système.`,
    svc_down_title:    (svc) => `⚠️ BIRDASH — Le service ${svc} est arrêté`,
    svc_down_body:     (svc) => `Le service ${svc} ne fonctionne pas. La détection a peut-être cessé.`,
    backlog_title:     '📊 BIRDASH — File d\'analyse en croissance',
    backlog_body:      (count, th) => `${count} fichiers en attente d'analyse (seuil : ${th}). Le pipeline d'analyse est peut-être bloqué ou surchargé.`,
    no_det_title:      '🔇 BIRDASH — Aucune détection',
    no_det_body:       (hours, th) => `Aucune détection d'oiseaux depuis ${hours} heures (seuil : ${th}h). L'enregistrement ou l'analyse est peut-être hors ligne.`,
    bird_influx_title: '📈 BIRDASH — Activité inhabituelle',
    bird_influx_body:  (species, count, avg) => `Activité inhabituelle : ${species} - ${count} détections aujourd'hui (moy. : ${avg}/jour)`,
    bird_missing_title:'🔍 BIRDASH — Espèce commune absente',
    bird_missing_body: (species, avg) => `Absente aujourd'hui : ${species} (habituellement ${avg}/jour)`,
    bird_rare_title:   '🦅 BIRDASH — Visiteur rare',
    bird_rare_body:    (species, total) => `Visiteur rare : ${species} détecté (seulement ${total} observations au total)`,
  },
  de: {
    temp_crit_title:   '🔥 BIRDASH — Kritische Temperatur!',
    temp_crit_body:    (temp, th) => `Temperatur: ${temp}°C (Schwellenwert: ${th}°C). Risiko einer thermischen Drosselung oder Abschaltung.`,
    temp_warn_title:   '🌡️ BIRDASH — Hohe Temperatur',
    temp_warn_body:    (temp, th) => `Temperatur: ${temp}°C (Schwellenwert: ${th}°C).`,
    disk_crit_title:   '💾 BIRDASH — Festplatte fast voll!',
    disk_crit_body:    (pct, th) => `Festplattennutzung: ${pct}% (Schwellenwert: ${th}%). Aufnahmen könnten stoppen.`,
    disk_warn_title:   '💾 BIRDASH — Speicherplatz knapp',
    disk_warn_body:    (pct, th) => `Festplattennutzung: ${pct}% (Schwellenwert: ${th}%).`,
    ram_warn_title:    '🧠 BIRDASH — RAM kritisch',
    ram_warn_body:     (pct, th) => `RAM-Nutzung: ${pct}% (Schwellenwert: ${th}%).`,
    svc_state_title:   (svc, state) => `⚠️ BIRDASH — Dienst ${svc} ist ${state}`,
    svc_state_body:    (svc, state) => `Der Dienst ${svc} ist ${state}. Die Erkennung wurde möglicherweise gestoppt. Überprüfen Sie die Systemseite.`,
    svc_down_title:    (svc) => `⚠️ BIRDASH — Dienst ${svc} ist ausgefallen`,
    svc_down_body:     (svc) => `Der Dienst ${svc} läuft nicht. Die Erkennung wurde möglicherweise gestoppt.`,
    backlog_title:     '📊 BIRDASH — Analyserückstand wächst',
    backlog_body:      (count, th) => `${count} Dateien warten auf Analyse (Schwellenwert: ${th}). Die Analysepipeline ist möglicherweise blockiert oder überlastet.`,
    no_det_title:      '🔇 BIRDASH — Keine Erkennungen',
    no_det_body:       (hours, th) => `Keine Vogelerkennungen in den letzten ${hours} Stunden (Schwellenwert: ${th}h). Aufnahme oder Analyse ist möglicherweise offline.`,
    bird_influx_title: '📈 BIRDASH — Ungewöhnliche Aktivität',
    bird_influx_body:  (species, count, avg) => `Ungewöhnliche Aktivität: ${species} - ${count} Erkennungen heute (Durchschnitt: ${avg}/Tag)`,
    bird_missing_title:'🔍 BIRDASH — Häufige Art fehlt',
    bird_missing_body: (species, avg) => `Heute fehlend: ${species} (normalerweise ${avg}/Tag)`,
    bird_rare_title:   '🦅 BIRDASH — Seltener Besucher',
    bird_rare_body:    (species, total) => `Seltener Besucher: ${species} entdeckt (nur ${total} Einträge insgesamt)`,
  },
  nl: {
    temp_crit_title:   '🔥 BIRDASH — Kritieke temperatuur!',
    temp_crit_body:    (temp, th) => `Temperatuur: ${temp}°C (drempel: ${th}°C). Risico op thermische beperking of uitschakeling.`,
    temp_warn_title:   '🌡️ BIRDASH — Hoge temperatuur',
    temp_warn_body:    (temp, th) => `Temperatuur: ${temp}°C (drempel: ${th}°C).`,
    disk_crit_title:   '💾 BIRDASH — Schijf bijna vol!',
    disk_crit_body:    (pct, th) => `Schijfgebruik: ${pct}% (drempel: ${th}%). Opnames kunnen stoppen.`,
    disk_warn_title:   '💾 BIRDASH — Weinig schijfruimte',
    disk_warn_body:    (pct, th) => `Schijfgebruik: ${pct}% (drempel: ${th}%).`,
    ram_warn_title:    '🧠 BIRDASH — RAM kritiek',
    ram_warn_body:     (pct, th) => `RAM-gebruik: ${pct}% (drempel: ${th}%).`,
    svc_state_title:   (svc, state) => `⚠️ BIRDASH — Service ${svc} is ${state}`,
    svc_state_body:    (svc, state) => `De service ${svc} is ${state}. Detectie is mogelijk gestopt. Controleer de systeempagina.`,
    svc_down_title:    (svc) => `⚠️ BIRDASH — Service ${svc} is uitgevallen`,
    svc_down_body:     (svc) => `De service ${svc} draait niet. Detectie is mogelijk gestopt.`,
    backlog_title:     '📊 BIRDASH — Analyse-achterstand groeit',
    backlog_body:      (count, th) => `${count} bestanden wachten op analyse (drempel: ${th}). De analysepijplijn is mogelijk vastgelopen of overbelast.`,
    no_det_title:      '🔇 BIRDASH — Geen detecties',
    no_det_body:       (hours, th) => `Geen vogeldetecties in de afgelopen ${hours} uur (drempel: ${th}u). Opname of analyse is mogelijk offline.`,
    bird_influx_title: '📈 BIRDASH — Ongebruikelijke activiteit',
    bird_influx_body:  (species, count, avg) => `Ongebruikelijke activiteit: ${species} - ${count} detecties vandaag (gem.: ${avg}/dag)`,
    bird_missing_title:'🔍 BIRDASH — Veelvoorkomende soort afwezig',
    bird_missing_body: (species, avg) => `Vandaag afwezig: ${species} (normaal ${avg}/dag)`,
    bird_rare_title:   '🦅 BIRDASH — Zeldzame bezoeker',
    bird_rare_body:    (species, total) => `Zeldzame bezoeker: ${species} gedetecteerd (slechts ${total} waarnemingen totaal)`,
  },
};

// Helper: get translated alert messages for the user's configured language
function getAlertLang() {
  try {
    const confRaw = fs.readFileSync(BIRDNET_CONF, 'utf8');
    const m = confRaw.match(/^DATABASE_LANG=(.+)/m);
    const lang = m ? m[1].replace(/"/g, '').trim().slice(0, 2) : 'en';
    return ALERT_I18N[lang] || ALERT_I18N.en;
  } catch(e) {
    return ALERT_I18N.en;
  }
}

// Default thresholds (can be overridden in birdnet.conf via BIRDASH_ALERT_*)
const ALERT_DEFAULTS = {
  temp_warn: 70, temp_crit: 80,     // °C
  disk_warn: 85, disk_crit: 95,     // %
  ram_warn: 90,                      // %
  backlog_warn: 50,                  // files
  no_detection_hours: 4,             // hours
  service_down: 1,                   // 1=enabled
  // Per-alert enable/disable (1=on, 0=off)
  alert_temp: 1, alert_temp_crit: 1, alert_disk: 1,
  alert_ram: 1, alert_backlog: 1, alert_no_det: 1,
  // Bird smart alerts (1=on, 0=off)
  alert_influx: 0, alert_missing: 0, alert_rare_visitor: 0,
};

function getAlertThresholds() {
  const t = { ...ALERT_DEFAULTS };
  try {
    const confRaw = fs.readFileSync(BIRDNET_CONF, 'utf8');
    const match = (key) => { const m = confRaw.match(new RegExp(`^${key}=(.+)`, 'm')); return m ? m[1].replace(/"/g, '').trim() : null; };
    if (match('BIRDASH_ALERT_TEMP_WARN')) t.temp_warn = parseFloat(match('BIRDASH_ALERT_TEMP_WARN'));
    if (match('BIRDASH_ALERT_TEMP_CRIT')) t.temp_crit = parseFloat(match('BIRDASH_ALERT_TEMP_CRIT'));
    if (match('BIRDASH_ALERT_DISK_WARN')) t.disk_warn = parseFloat(match('BIRDASH_ALERT_DISK_WARN'));
    if (match('BIRDASH_ALERT_DISK_CRIT')) t.disk_crit = parseFloat(match('BIRDASH_ALERT_DISK_CRIT'));
    if (match('BIRDASH_ALERT_RAM_WARN'))  t.ram_warn = parseFloat(match('BIRDASH_ALERT_RAM_WARN'));
    if (match('BIRDASH_ALERT_BACKLOG'))   t.backlog_warn = parseInt(match('BIRDASH_ALERT_BACKLOG'));
    if (match('BIRDASH_ALERT_NO_DET_H'))  t.no_detection_hours = parseInt(match('BIRDASH_ALERT_NO_DET_H'));
    // Per-alert toggles
    if (match('BIRDASH_ALERT_ON_TEMP'))      t.alert_temp = parseInt(match('BIRDASH_ALERT_ON_TEMP'));
    if (match('BIRDASH_ALERT_ON_TEMP_CRIT')) t.alert_temp_crit = parseInt(match('BIRDASH_ALERT_ON_TEMP_CRIT'));
    if (match('BIRDASH_ALERT_ON_DISK'))      t.alert_disk = parseInt(match('BIRDASH_ALERT_ON_DISK'));
    if (match('BIRDASH_ALERT_ON_RAM'))       t.alert_ram = parseInt(match('BIRDASH_ALERT_ON_RAM'));
    if (match('BIRDASH_ALERT_ON_BACKLOG'))   t.alert_backlog = parseInt(match('BIRDASH_ALERT_ON_BACKLOG'));
    if (match('BIRDASH_ALERT_ON_NO_DET'))    t.alert_no_det = parseInt(match('BIRDASH_ALERT_ON_NO_DET'));
    // Bird smart alerts
    if (match('BIRDASH_ALERT_ON_INFLUX'))       t.alert_influx = parseInt(match('BIRDASH_ALERT_ON_INFLUX'));
    if (match('BIRDASH_ALERT_ON_MISSING'))      t.alert_missing = parseInt(match('BIRDASH_ALERT_ON_MISSING'));
    if (match('BIRDASH_ALERT_ON_RARE_VISITOR')) t.alert_rare_visitor = parseInt(match('BIRDASH_ALERT_ON_RARE_VISITOR'));
  } catch(e) {}
  return t;
}

async function sendAlert(type, title, body) {
  const now = Date.now();
  if (_alertLastSent[type] && (now - _alertLastSent[type]) < ALERT_COOLDOWN) return;

  const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
  const appriseBin = path.join(process.env.HOME, 'birdash', 'engine', 'venv', 'bin', 'apprise');

  // Check apprise.txt exists and has content
  try {
    const content = await fsp.readFile(appriseFile, 'utf8');
    if (!content.trim()) return;
  } catch(e) { return; }

  try {
    const { execFile } = require('child_process');
    await new Promise((resolve, reject) => {
      execFile(appriseBin, ['-t', title, '-b', body, '--config=' + appriseFile],
        { timeout: 15000 }, (err) => { if (err) reject(err); else resolve(); });
    });
    _alertLastSent[type] = now;
    console.log(`[ALERT] ${type}: ${title}`);
  } catch(e) {
    console.error(`[ALERT] Failed to send ${type}:`, e.message);
  }
}

async function checkSystemAlerts() {
  const th = getAlertThresholds();
  const t = getAlertLang();

  try {
    // ── Temperature ──
    if (th.alert_temp_crit || th.alert_temp) {
      try {
        const tempRaw = await fsp.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
        const temp = parseFloat(tempRaw) / 1000;
        if (th.alert_temp_crit && temp >= th.temp_crit) {
          await sendAlert('temp_crit', t.temp_crit_title, t.temp_crit_body(temp.toFixed(1), th.temp_crit));
        } else if (th.alert_temp && temp >= th.temp_warn) {
          await sendAlert('temp_warn', t.temp_warn_title, t.temp_warn_body(temp.toFixed(1), th.temp_warn));
        }
      } catch(e) {}
    }

    // ── Disk ──
    if (th.alert_disk) {
      try {
        const dfOut = await execCmd('df', ['-B1', '/']).then(o => o.split('\n')[1] || '');
        const parts = dfOut.trim().split(/\s+/);
        const diskPct = parseInt(parts[4]);
        if (diskPct >= th.disk_crit) {
          await sendAlert('disk_crit', t.disk_crit_title, t.disk_crit_body(diskPct, th.disk_crit));
        } else if (diskPct >= th.disk_warn) {
          await sendAlert('disk_warn', t.disk_warn_title, t.disk_warn_body(diskPct, th.disk_warn));
        }
      } catch(e) {}
    }

    // ── RAM ──
    if (th.alert_ram) {
      try {
        const meminfo = await fsp.readFile('/proc/meminfo', 'utf8');
        const total = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || '0');
        const avail = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0');
        const ramPct = total ? Math.round((total - avail) / total * 100) : 0;
        if (ramPct >= th.ram_warn) {
          await sendAlert('ram_warn', t.ram_warn_title, t.ram_warn_body(ramPct, th.ram_warn));
        }
      } catch(e) {}
    }

    // ── Service down ──
    if (th.service_down) {
      const criticalServices = ['birdengine', 'birdengine-recording'];
      for (const svc of criticalServices) {
        try {
          const state = (await execCmd('systemctl', ['is-active', svc])).trim();
          if (state === 'failed' || state === 'inactive') {
            await sendAlert('svc_' + svc, t.svc_state_title(svc, state), t.svc_state_body(svc, state));
          }
        } catch(e) {
          // execSync throws if exit code != 0 (service not active)
          await sendAlert('svc_' + svc, t.svc_down_title(svc), t.svc_down_body(svc));
        }
      }
    }

    // ── Analysis backlog ──
    if (th.alert_backlog) {
      try {
        const streamDir = path.join(process.env.HOME, 'BirdSongs', 'StreamData');
        const files = (await fsp.readdir(streamDir)).filter(f => f.endsWith('.wav'));
        if (files.length >= th.backlog_warn) {
          await sendAlert('backlog', t.backlog_title, t.backlog_body(files.length, th.backlog_warn));
        }
      } catch(e) {}
    }

    // ── No detection for X hours ──
    if (th.alert_no_det) {
      try {
        if (db) {
          const row = db.prepare('SELECT MAX(Date || " " || Time) as last FROM detections').get();
          if (row && row.last) {
            const lastDet = new Date(row.last);
            const hoursSince = (Date.now() - lastDet.getTime()) / 3600000;
            if (hoursSince >= th.no_detection_hours) {
              await sendAlert('no_detection', t.no_det_title, t.no_det_body(Math.round(hoursSince), th.no_detection_hours));
            }
          }
        }
      } catch(e) {}
    }

  } catch(e) {
    console.error('[ALERT] checkSystemAlerts error:', e.message);
  }
}

const BIRD_ALERT_INTERVAL = 900000; // 15 minutes

async function checkBirdAlerts() {
  const th = getAlertThresholds();
  const t = getAlertLang();
  if (!db) return;
  if (!th.alert_influx && !th.alert_missing && !th.alert_rare_visitor) return;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    // ── Unusual influx: today's count > 3x 30-day daily average ──
    if (th.alert_influx) {
      try {
        const rows = db.prepare(`
          SELECT t.Com_Name, t.cnt AS today_count, COALESCE(h.avg_count, 0) AS avg_count
          FROM (
            SELECT Com_Name, COUNT(*) AS cnt
            FROM detections WHERE Date = ?
            GROUP BY Com_Name
          ) t
          LEFT JOIN (
            SELECT Com_Name, CAST(COUNT(*) AS REAL) / 30.0 AS avg_count
            FROM detections WHERE Date >= ? AND Date < ?
            GROUP BY Com_Name
          ) h ON t.Com_Name = h.Com_Name
          WHERE t.cnt > 3 * MAX(h.avg_count, 1)
        `).all(today, thirtyDaysAgo, today);
        for (const r of rows) {
          await sendAlert('bird_influx_' + r.Com_Name, t.bird_influx_title,
            t.bird_influx_body(r.Com_Name, r.today_count, r.avg_count.toFixed(1)));
        }
      } catch(e) { console.error('[ALERT] bird influx error:', e.message); }
    }

    // ── Missing common species (only after noon) ──
    if (th.alert_missing && new Date().getHours() >= 12) {
      try {
        const rows = db.prepare(`
          SELECT top5.Com_Name, top5.avg_count
          FROM (
            SELECT Com_Name, CAST(COUNT(*) AS REAL) / 30.0 AS avg_count
            FROM detections WHERE Date >= ? AND Date < ?
            GROUP BY Com_Name ORDER BY COUNT(*) DESC LIMIT 5
          ) top5
          LEFT JOIN (
            SELECT DISTINCT Com_Name FROM detections WHERE Date = ?
          ) today ON top5.Com_Name = today.Com_Name
          WHERE today.Com_Name IS NULL
        `).all(thirtyDaysAgo, today, today);
        for (const r of rows) {
          await sendAlert('bird_missing_' + r.Com_Name, t.bird_missing_title,
            t.bird_missing_body(r.Com_Name, r.avg_count.toFixed(1)));
        }
      } catch(e) { console.error('[ALERT] bird missing error:', e.message); }
    }

    // ── Rare visitor: species with <= 3 total historical detections ──
    if (th.alert_rare_visitor) {
      try {
        const rows = db.prepare(`
          SELECT d.Com_Name, h.total
          FROM (SELECT DISTINCT Com_Name FROM detections WHERE Date = ?) d
          JOIN (
            SELECT Com_Name, COUNT(*) AS total
            FROM detections GROUP BY Com_Name HAVING COUNT(*) <= 3
          ) h ON d.Com_Name = h.Com_Name
        `).all(today);
        for (const r of rows) {
          await sendAlert('bird_rare_' + r.Com_Name, t.bird_rare_title,
            t.bird_rare_body(r.Com_Name, r.total));
        }
      } catch(e) { console.error('[ALERT] bird rare visitor error:', e.message); }
    }

  } catch(e) {
    console.error('[ALERT] checkBirdAlerts error:', e.message);
  }
}

// Start monitoring loop after 30s (let services stabilize)
let _birdAlertTick = 0;
let _alertIntervalId = null;
let _activeBackupProc = null;
setTimeout(() => {
  console.log('[BIRDASH] System alerts monitoring started (every 60s, bird alerts every 15min)');
  _alertIntervalId = setInterval(() => {
    checkSystemAlerts();
    _birdAlertTick++;
    if (_birdAlertTick % Math.round(BIRD_ALERT_INTERVAL / ALERT_CHECK_INTERVAL) === 0) {
      checkBirdAlerts();
    }
  }, ALERT_CHECK_INTERVAL);
  checkSystemAlerts(); // Initial check
  checkBirdAlerts();   // Initial bird check
}, 30000);

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
const AG_DEFAULTS = {
  enabled: false, mode: 'balanced', observer_only: true,
  min_db: -6, max_db: 9, step_up_db: 0.5, step_down_db: 1.5,
  update_interval_s: 10, history_s: 30, noise_percentile: 20,
  target_floor_dbfs: -42, clip_guard_dbfs: -3, activity_hold_s: 15,
};
const _agState = {
  current_gain_db: 0, recommended_gain_db: 0, last_update_ts: 0, hold_until_ts: 0,
  noise_floor_dbfs: null, activity_dbfs: null, peak_dbfs: null,
  reason: 'init', history: [],
};
function _agPercentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a,b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p / 100 * s.length)))];
}
function _agClamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function agPushSample(rms_dbfs, peak_dbfs) {
  _agState.history.push({ ts: Date.now(), rms_dbfs, peak_dbfs });
  if (_agState.history.length > 2000) _agState.history.splice(0, _agState.history.length - 1500);
}
function agUpdate(cfg) {
  const c = { ...AG_DEFAULTS, ...cfg };
  const now = Date.now();
  if (!c.enabled) { _agState.reason = 'disabled'; return _agState; }
  const windowMs = c.history_s * 1000;
  _agState.history = _agState.history.filter(x => now - x.ts <= windowMs);
  if (_agState.history.length < 5) { _agState.reason = 'not_enough_data'; return _agState; }
  const rms = _agState.history.map(x => x.rms_dbfs).filter(Number.isFinite);
  const peaks = _agState.history.map(x => x.peak_dbfs).filter(Number.isFinite);
  if (!rms.length || !peaks.length) { _agState.reason = 'invalid'; return _agState; }
  const nf = _agPercentile(rms, c.noise_percentile);
  const act = _agPercentile(rms, 80);
  const pk = Math.max(...peaks);
  _agState.noise_floor_dbfs = Math.round(nf * 10) / 10;
  _agState.activity_dbfs = Math.round(act * 10) / 10;
  _agState.peak_dbfs = Math.round(pk * 10) / 10;
  if (pk >= c.clip_guard_dbfs) {
    _agState.recommended_gain_db = _agClamp(_agState.recommended_gain_db - c.step_down_db, c.min_db, c.max_db);
    _agState.reason = 'clip_guard';
  } else if ((act - nf) >= 10) {
    _agState.hold_until_ts = now + c.activity_hold_s * 1000;
    _agState.reason = 'activity_hold';
  } else if (now < _agState.hold_until_ts) {
    _agState.reason = 'activity_hold';
  } else {
    const desired = _agClamp(c.target_floor_dbfs - nf, c.min_db, c.max_db);
    if (desired > _agState.recommended_gain_db) {
      _agState.recommended_gain_db = Math.min(_agState.recommended_gain_db + c.step_up_db, desired);
      _agState.reason = 'step_up';
    } else if (desired < _agState.recommended_gain_db) {
      _agState.recommended_gain_db = Math.max(_agState.recommended_gain_db - c.step_down_db, desired);
      _agState.reason = 'step_down';
    } else { _agState.reason = 'stable'; }
  }
  _agState.recommended_gain_db = Math.round(_agClamp(_agState.recommended_gain_db, c.min_db, c.max_db) * 10) / 10;
  if (!c.observer_only) _agState.current_gain_db = _agState.recommended_gain_db;
  else _agState.reason = 'observer';
  _agState.last_update_ts = now;
  return _agState;
}

// --- Shared JSON helpers (used by multiple routes)
function readJsonFile(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function writeJsonFileAtomic(p, data) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

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

  // Extraire le pathname proprement (ignore query string éventuel)
  const pathname = req.url.split('?')[0].replace(/\/$/, '') || '/';
  // CSP only for non-API routes (HTML pages)
  if (!pathname.startsWith('/api/')) res.setHeader('Content-Security-Policy', CSP);
  console.log(`[BIRDASH] ${req.method} ${req.url} → pathname: ${pathname}`);

  // ── Route : GET /api/photo?sci=Pica+pica ────────────────────────────────────
  // Cache disque → iNaturalist → Wikipedia
  if (req.method === 'GET' && pathname === '/api/photo') {
    const sciName = new URL(req.url, 'http://localhost').searchParams.get('sci');

    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end('sci param required'); return;
    }

    const key      = photoCacheKey(sciName);
    const jpgPath  = path.join(PHOTO_CACHE_DIR, key + '.jpg');
    const metaPath = path.join(PHOTO_CACHE_DIR, key + '.json');

    // Route photo entièrement async
    (async () => {
      try {
        // ── Cas 1 : image en cache disque ────────────────────────────────
        try {
          await fsp.access(jpgPath);
          // Le fichier existe
          let meta = { src: 'cache' };
          try { meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')); } catch(e) {}
          res.writeHead(200, {
            'Content-Type':  'image/jpeg',
            'Cache-Control': 'public, max-age=2592000',
            'X-Photo-Source': meta.src || 'cache',
          });
          fs.createReadStream(jpgPath).pipe(res);
          return;
        } catch(e) { /* pas en cache, on résout */ }

        // ── Cas 2 : résoudre + télécharger + mettre en cache ─────────────
        const resolved = await resolvePhotoUrl(sciName);
        if (!resolved) {
          res.writeHead(404); res.end('no photo found'); return;
        }

        const imgBuf = await fetchBuffer(resolved.url);
        if (!imgBuf || imgBuf.length < 512) {
          res.writeHead(502); res.end('image fetch failed'); return;
        }

        // Sauvegarder sur disque (async)
        await fsp.writeFile(jpgPath, imgBuf);
        await fsp.writeFile(metaPath, JSON.stringify({ src: resolved.src, original: resolved.url }));
        console.log(`[photo-cache] ${sciName} → ${resolved.src} (${imgBuf.length} bytes)`);

        res.writeHead(200, {
          'Content-Type':   'image/jpeg',
          'Content-Length': imgBuf.length,
          'Cache-Control':  'public, max-age=2592000',
          'X-Photo-Source': resolved.src,
        });
        res.end(imgBuf);
      } catch(e) {
        console.error('[photo]', e.message);
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }
    })();
    return;
  }

  // ── Route : DELETE /api/photo?sci=Pica+pica ─────────────────────────────────
  // Delete cached photo so next GET re-fetches from iNaturalist/Wikipedia
  if (req.method === 'DELETE' && pathname === '/api/photo') {
    if (!requireAuth(req, res)) return;
    const sciName = new URL(req.url, 'http://localhost').searchParams.get('sci');
    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'sci param required' })); return;
    }
    (async () => {
      try {
        const key = photoCacheKey(sciName);
        const jpgPath = path.join(PHOTO_CACHE_DIR, key + '.jpg');
        const metaPath = path.join(PHOTO_CACHE_DIR, key + '.json');
        let deleted = false;
        try { await fsp.unlink(jpgPath); deleted = true; } catch(e) {}
        try { await fsp.unlink(metaPath); } catch(e) {}
        console.log(`[photo-cache] Deleted: ${sciName} (${deleted ? 'found' : 'not cached'})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deleted }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/photo-cache-stats ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/photo-cache-stats') {
    (async () => {
      try {
        const files = (await fsp.readdir(PHOTO_CACHE_DIR)).filter(f => f.endsWith('.jpg'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cached: files.length, dir: PHOTO_CACHE_DIR }));
      } catch(e) {
        console.error('[photo-cache-stats]', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: 'cache_error' }));
      }
    })();
    return;
  }

  // ── Route : GET /api/species-names?lang=de ──────────────────────────────
  // Returns { "Sci_Name": "Translated Com_Name" } from BirdNET label files
  if (req.method === 'GET' && pathname === '/api/species-names') {
    const lang = new URL(req.url, 'http://localhost').searchParams.get('lang') || 'fr';
    if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(lang)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'invalid lang' })); return;
    }

    // Cache in memory (labels don't change at runtime)
    // Limit cache to 6 languages to prevent unbounded growth
    if (Object.keys(_speciesNamesCache).length > 6) {
      const oldest = Object.keys(_speciesNamesCache)[0];
      delete _speciesNamesCache[oldest];
    }
    if (!_speciesNamesCache[lang]) {
      const candidates = [
        path.join(process.env.HOME, 'birdash', 'engine', 'models', 'l18n', `labels_${lang}.json`),
        path.join(process.env.HOME, 'birdengine', 'models', 'l18n', `labels_${lang}.json`),
      ];
      const labelFile = candidates.find(f => fs.existsSync(f));
      try {
        if (!labelFile) throw new Error('not found');
        const raw = fs.readFileSync(labelFile, 'utf8');
        _speciesNamesCache[lang] = JSON.parse(raw);
        console.log(`[species-names] Loaded ${Object.keys(_speciesNamesCache[lang]).length} names for ${lang}`);
      } catch(e) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `labels_${lang}.json not found` }));
        return;
      }
    }

    // Only return species that exist in our DB (not all 7000)
    // Invalidate cache after 1 hour
    if (_detectedSpeciesCache && (Date.now() - _detectedSpeciesCacheTs) > 3600000) _detectedSpeciesCache = null;
    const detected = _detectedSpeciesCache || (function() {
      const rows = db.prepare('SELECT DISTINCT Sci_Name FROM detections').all();
      _detectedSpeciesCache = rows.map(r => r.Sci_Name);
      _detectedSpeciesCacheTs = Date.now();
      return _detectedSpeciesCache;
    })();

    const result = {};
    const labels = _speciesNamesCache[lang];
    for (const sci of detected) {
      if (labels[sci]) result[sci] = labels[sci];
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(JSON.stringify(result));
    return;
  }

  // ── Route : GET /api/species-info?sci=Pica+pica ───────────────────────────
  // Returns multiple photos + Wikipedia summary for species detail page
  if (req.method === 'GET' && pathname === '/api/species-info') {
    const spParams = new URL(req.url, 'http://localhost').searchParams;
    const sciName = spParams.get('sci');
    let infoLang = spParams.get('lang') || 'fr';
    if (!/^[a-z]{2}$/.test(infoLang)) infoLang = 'en'; // SSRF guard
    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'sci param required' })); return;
    }

    (async () => {
      try {
        const result = { photos: [], summary: '', summaryFr: '', habitat: '', range: '', conservation: '', family: '', order: '', wingspan: '', size: '', diet: '' };
        const tn = encodeURIComponent(sciName);

        // 1. iNaturalist — taxon info + observation photos
        const inatData = await fetchJson(
          `https://api.inaturalist.org/v1/taxa?q=${tn}&rank=species&per_page=5`
        );
        const taxon = inatData?.results?.find(t => t.name.toLowerCase() === sciName.toLowerCase());

        if (taxon) {
          // Default photo
          const dp = taxon.default_photo;
          if (dp) {
            const medUrl = dp.medium_url || dp.url;
            if (medUrl) result.photos.push({ url: medUrl, attr: dp.attribution || '', src: 'iNaturalist' });
          }
          // Taxonomy
          if (taxon.iconic_taxon_name) result.order = taxon.iconic_taxon_name;
          if (taxon.ancestors) {
            const fam = taxon.ancestors.find(a => a.rank === 'family');
            if (fam) result.family = fam.name;
            const ord = taxon.ancestors.find(a => a.rank === 'order');
            if (ord) result.order = ord.name;
          }

          // Observation photos (research-grade, top-voted — diverse angles)
          const obsData = await fetchJson(
            `https://api.inaturalist.org/v1/observations?taxon_id=${taxon.id}&quality_grade=research&photos=true&per_page=10&order=desc&order_by=votes`
          );
          if (obsData?.results) {
            for (const obs of obsData.results) {
              if (result.photos.length >= 10) break;
              for (const p of (obs.photos || [])) {
                if (result.photos.length >= 10) break;
                const url = p.url?.replace(/square/, 'medium');
                if (url && !result.photos.some(x => x.url === url)) {
                  result.photos.push({ url, attr: p.attribution || '', src: 'iNaturalist' });
                }
              }
            }
          }

          // Conservation status
          if (taxon.conservation_status) {
            result.conservation = taxon.conservation_status.status_name || taxon.conservation_status.status || '';
          } else if (taxon.conservation_statuses?.length) {
            const iucn = taxon.conservation_statuses.find(c => c.authority === 'IUCN Red List') || taxon.conservation_statuses[0];
            result.conservation = iucn.status_name || iucn.status || '';
          }
        }

        // 2. English Wikipedia — summary
        const wikiTitle = sciName.replace(/ /g, '_');
        const wiki = await fetchJson(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`
        );
        if (wiki) {
          result.summary = wiki.extract || '';
          if (wiki.originalimage?.source && result.photos.length < 10) {
            result.photos.push({ url: wiki.originalimage.source, attr: 'Wikipedia', src: 'Wikipedia' });
          }
        }

        // 3. Localized Wikipedia — description in user's language
        if (infoLang !== 'en') {
          const wikiLocal = await fetchJson(
            `https://${infoLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`
          );
          if (wikiLocal?.extract) {
            result.summaryFr = wikiLocal.extract;
          }
        }

        // 4. Try Wikidata for structured data (size, wingspan, habitat, diet)
        try {
          const wdSearch = await fetchJson(
            `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${tn}&language=en&format=json&limit=1`
          );
          const wdId = wdSearch?.search?.[0]?.id;
          if (wdId) {
            const wdEntity = await fetchJson(
              `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wdId}&props=claims&format=json`
            );
            const claims = wdEntity?.entities?.[wdId]?.claims;
            if (claims) {
              // P2050 = wingspan, P2048 = height/length
              const getAmount = (prop) => {
                const c = claims[prop]?.[0]?.mainsnak?.datavalue?.value;
                return c?.amount ? parseFloat(c.amount) : null;
              };
              const ws = getAmount('P2050');
              if (ws) result.wingspan = ws > 10 ? `${Math.round(ws)} cm` : `${Math.round(ws*100)} cm`;
              const sz = getAmount('P2048');
              if (sz) result.size = sz > 10 ? `${Math.round(sz)} cm` : `${Math.round(sz*100)} cm`;

              // P2572 = IUCN conservation status label (if not already set)
              if (!result.conservation && claims['P141']?.[0]?.mainsnak?.datavalue?.value?.id) {
                const csId = claims['P141'][0].mainsnak.datavalue.value.id;
                const csMap = { Q211005:'Least Concern', Q719675:'Near Threatened', Q278113:'Vulnerable',
                                Q11394:'Endangered', Q219127:'Critically Endangered', Q3245245:'Data Deficient' };
                result.conservation = csMap[csId] || '';
              }
            }
          }
        } catch(e) { /* Wikidata optional */ }

        // Deduplicate photos by URL
        const seen = new Set();
        result.photos = result.photos.filter(p => {
          const key = p.url.replace(/\/\d+px-/, '/XXpx-');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(JSON.stringify(result));
      } catch(e) {
        console.error('[species-info]', e.message);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'internal_error' }));
        }
      }
    })();
    return;
  }

  // ── Route : GET /api/birdweather ─────────────────────────────────────────────
  // Proxy BirdWeather API — évite les CORS + cache 5 min
  // ?endpoint=stats|species|detections  ?period=day|week|month|all
  if (req.method === 'GET' && pathname === '/api/birdweather') {
    if (!BW_STATION_ID) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no_station', message: 'birdweatherStationId non configuré dans birdash-local.js' }));
      return;
    }
    const qp       = new URL(req.url, 'http://localhost').searchParams;
    const VALID_ENDPOINTS = ['stats', 'species', 'detections'];
    const VALID_PERIODS   = ['day', 'week', 'month', 'all'];
    const endpoint = VALID_ENDPOINTS.includes(qp.get('endpoint')) ? qp.get('endpoint') : 'stats';
    const period   = VALID_PERIODS.includes(qp.get('period'))     ? qp.get('period')   : 'day';
    const locale   = /^[a-z]{2}$/.test(qp.get('locale') || '')   ? qp.get('locale')   : 'fr';
    const limit    = Math.min(20, Math.max(1, parseInt(qp.get('limit') || '10') || 10));
    const cacheKey = `${endpoint}_${period}`;
    if (_bwCache && _bwCache[cacheKey] && _bwCache[cacheKey]._ts && (Date.now() - _bwCache[cacheKey]._ts) < BW_TTL) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
      res.end(JSON.stringify(_bwCache[cacheKey]));
      return;
    }
    (async () => {
      try {
        const BASE = `https://app.birdweather.com/api/v1/stations/${BW_STATION_ID}`;
        const url = endpoint === 'stats'
          ? `${BASE}/stats?period=${period}`
          : endpoint === 'species'
          ? `${BASE}/species?period=${period}&limit=${limit}&locale=${locale}`
          : `${BASE}/detections?limit=${limit}&locale=${locale}`;
        const data = await fetchJson(url);
        if (!data) { res.writeHead(502); res.end(JSON.stringify({ error: 'birdweather_unreachable' })); return; }
        // Injecter l'ID de station dans la réponse stats pour que le client l'affiche
        if (endpoint === 'stats') data.stationId = BW_STATION_ID;
        if (!_bwCache) _bwCache = {};
        data._ts = Date.now();
        _bwCache[cacheKey] = data;
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'MISS' });
        res.end(JSON.stringify(data));
      } catch(e) {
        console.error('[BirdWeather]', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: 'birdweather_error' }));
      }
    })();
    return;
  }

  // ── Route : GET /api/ebird-notable ─────────────────────────────────────────
  // Proxy l'API eBird notable observations pour la Belgique (BE)
  // Paramètres optionnels: ?days=7&maxResults=20
  // Nécessite EBIRD_API_KEY configuré dans l'environnement
  if (req.method === 'GET' && pathname === '/api/ebird-notable') {
    if (!EBIRD_API_KEY) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no_key', message: 'EBIRD_API_KEY non configuré. Obtenir une clé gratuite sur https://ebird.org/api/keygen' }));
      return;
    }

    // Servir depuis le cache mémoire si TTL valide
    if (_ebirdCache && (Date.now() - _ebirdCacheTs) < EBIRD_TTL) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
      res.end(JSON.stringify(_ebirdCache));
      return;
    }

    (async () => {
      try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const days       = Math.min(30, parseInt(params.get('days') || '7'));
        const maxResults = Math.min(50, parseInt(params.get('maxResults') || '20'));
        const url = `https://api.ebird.org/v2/data/obs/${EBIRD_REGION}/recent/notable?detail=simple&back=${days}&maxResults=${maxResults}`;

        const data = await fetchJson(url, { 'X-eBirdApiToken': EBIRD_API_KEY });
        if (!data) {
          res.writeHead(502); res.end(JSON.stringify({ error: 'ebird_unreachable' }));
          return;
        }

        // Normaliser les données
        const result = (Array.isArray(data) ? data : []).map(obs => ({
          comName:   obs.comName,
          sciName:   obs.sciName,
          locName:   obs.locName,
          lat:       obs.lat,
          lng:       obs.lng,
          obsDt:     obs.obsDt,
          howMany:   obs.howMany || 1,
          subId:     obs.subId,
          obsUrl:    `https://ebird.org/checklist/${obs.subId}`,
        }));

        _ebirdCache   = { obs: result, fetchedAt: new Date().toISOString() };
        _ebirdCacheTs = Date.now();

        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'MISS' });
        res.end(JSON.stringify(_ebirdCache));
      } catch(e) {
        console.error('[eBird]', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: 'ebird_error' }));
      }
    })();
    return;
  }

  // ── Route : GET /api/weather?days=30 ─────────────────────────────────────
  // Proxy Open-Meteo free API — daily weather data for the station location
  // Cached for 1 hour (WEATHER_TTL)
  if (req.method === 'GET' && pathname === '/api/weather') {
    (async () => {
      try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const days = Math.min(90, Math.max(1, parseInt(params.get('days') || '30')));

        // Serve from cache if valid
        if (_weatherCache && _weatherCache._days === days && (Date.now() - _weatherCacheTs) < WEATHER_TTL) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
          const { _days: _, ...cached } = _weatherCache;
          res.end(JSON.stringify(cached));
          return;
        }

        // Read lat/lon from birdnet.conf
        const conf = await parseBirdnetConf();
        const lat = conf.LATITUDE  || conf.LAT || '50.85';
        const lon = conf.LONGITUDE || conf.LON || '4.35';

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&past_days=${days}&timezone=auto`;

        const data = await new Promise((resolve, reject) => {
          https.get(url, (resp) => {
            let body = '';
            resp.on('data', chunk => { body += chunk; });
            resp.on('end', () => {
              try { resolve(JSON.parse(body)); }
              catch(e) { reject(new Error('Invalid JSON from Open-Meteo')); }
            });
            resp.on('error', reject);
          }).on('error', reject);
        });

        if (data.error) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'open_meteo_error', detail: data.reason || data.error }));
          return;
        }

        const result = {
          daily: data.daily || {},
          daily_units: data.daily_units || {},
          latitude: data.latitude,
          longitude: data.longitude,
          timezone: data.timezone,
          fetchedAt: new Date().toISOString(),
          _days: days,
        };

        _weatherCache = result;
        _weatherCacheTs = Date.now();

        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'MISS' });
        const { _days, ...responseData } = result;
        res.end(JSON.stringify(responseData));
      } catch(e) {
        console.error('[weather]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'weather_error', message: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/audio-info?file=FileName.mp3 ───────────────────────
  // Returns metadata about an audio file (size, type, duration, channels, sample rate)
  if (req.method === 'GET' && pathname === '/api/audio-info') {
    const fileName = new URL(req.url, 'http://localhost').searchParams.get('file');
    if (!fileName) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"missing file param"}'); return;
    }
    const m = fileName.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
    if (!m) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"invalid filename format"}'); return;
    }
    const species = m[1], date = m[2];
    const filePath = path.join(SONGS_DIR, date, species, fileName);
    // Path traversal guard
    if (!filePath.startsWith(SONGS_DIR)) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"invalid path"}'); return;
    }

    (async () => {
      try {
        const stat = await fsp.stat(filePath);
        const ext = path.extname(fileName).replace('.', '').toUpperCase();
        const info = {
          size: stat.size,
          type: ext || 'UNKNOWN',
          path: `BirdSongs/Extracted/By_Date/${date}/${species}/${fileName}`,
        };
        // Use ffprobe if available
        try {
          const probeData = await new Promise((resolve, reject) => {
            const ff = spawn('ffprobe', [
              '-v', 'quiet', '-print_format', 'json',
              '-show_format', '-show_streams', filePath
            ]);
            let out = '', done = false;
            ff.stdout.on('data', d => out += d);
            ff.on('close', code => { if (!done) { done = true; clearTimeout(timer); code === 0 ? resolve(JSON.parse(out)) : reject(new Error('ffprobe ' + code)); } });
            ff.on('error', e => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
            const timer = setTimeout(() => { if (!done) { done = true; try { ff.kill(); } catch{} reject(new Error('timeout')); } }, 5000);
          });
          const stream = probeData.streams && probeData.streams.find(s => s.codec_type === 'audio');
          if (stream) {
            info.sample_rate = parseInt(stream.sample_rate) || null;
            info.channels = parseInt(stream.channels) || null;
          }
          if (probeData.format && probeData.format.duration) {
            info.duration = parseFloat(probeData.format.duration);
          }
        } catch (e) { /* ffprobe not available */ }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info));
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'file not found' }));
      }
    })();
    return;
  }

  // ── Route : GET /api/audio-stream ────────────────────────────────────────
  // Décode les MP3 BirdNET récents en PCM S16LE et les chaîne en continu.
  // Zéro conflit avec BirdNET — on lit des fichiers, pas le micro.
  if (req.method === 'GET' && pathname === '/api/audio-stream') {

    res.setHeader('Content-Type',       'application/octet-stream');
    res.setHeader('X-Audio-Encoding',   'pcm_s16le');
    res.setHeader('X-Audio-SampleRate', String(AUDIO_RATE));
    res.setHeader('X-Audio-Channels',   '1');
    res.setHeader('Cache-Control',      'no-cache, no-store');
    res.setHeader('Transfer-Encoding',  'chunked');
    res.writeHead(200);

    let aborted  = false;
    let currentFf = null;
    req.on('close', () => {
      aborted = true;
      if (currentFf) try { currentFf.kill(); } catch(e) {}
    });

    // Boucle async : enchaîne les fichiers MP3 en PCM
    (async () => {
      const streamed = new Set();

      // Trouver le point de départ : commencer 3 minutes en arrière
      // pour avoir immédiatement du signal à l'affichage
      const startCutoff = Date.now() - 3 * 60 * 1000;

      // Marquer les fichiers trop anciens comme déjà "streamés"
      const allFiles = await getRecentMp3s();
      for (const f of allFiles) {
        if (f.mtime < startCutoff) streamed.add(f.path);
      }
      console.log(`[audio-stream] démarrage — ${streamed.size} fichiers anciens ignorés`);

      while (!aborted) {
        const pending = (await getRecentMp3s()).filter(f => !streamed.has(f.path));

        if (pending.length === 0) {
          // Aucun fichier nouveau — attendre 2s
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const file = pending[0];
        streamed.add(file.path);
        console.log(`[audio-stream] → ${path.basename(file.path)}`);

        // Décoder MP3 → PCM S16LE via ffmpeg
        await new Promise((resolve) => {
          const ff = spawn('ffmpeg', [
            '-loglevel', 'quiet',
            '-i', file.path,
            '-f', 's16le',
            '-ar', String(AUDIO_RATE),
            '-ac', '1',
            'pipe:1',
          ]);
          currentFf = ff;

          ff.stdout.pipe(res, { end: false });
          ff.stdout.on('end', () => { currentFf = null; resolve(); });
          ff.on('error', err => {
            console.error('[ffmpeg]', err.message);
            currentFf = null;
            resolve();
          });
          // Outer req.on('close') at line 1549 handles cleanup via aborted flag
        });
      }

      if (!res.writableEnded) res.end();
      console.log('[audio-stream] connexion fermée');
    })();

    return;
  }

  // ── Route : GET /api/settings ───────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/settings') {
    (async () => {
      try {
        const conf = await parseBirdnetConf();
        // Redact sensitive fields
        delete conf.CADDY_PWD;
        delete conf.ICE_PWD;
        delete conf.FLICKR_API_KEY;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(conf));
      } catch(e) {
        console.error('[settings]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : POST /api/settings ──────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/settings') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const { updates } = JSON.parse(body);
          if (!updates || typeof updates !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'updates object required' }));
            return;
          }
          // Validate each key
          const validated = {};
          const errors = [];
          for (const [key, val] of Object.entries(updates)) {
            // Skip keys without a validator (pass-through from conf, not editable)
            if (!SETTINGS_VALIDATORS[key]) continue;
            if (!SETTINGS_VALIDATORS[key](val)) {
              errors.push(`Invalid value for ${key}: ${val}`);
              continue;
            }
            validated[key] = val;
          }
          if (errors.length > 0 && Object.keys(validated).length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errors.join('; ') }));
            return;
          }
          await writeBirdnetConf(validated);
          console.log(`[settings] Updated: ${Object.keys(validated).join(', ')}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, updated: Object.keys(validated), warnings: errors.length ? errors : undefined }));
        } catch(e) {
          console.error('[settings]', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return;
  }

  // ── Route : GET /api/apprise ────────────────────────────────────────────────
  // Returns the content of apprise.txt (notification service URLs)
  if (req.method === 'GET' && pathname === '/api/apprise') {
    (async () => {
      const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
      try {
        const content = await fsp.readFile(appriseFile, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ urls: content.trim() }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ urls: '' }));
      }
    })();
    return;
  }

  // ── Route : POST /api/apprise ─────────────────────────────────────────────
  // Saves apprise notification URLs to apprise.txt
  if (req.method === 'POST' && pathname === '/api/apprise') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { urls } = JSON.parse(body);
        if (typeof urls !== 'string') throw new Error('urls must be a string');
        const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
        await fsp.writeFile(appriseFile, urls.trim() + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Route : POST /api/apprise/test ────────────────────────────────────────
  // Sends a test notification via Apprise
  if (req.method === 'POST' && pathname === '/api/apprise/test') {
    (async () => {
      try {
        const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
        const appriseBin = path.join(process.env.HOME, 'birdash', 'engine', 'venv', 'bin', 'apprise');
        const { execFile } = require('child_process');
        const result = await new Promise((resolve, reject) => {
          execFile(appriseBin, [
            '-vv',
            '-t', 'BIRDASH Test',
            '-b', 'This is a test notification from BIRDASH. If you see this, notifications are working!',
            '--config=' + appriseFile
          ], { timeout: 15000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout + stderr);
          });
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, output: result }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/alert-thresholds ───────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/alert-thresholds') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getAlertThresholds()));
    return;
  }

  // ── Route : GET /api/alert-status ─────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/alert-status') {
    const status = {};
    for (const [type, ts] of Object.entries(_alertLastSent)) {
      status[type] = { lastSent: new Date(ts).toISOString(), cooldownRemaining: Math.max(0, ALERT_COOLDOWN - (Date.now() - ts)) };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ alerts: status, interval: ALERT_CHECK_INTERVAL, cooldown: ALERT_COOLDOWN }));
    return;
  }

  // ── Route : GET /api/services ───────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/services') {
    (async () => {
      try {
        const services = [];
        for (const name of ALLOWED_SERVICES) {
          try {
            const state = await execCmd('systemctl', ['is-active', name]);
            let pid = null, memory = 0, uptime = 0;
            if (state === 'active') {
              try {
                const show = await execCmd('systemctl', ['show', name, '--property=MainPID,ActiveEnterTimestamp', '--no-pager']);
                const props = {};
                show.split('\n').forEach(l => { const eq = l.indexOf('='); if (eq > 0) props[l.slice(0, eq)] = l.slice(eq + 1); });
                pid = parseInt(props.MainPID) || null;
                // Uptime from ActiveEnterTimestamp
                const ts = props.ActiveEnterTimestamp || '';
                if (ts) {
                  const cleaned = ts.replace(/^\w+\s+/, '').replace(/\s+\w+$/, '');
                  const startMs = new Date(cleaned).getTime();
                  if (!isNaN(startMs)) uptime = Math.floor((Date.now() - startMs) / 1000);
                }
                // RAM from /proc
                if (pid) {
                  try {
                    const st = await fsp.readFile(`/proc/${pid}/status`, 'utf8');
                    const m = st.match(/VmRSS:\s*(\d+)\s*kB/);
                    if (m) memory = parseInt(m[1]) * 1024;
                  } catch(_) {}
                }
              } catch(_) {}
            }
            services.push({ name, state, pid, memory, uptime });
          } catch(e) {
            services.push({ name, state: 'inactive', pid: null, memory: 0, uptime: 0 });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ services }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : POST /api/services/restart ──────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/services/restart') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const { service } = JSON.parse(body);
          if (!ALLOWED_SERVICES.includes(service)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Service not allowed: ${service}` }));
            return;
          }
          await execCmd('sudo', ['systemctl', 'restart', service]);
          console.log(`[services] Restarted: ${service}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, service, action: 'restart' }));
        } catch(e) {
          console.error('[services]', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ── SYSTEM HEALTH ENDPOINTS ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Route : GET /api/system-health ────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/system-health') {
    (async () => {
      try {
        // Memory
        const memRaw = await fsp.readFile('/proc/meminfo', 'utf8');
        const memParse = k => parseInt((memRaw.match(new RegExp(k + ':\\s+(\\d+)')) || [0,0])[1]) * 1024;
        const memTotal = memParse('MemTotal'), memAvail = memParse('MemAvailable');
        const memUsed = memTotal - memAvail;

        // Load average
        const loadRaw = await fsp.readFile('/proc/loadavg', 'utf8');
        const loadParts = loadRaw.trim().split(/\s+/);
        const loadAvg = [parseFloat(loadParts[0]), parseFloat(loadParts[1]), parseFloat(loadParts[2])];

        // CPU cores
        const cpuRaw = await fsp.readFile('/proc/cpuinfo', 'utf8');
        const cores = (cpuRaw.match(/^processor/gm) || []).length;

        // Uptime
        const uptimeRaw = await fsp.readFile('/proc/uptime', 'utf8');
        const uptimeSecs = parseFloat(uptimeRaw.split(/\s+/)[0]);

        // Temperature
        let temperature = null;
        try {
          const tempRaw = await fsp.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
          temperature = parseInt(tempRaw.trim()) / 1000;
        } catch(e) {}

        // Disk
        const dfOut = await execCmd('df', ['-B1', '/']);
        const dfLine = dfOut.split('\n')[1];
        const dfParts = dfLine.trim().split(/\s+/);
        const disk = { total: parseInt(dfParts[1]), used: parseInt(dfParts[2]), free: parseInt(dfParts[3]), percent: parseInt(dfParts[4]) };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          cpu: { cores, usage: Math.round(loadAvg[0] / cores * 100) },
          memory: { total: memTotal, used: memUsed, free: memAvail, percent: Math.round(memUsed / memTotal * 100) },
          disk,
          temperature,
          uptime: Math.floor(uptimeSecs),
          loadAvg
        }));
      } catch(e) {
        console.error('[system-health]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/services/:name/status ────────────────────────────────────
  const svcStatusMatch = pathname.match(/^\/api\/services\/([^/]+)\/status$/);
  if (req.method === 'GET' && svcStatusMatch) {
    const svcName = svcStatusMatch[1];
    if (!ALLOWED_SERVICES.includes(svcName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Service not allowed: ${svcName}` }));
      return;
    }
    (async () => {
      try {
        const props = await execCmd('systemctl', ['show', svcName,
          '--property=ActiveState,SubState,MainPID,MemoryCurrent,ActiveEnterTimestamp,ExecMainStartTimestamp,Description']);
        const info = {};
        for (const line of props.split('\n')) {
          const eq = line.indexOf('=');
          if (eq > 0) info[line.slice(0, eq)] = line.slice(eq + 1);
        }
        let logs = [];
        try {
          const logRaw = await execCmd('journalctl', ['-u', svcName, '-n', '25', '--no-pager', '-o', 'short-iso']);
          logs = logRaw.split('\n').filter(l => l.trim() && !l.startsWith('--'));
        } catch(e) {}

        // Memory: try MemoryCurrent, fallback to /proc/PID/status VmRSS
        let memBytes = 0;
        if (info.MemoryCurrent && info.MemoryCurrent !== '[not set]') {
          memBytes = parseInt(info.MemoryCurrent) || 0;
        }
        const pid = parseInt(info.MainPID || '0');
        if (memBytes === 0 && pid > 0) {
          try {
            const procStatus = await fsp.readFile(`/proc/${pid}/status`, 'utf8');
            const rssMatch = procStatus.match(/VmRSS:\s*(\d+)\s*kB/);
            if (rssMatch) memBytes = parseInt(rssMatch[1]) * 1024;
          } catch(_) {}
        }

        // Uptime: try ActiveEnterTimestamp (more reliable than ExecMainStartTimestamp)
        let uptimeSecs = 0;
        const tsField = info.ActiveEnterTimestamp || info.ExecMainStartTimestamp || '';
        if (tsField) {
          // systemd format: "Mon 2026-03-21 22:09:51 CET" — remove day-of-week and timezone
          const cleaned = tsField.replace(/^\w+\s+/, '').replace(/\s+\w+$/, '');
          const startMs = new Date(cleaned).getTime();
          if (!isNaN(startMs)) uptimeSecs = Math.floor((Date.now() - startMs) / 1000);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: svcName,
          state: info.ActiveState || 'unknown',
          subState: info.SubState || 'unknown',
          pid: parseInt(info.MainPID || '0'),
          memory: memBytes,
          uptime: uptimeSecs,
          description: info.Description || '',
          logs
        }));
      } catch(e) {
        console.error('[service-status]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : POST /api/services/:name/:action (start|stop) ────────────────────
  const svcActionMatch = pathname.match(/^\/api\/services\/([^/]+)\/(start|stop)$/);
  if (req.method === 'POST' && svcActionMatch) {
    if (!requireAuth(req, res)) return;
    const svcName = svcActionMatch[1];
    const action = svcActionMatch[2];
    if (!ALLOWED_SERVICES.includes(svcName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Service not allowed: ${svcName}` }));
      return;
    }
    (async () => {
      try {
        await execCmd('sudo', ['systemctl', action, svcName]);
        console.log(`[services] ${action}: ${svcName}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: svcName, action }));
      } catch(e) {
        console.error(`[services] ${action} ${svcName}:`, e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/analysis-status ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/analysis-status') {
    (async () => {
      try {
        const conf = await parseBirdnetConf();

        // Backlog: count WAV files in BirdEngine incoming dir
        const incomingDir = path.join(process.env.HOME, 'birdengine', 'audio', 'incoming');
        let backlog = 0, lagSecs = 0;
        try {
          const files = (await fsp.readdir(incomingDir)).filter(f => f.endsWith('.wav')).sort();
          backlog = files.length;
          if (files.length > 0) {
            const stat = await fsp.stat(path.join(incomingDir, files[files.length - 1]));
            lagSecs = Math.floor((Date.now() - stat.mtimeMs) / 1000);
          }
        } catch(e) {
          // No incoming dir = local recording, check last detection time instead
          try {
            const row = db.prepare('SELECT MAX(Date || " " || Time) as last FROM detections').get();
            if (row && row.last) {
              const lastMs = new Date(row.last.replace(' ', 'T')).getTime();
              if (!isNaN(lastMs)) lagSecs = Math.floor((Date.now() - lastMs) / 1000);
            }
          } catch(e2) {}
        }

        // Parse inference times from birdengine logs
        let inferenceTime = null;
        let secondaryModel = conf.DUAL_MODEL_ENABLED === '1' ? (conf.SECONDARY_MODEL || null) : null;
        let secondaryInferenceTime = null;
        try {
          const logOut = await execCmd('journalctl', ['-u', 'birdengine', '-n', '200', '--no-pager']);
          // Primary model timing
          const primaryMatch = logOut.match(/\[BirdNET[^\]]*\] Done: \d+ detections in ([\d.]+)s/g);
          if (primaryMatch && primaryMatch.length > 0) {
            inferenceTime = parseFloat(primaryMatch[primaryMatch.length - 1].match(/in ([\d.]+)s/)[1]);
          }
          // Secondary model timing (match any Perch variant)
          const secMatch = logOut.match(/\[Perch_v2[^\]]*\] .+\.wav: \d+ detections in ([\d.]+)s/g);
          if (secMatch && secMatch.length > 0) {
            secondaryInferenceTime = parseFloat(secMatch[secMatch.length - 1].match(/in ([\d.]+)s/)[1]);
          }
        } catch(e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          model: conf.MODEL || 'unknown',
          secondaryModel,
          sfThresh: parseFloat(conf.SF_THRESH || '0.03'),
          sensitivity: parseFloat(conf.SENSITIVITY || '1.0'),
          confidence: parseFloat(conf.CONFIDENCE || '0.7'),
          backlog,
          lagSecs, lag: lagSecs,
          inferenceTime,
          secondaryInferenceTime,
          recordingLength: parseInt(conf.RECORDING_LENGTH || '45')
        }));
      } catch(e) {
        console.error('[analysis-status]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/audio-device ─────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio-device') {
    (async () => {
      try {
        const conf = await parseBirdnetConf();
        let devices = '';
        try { devices = await execCmd('arecord', ['-l']); } catch(e) { devices = e.message; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          recCard: conf.REC_CARD || 'default',
          channels: parseInt(conf.CHANNELS || '1'),
          audioFmt: conf.AUDIOFMT || 'mp3',
          devices
        }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/backup-status ────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup-status') {
    (async () => {
      try {
        const nfsPath = (_localConfig && _localConfig.nfsMountPath) || '/mnt/backup';
        const backupPath = (_localConfig && _localConfig.backupPath) || path.join(nfsPath, 'Backup', 'biloute');
        let mounted = false;
        try {
          await execCmd('mountpoint', ['-q', nfsPath]);
          mounted = true;
        } catch(e) {}

        let lastBackup = null, backupSize = null;
        if (mounted) {
          try {
            const sizeOut = await execCmd('du', ['-sb', backupPath]);
            backupSize = parseInt(sizeOut.split(/\s/)[0]);
          } catch(e) {}
          // Last backup from log
          try {
            const logRaw = await fsp.readFile('/var/log/backup-biloute.log', 'utf8');
            const matches = logRaw.match(/\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] Backup terminé/g);
            if (matches && matches.length > 0) {
              const last = matches[matches.length - 1];
              lastBackup = last.match(/\[(.+?)\]/)[1];
            }
          } catch(e) {}
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ nfsPath, mounted, lastBackup, backupSize }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/network-info ─────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/network-info') {
    (async () => {
      try {
        const hostname = (await fsp.readFile('/etc/hostname', 'utf8')).trim();
        let ip = '';
        try { ip = (await execCmd('hostname', ['-I'])).trim().split(/\s+/)[0]; } catch(e) {}

        const nasIp = (_localConfig && _localConfig.nasIp) || null;
        let nasPing = null;
        if (nasIp) {
          try {
            const pingOut = await execCmd('ping', ['-c', '1', '-W', '2', nasIp]);
            const latMatch = pingOut.match(/time=([\d.]+)/);
            nasPing = { reachable: true, latency: latMatch ? parseFloat(latMatch[1]) : 0 };
          } catch(e) {
            nasPing = { reachable: false, latency: 0 };
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hostname, ip, nasIp, nasPing }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/hardware ───────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/hardware') {
    (async () => {
      try {
        // Pi model
        let piModel = '';
        try { piModel = (await fsp.readFile('/proc/device-tree/model', 'utf8')).replace(/\0/g, '').trim(); } catch(_) {}

        // CPU info
        let cpuModel = '', cpuFreq = 0;
        try {
          const cpuinfo = await fsp.readFile('/proc/cpuinfo', 'utf8');
          const mm = cpuinfo.match(/model name\s*:\s*(.+)/i) || cpuinfo.match(/Model\s*:\s*(.+)/i);
          if (mm) cpuModel = mm[1].trim();
          const fm = cpuinfo.match(/cpu MHz\s*:\s*([\d.]+)/i);
          if (fm) cpuFreq = Math.round(parseFloat(fm[1]));
        } catch(_) {}
        // On Pi, freq from scaling_cur_freq
        if (!cpuFreq) {
          try { cpuFreq = Math.round(parseInt(await fsp.readFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq', 'utf8')) / 1000); } catch(_) {}
        }

        // Total RAM
        let ramTotal = 0;
        try {
          const meminfo = await fsp.readFile('/proc/meminfo', 'utf8');
          const m = meminfo.match(/MemTotal:\s*(\d+)/);
          if (m) ramTotal = parseInt(m[1]) * 1024; // kB → bytes
        } catch(_) {}

        // Block devices (disks)
        const disks = [];
        try {
          const lsblk = await execCmd('lsblk', ['-J', '-b', '-o', 'NAME,SIZE,TYPE,TRAN,MODEL,MOUNTPOINT,FSTYPE']);
          const data = JSON.parse(lsblk);
          (data.blockdevices || []).forEach(d => {
            if (d.type === 'disk') {
              const mounts = (d.children || []).filter(c => c.mountpoint).map(c => c.mountpoint);
              disks.push({
                name: d.name,
                size: parseInt(d.size) || 0,
                transport: d.tran || '',
                model: (d.model || '').trim(),
                mounts,
                fstype: (d.children && d.children[0] && d.children[0].fstype) || ''
              });
            }
          });
        } catch(_) {}

        // Sound cards
        const soundCards = [];
        try {
          const cards = await fsp.readFile('/proc/asound/cards', 'utf8');
          cards.split('\n').forEach(line => {
            const m = line.match(/^\s*(\d+)\s+\[(\w+)\s*\]:\s*(.+)/);
            if (m) soundCards.push({ id: parseInt(m[1]), shortName: m[2], name: m[3].trim() });
          });
        } catch(_) {}

        // USB devices
        const usbDevices = [];
        try {
          const lsusb = await execCmd('lsusb', []);
          lsusb.split('\n').forEach(line => {
            const m = line.match(/Bus\s+(\d+)\s+Device\s+(\d+):\s+ID\s+(\S+)\s+(.*)/);
            if (m && !m[4].match(/hub/i)) usbDevices.push({ bus: m[1], device: m[2], id: m[3], name: m[4].trim() });
          });
        } catch(_) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ piModel, cpuModel, cpuFreq, ramTotal, disks, soundCards, usbDevices }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/models ─────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/models') {
    (async () => {
      try {
        const modelDir = path.join(BIRDNET_DIR, 'models');
        const files = await fsp.readdir(modelDir);
        const models = files
          .filter(f => f.endsWith('.tflite'))
          .map(f => f.replace('.tflite', ''));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/languages ──────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/languages') {
    (async () => {
      try {
        const labelDir = path.join(BIRDNET_DIR, 'models', 'l18n');
        const files = await fsp.readdir(labelDir);
        const languages = files
          .filter(f => f.startsWith('labels_') && f.endsWith('.json'))
          .map(f => f.replace('labels_', '').replace('.json', ''))
          .sort();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ languages }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/species-lists ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/species-lists') {
    (async () => {
      try {
        const readList = async (name) => {
          const fp = path.join(BIRDNET_DIR, name);
          try {
            const raw = await fsp.readFile(fp, 'utf8');
            return raw.split('\n').map(l => l.trim()).filter(Boolean);
          } catch(e) { return []; }
        };
        const include = await readList('include_species_list.txt');
        const exclude = await readList('exclude_species_list.txt');
        const whitelist = await readList('whitelist_species_list.txt');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ include, exclude, whitelist }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : POST /api/species-lists ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/species-lists') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const { list, species } = JSON.parse(body);
          const validLists = { include: 'include_species_list.txt', exclude: 'exclude_species_list.txt', whitelist: 'whitelist_species_list.txt' };
          if (!validLists[list]) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Invalid list: ${list}` }));
            return;
          }
          if (!Array.isArray(species)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'species must be an array' }));
            return;
          }
          const fp = path.join(BIRDNET_DIR, validLists[list]);
          await fsp.writeFile(fp, species.join('\n') + '\n');
          console.log(`[species-lists] Updated ${list}: ${species.length} species`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, list, count: species.length }));
        } catch(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return;
  }

  // Route : POST /api/query
  if (req.method === 'POST' && pathname === '/api/query') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { sql, params = [] } = JSON.parse(body);

        if (!validateQuery(sql)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Requête non autorisée' }));
          return;
        }

        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);

        // Extrait les noms de colonnes depuis la première ligne
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        const data    = rows.map(r => columns.map(c => r[c]));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ columns, rows: data }));

      } catch (err) {
        console.error('[BIRDASH] Erreur SQL :', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Erreur interne lors de l\'exécution de la requête' }));
      }
    });
    return;
  }

  // ── Route : DELETE /api/detections ─────────────────────────────────────────
  // Delete a single detection by composite key (Date + Time + Com_Name)
  if (req.method === 'DELETE' && pathname === '/api/detections') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const { date, time, comName } = JSON.parse(body);
          if (!date || !time || !comName) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'date, time, comName required' }));
            return;
          }

          // Get file names before deleting
          const rows = dbWrite.prepare(
            'SELECT File_Name FROM detections WHERE Date=? AND Time=? AND Com_Name=?'
          ).all(date, time, comName);

          if (rows.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Detection not found' }));
            return;
          }

          // Delete from DB
          const result = dbWrite.prepare(
            'DELETE FROM detections WHERE Date=? AND Time=? AND Com_Name=?'
          ).run(date, time, comName);

          // Delete associated files (mp3 + png)
          const fileErrors = [];
          for (const row of rows) {
            const m = row.File_Name.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
            if (!m) continue;
            const filePath = path.join(SONGS_DIR, m[2], m[1], row.File_Name);
            for (const fp of [filePath, filePath + '.png']) {
              try { await fsp.unlink(fp); } catch(e) {
                if (e.code !== 'ENOENT') fileErrors.push(fp);
              }
            }
          }

          console.log(`[delete] Removed ${result.changes} detection(s): ${comName} ${date} ${time}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, deleted: result.changes, fileErrors }));
        } catch(e) {
          console.error('[delete]', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return;
  }

  // ── Route : DELETE /api/detections/species ─────────────────────────────────
  // Bulk-delete ALL detections for a species (requires typed confirmation)
  if (req.method === 'DELETE' && pathname === '/api/detections/species') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const { comName, confirmName } = JSON.parse(body);
          if (!comName || typeof comName !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'comName required' }));
            return;
          }
          // Safety: user must type the exact species name to confirm
          if (confirmName !== comName) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Confirmation name does not match' }));
            return;
          }

          // Get all file names first
          const rows = dbWrite.prepare(
            'SELECT File_Name FROM detections WHERE Com_Name=?'
          ).all(comName);

          if (rows.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No detections found for this species' }));
            return;
          }

          // Delete all from DB in a transaction
          const deleteAll = dbWrite.transaction(() => {
            return dbWrite.prepare('DELETE FROM detections WHERE Com_Name=?').run(comName);
          });
          const result = deleteAll();

          // Delete associated files
          const fileErrors = [];
          let filesDeleted = 0;
          for (const row of rows) {
            const m = row.File_Name.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
            if (!m) continue;
            const filePath = path.join(SONGS_DIR, m[2], m[1], row.File_Name);
            for (const fp of [filePath, filePath + '.png']) {
              try { await fsp.unlink(fp); filesDeleted++; } catch(e) {
                if (e.code !== 'ENOENT') fileErrors.push(fp);
              }
            }
          }

          // Try to clean up empty directories
          const dirs = new Set();
          for (const row of rows) {
            const m = row.File_Name.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
            if (m) dirs.add(path.join(SONGS_DIR, m[2], m[1]));
          }
          for (const dir of dirs) {
            try {
              const remaining = await fsp.readdir(dir);
              if (remaining.length === 0) await fsp.rmdir(dir);
            } catch(e) { /* ignore */ }
          }

          console.log(`[delete-species] Removed ${result.changes} detections for "${comName}", ${filesDeleted} files deleted`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, deleted: result.changes, filesDeleted, fileErrors }));
        } catch(e) {
          console.error('[delete-species]', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return;
  }

  // ── Route : GET /api/taxonomy ─────────────────────────────────────────────
  // Returns taxonomy for all detected species (joined with detections)
  if (req.method === 'GET' && pathname === '/api/taxonomy') {
    (async () => {
      try {
        if (!taxonomyDb) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Taxonomy database not available' }));
          return;
        }
        const params = new URL(req.url, 'http://x').searchParams;
        const lang = params.get('lang') || '';

        // Build a family_sci → localized family_com map if lang is provided
        const famTr = {};
        if (lang && lang !== 'en') {
          const trRows = taxonomyDb.prepare('SELECT family_sci, family_com FROM family_translations WHERE locale = ?').all(lang);
          for (const r of trRows) famTr[r.family_sci] = r.family_com;
        }

        // Get all detected species
        const detected = db.prepare('SELECT DISTINCT Sci_Name, Com_Name FROM detections ORDER BY Sci_Name').all();
        // Lookup taxonomy for each
        const lookup = taxonomyDb.prepare('SELECT * FROM species_taxonomy WHERE sci_name = ?');
        const result = detected.map(d => {
          const tax = lookup.get(d.Sci_Name);
          const familyCom = tax ? (famTr[tax.family_sci] || tax.family_com) : null;
          return {
            sciName: d.Sci_Name,
            comName: d.Com_Name,
            order: tax ? tax.order_name : null,
            familySci: tax ? tax.family_sci : null,
            familyCom,
            ebirdCode: tax ? tax.ebird_code : null,
            taxonOrder: tax ? tax.taxon_order : null,
          };
        });
        // Build summary: orders and families with counts
        const orders = {}, families = {};
        for (const r of result) {
          if (r.order) orders[r.order] = (orders[r.order] || 0) + 1;
          if (r.familySci) {
            if (!families[r.familySci]) families[r.familySci] = { name: r.familyCom, order: r.order, count: 0 };
            families[r.familySci].count++;
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ species: result, orders, families }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/detections-by-taxonomy ─────────────────────────────────
  // Returns detection counts grouped by order and family
  if (req.method === 'GET' && pathname === '/api/detections-by-taxonomy') {
    (async () => {
      try {
        if (!taxonomyDb) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Taxonomy database not available' }));
          return;
        }
        const params = new URL(req.url, 'http://x').searchParams;
        const dateFrom = params.get('from') || '';
        const dateTo = params.get('to') || '';
        const lang = params.get('lang') || '';

        // Build a family_sci → localized family_com map if lang is provided
        const famTr = {};
        if (lang && lang !== 'en') {
          const trRows = taxonomyDb.prepare('SELECT family_sci, family_com FROM family_translations WHERE locale = ?').all(lang);
          for (const r of trRows) famTr[r.family_sci] = r.family_com;
        }

        let whereClause = '';
        const args = [];
        if (dateFrom) { whereClause += ' AND d.Date >= ?'; args.push(dateFrom); }
        if (dateTo)   { whereClause += ' AND d.Date <= ?'; args.push(dateTo); }

        // Get detection counts per species
        const rows = db.prepare(
          `SELECT Sci_Name, Com_Name, COUNT(*) as count FROM detections d WHERE 1=1 ${whereClause} GROUP BY Sci_Name ORDER BY count DESC`
        ).all(...args);

        const lookup = taxonomyDb.prepare('SELECT * FROM species_taxonomy WHERE sci_name = ?');

        // Build grouped results
        const byOrder = {};
        for (const r of rows) {
          const tax = lookup.get(r.Sci_Name);
          const order = tax ? tax.order_name : 'Unknown';
          const family = tax ? tax.family_sci : 'Unknown';
          const familyCom = tax ? (famTr[tax.family_sci] || tax.family_com) : 'Unknown';
          if (!byOrder[order]) byOrder[order] = { count: 0, species: 0, families: {} };
          byOrder[order].count += r.count;
          byOrder[order].species++;
          if (!byOrder[order].families[family]) byOrder[order].families[family] = { name: familyCom, count: 0, species: 0 };
          byOrder[order].families[family].count += r.count;
          byOrder[order].families[family].species++;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ byOrder, total: rows.reduce((s, r) => s + r.count, 0) }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/backup-config ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup-config') {
    (async () => {
      try {
        const cfgPath = path.join(__dirname, '..', 'config', 'backup.json');
        let config = { destination: 'local', content: ['all'], schedule: 'manual', scheduleTime: '02:00', retention: 30, local: { path: '/mnt/backup' }, smb: { host: '', share: '', user: '', pass: '', remotePath: '/birdash-backup' }, nfs: { host: '', exportPath: '', mountPoint: '/mnt/nfs-backup', remotePath: '/birdash-backup' }, sftp: { host: '', port: 22, user: '', pass: '', remotePath: '/birdash-backup' }, s3: { bucket: '', region: 'eu-west-1', accessKey: '', secretKey: '', remotePath: 'birdash-backup' }, gdrive: { folderId: '' }, webdav: { url: '', user: '', pass: '', remotePath: '/birdash-backup' }, lastRun: null, lastStatus: null };
        try {
          const raw = await fsp.readFile(cfgPath, 'utf8');
          config = { ...config, ...JSON.parse(raw) };
        } catch(e) {}
        // Redact passwords for frontend
        const safe = JSON.parse(JSON.stringify(config));
        if (safe.smb && safe.smb.pass) safe.smb.pass = safe.smb.pass ? '••••••' : '';
        if (safe.sftp && safe.sftp.pass) safe.sftp.pass = safe.sftp.pass ? '••••••' : '';
        if (safe.s3 && safe.s3.secretKey) safe.s3.secretKey = safe.s3.secretKey ? '••••••' : '';
        if (safe.webdav && safe.webdav.pass) safe.webdav.pass = safe.webdav.pass ? '••••••' : '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(safe));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : POST /api/backup-config ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/backup-config') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const updates = JSON.parse(body);
        const cfgPath = path.join(__dirname, '..', 'config', 'backup.json');
        const cfgDir = path.dirname(cfgPath);
        if (!fs.existsSync(cfgDir)) fs.mkdirSync(cfgDir, { recursive: true });

        // Load existing config to preserve secrets when redacted
        let existing = {};
        try { existing = JSON.parse(await fsp.readFile(cfgPath, 'utf8')); } catch(e) {}

        // Validate destination type
        const validDest = ['local', 'smb', 'nfs', 'sftp', 's3', 'gdrive', 'webdav'];
        if (updates.destination && !validDest.includes(updates.destination)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid destination type' }));
          return;
        }

        // Validate content array
        const validContent = ['all', 'db', 'audio', 'config'];
        if (updates.content && (!Array.isArray(updates.content) || !updates.content.every(c => validContent.includes(c)))) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid content selection' }));
          return;
        }

        // Validate schedule
        const validSched = ['manual', 'daily', 'weekly'];
        if (updates.schedule && !validSched.includes(updates.schedule)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid schedule' }));
          return;
        }

        // Preserve passwords if sent as redacted
        for (const section of ['smb', 'sftp', 'webdav']) {
          if (updates[section] && updates[section].pass === '••••••' && existing[section]) {
            updates[section].pass = existing[section].pass;
          }
        }
        if (updates.s3 && updates.s3.secretKey === '••••••' && existing.s3) {
          updates.s3.secretKey = existing.s3.secretKey;
        }

        // Merge and save
        const merged = { ...existing, ...updates };
        await fsp.writeFile(cfgPath, JSON.stringify(merged, null, 2));

        // Update cron if schedule changed
        await updateBackupCron(merged);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Route : POST /api/backup-run ────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/backup-run') {
    if (!requireAuth(req, res)) return;
    (async () => {
      try {
        const cfgPath = path.join(__dirname, '..', 'config', 'backup.json');
        let config;
        try { config = JSON.parse(await fsp.readFile(cfgPath, 'utf8')); }
        catch(e) { throw new Error('No backup configuration found'); }

        const scriptPath = path.join(__dirname, '..', 'scripts', 'backup.sh');
        if (!fs.existsSync(scriptPath)) {
          throw new Error('Backup script not found: scripts/backup.sh');
        }

        // Run backup script asynchronously
        const statusPath = path.join(__dirname, '..', 'config', 'backup-status.json');
        const proc = spawn('bash', [scriptPath], { env: { ...process.env, BACKUP_CONFIG: cfgPath, BACKUP_STATUS: statusPath } });
        _activeBackupProc = proc; // Track for graceful shutdown
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => stdout += d);
        proc.stderr.on('data', d => stderr += d);
        proc.on('close', async (code) => {
          const status = code === 0 ? 'success' : 'failed';
          const now = new Date().toISOString();
          try {
            const cfg = JSON.parse(await fsp.readFile(cfgPath, 'utf8'));
            cfg.lastRun = now;
            cfg.lastStatus = status;
            cfg.lastMessage = code === 0 ? '' : (stderr || stdout).slice(0, 500);
            await fsp.writeFile(cfgPath, JSON.stringify(cfg, null, 2));
          } catch(e) {}
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Backup started' }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/backup-progress ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup-progress') {
    (async () => {
      try {
        const statusPath = path.join(__dirname, '..', 'config', 'backup-status.json');
        let status = { state: 'idle', percent: 0, step: '', detail: '', startedAt: null, updatedAt: null };
        try {
          const raw = await fsp.readFile(statusPath, 'utf8');
          status = JSON.parse(raw);
          // If last update was more than 5 minutes ago and state is "running", mark as stale
          if (status.state === 'running' && status.updatedAt) {
            const elapsed = Date.now() - new Date(status.updatedAt).getTime();
            if (elapsed > 5 * 60 * 1000) {
              status.state = 'stale';
              status.detail = 'No update for ' + Math.round(elapsed / 60000) + ' min';
            }
          }
        } catch(e) {}

        // If no new-style backup is running, detect legacy backup-biloute.sh
        if (status.state === 'idle' || status.state === 'completed' || status.state === 'failed' || status.state === 'stopped') {
          try {
            const psOut = await execCmd('pgrep', ['-af', 'backup-biloute\\.sh']);
            if (psOut.trim()) {
              // Legacy backup has 4 steps: db(0-5%), config(5-10%), projects(10-25%), audio(25-100%)
              let step = 'init', detail = 'backup-biloute.sh (legacy)', percent = 2;

              // Detect current step from log file
              // Use grep to find last step marker (log can be huge with rsync output)
              try {
                // Find the last "Étape N" line in the log
                let lastStep = '';
                try {
                  lastStep = await execCmd('bash', ['-c', "grep -n 'tape [1-4]' /var/log/backup-biloute.log | tail -1"]);
                } catch(eG) {}
                // Also check completion markers
                let completionLines = '';
                try {
                  completionLines = await execCmd('tail', ['-5', '/var/log/backup-biloute.log']);
                } catch(eT) {}

                if (/tape 4/i.test(lastStep) || /BirdSongs/i.test(lastStep)) {
                  step = 'audio'; detail = 'BirdSongs rsync (legacy)'; percent = 25;
                  // Parse rsync progress from the last lines of the log
                  // Multiple rsync instances may interleave — take the max percentage
                  try {
                    const logTail = await execCmd('tail', ['-50', '/var/log/backup-biloute.log']);
                    const pctMatches = logTail.match(/\b(\d{1,3})%/g);
                    if (pctMatches && pctMatches.length) {
                      const allPcts = pctMatches.map(m => parseInt(m)).filter(n => !isNaN(n) && n >= 0 && n <= 100);
                      if (allPcts.length) {
                        const maxPct = Math.max(...allPcts);
                        percent = 25 + Math.round(maxPct * 73 / 100); // Scale 0-100% into 25-98%
                        // Extract last synced filename from log lines (lines without %)
                        const fileLines = logTail.split('\n').filter(l => l.trim() && !/\d+%/.test(l) && !l.startsWith('['));
                        const lastFile = fileLines.length ? fileLines[fileLines.length - 1].trim() : '';
                        if (lastFile) {
                          // Show just the filename, not the full path
                          const shortName = lastFile.split('/').pop();
                          detail = shortName;
                        } else {
                          detail = 'Synchronisation BirdSongs…';
                        }
                      }
                    }
                  } catch(eR) {}
                  // If finished
                  if (/BirdSongs OK/i.test(completionLines)) { percent = 98; detail = 'Finalisation...'; }
                } else if (/tape 3/i.test(lastStep)) {
                  step = 'projects'; detail = 'Sync projets (legacy)'; percent = 15;
                  // Extract current file from log
                  try {
                    const logTail3 = await execCmd('tail', ['-20', '/var/log/backup-biloute.log']);
                    const fileLines3 = logTail3.split('\n').filter(l => l.trim() && !/\d+%/.test(l) && !l.startsWith('[') && !/rsync error/i.test(l));
                    if (fileLines3.length) {
                      const shortName = fileLines3[fileLines3.length - 1].trim().split('/').pop();
                      if (shortName) detail = shortName;
                    }
                  } catch(eF) {}
                  if (/Projets OK/i.test(completionLines)) { percent = 24; }
                } else if (/tape 2/i.test(lastStep)) {
                  step = 'config'; detail = 'Configuration (legacy)'; percent = 8;
                  if (/Configurations OK/i.test(completionLines)) { percent = 10; }
                } else if (/tape 1/i.test(lastStep)) {
                  step = 'db'; detail = 'Bases de données (legacy)'; percent = 3;
                  if (/Bases de donn.*OK/i.test(completionLines)) { percent = 5; }
                }
              } catch(eLog) {
                // Fallback: detect step from running processes
                try {
                  const rsyncPs = await execCmd('pgrep', ['-af', 'rsync.*BirdSongs']);
                  if (rsyncPs.trim()) { step = 'audio'; detail = 'BirdSongs rsync (legacy)'; percent = 50; }
                } catch(e2) {
                  try {
                    const rsyncPs2 = await execCmd('pgrep', ['-af', 'rsync.*/mnt/backup']);
                    if (rsyncPs2.trim()) { step = 'projects'; detail = 'Sync projets (legacy)'; percent = 15; }
                  } catch(e3) {}
                }
              }

              let startedAt = null;
              try {
                const pid = psOut.trim().split('\n')[0].trim().split(/\s+/)[0];
                const elapsed = await execCmd('ps', ['-o', 'etimes=', '-p', pid]);
                const secs = parseInt(elapsed.trim());
                if (!isNaN(secs)) startedAt = new Date(Date.now() - secs * 1000).toISOString();
              } catch(e4) {}
              // Check if paused (SIGSTOP → T state)
              let paused = false;
              try {
                const statOut = await execCmd('bash', ['-c', "ps -eo pid,state,args | grep 'backup-biloute' | grep -v grep | head -1"]);
                if (/\bT\b/.test(statOut)) paused = true;
              } catch(e5) {}
              status = { state: paused ? 'paused' : 'running', percent, step, detail, startedAt, updatedAt: new Date().toISOString(), legacy: true };
            }
          } catch(e) { /* pgrep returns 1 when no match */ }
        }

        // Enrich with disk info for any running/paused backup
        if (status.state === 'running' || status.state === 'paused') {
          const nfsPath = (_localConfig && _localConfig.nfsMountPath) || '/mnt/backup';
          // df is instant — always include
          try {
            const dfOut = await execCmd('df', ['-B1', '--output=size,used,avail', nfsPath]);
            const dfLines = dfOut.trim().split('\n');
            if (dfLines.length >= 2) {
              const parts = dfLines[1].trim().split(/\s+/);
              status.diskTotal = parseInt(parts[0]) || 0;
              status.diskUsed = parseInt(parts[1]) || 0;
              status.diskFree = parseInt(parts[2]) || 0;
            }
          } catch(e) {}
          // Backup size: use diskUsed from df (already represents total usage on the NFS mount)
          // This avoids the very slow du -sb on large backup dirs
          status.backupSize = status.diskUsed || 0;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/backup-history ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup-history') {
    (async () => {
      const histPath = path.join(__dirname, '..', 'config', 'backup-history.json');
      try {
        const raw = await fsp.readFile(histPath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(raw);
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
    })();
    return;
  }

  // ── Route : GET /api/backup-schedule ───────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup-schedule') {
    (async () => {
      try {
        const cronOut = await execCmd('crontab', ['-l']);
        const line = cronOut.split('\n').find(l => l.includes('BIRDASH_BACKUP') && !l.startsWith('#'));
        let schedule = null;
        if (line) {
          const parts = line.trim().split(/\s+/);
          const min = parts[0], hour = parts[1], dow = parts[4];
          const time = (hour.length === 1 ? '0' : '') + hour + ':' + (min.length === 1 ? '0' : '') + min;
          const type = dow === '*' ? 'daily' : 'weekly';
          const now = new Date();
          const next = new Date(now);
          next.setHours(parseInt(hour), parseInt(min), 0, 0);
          if (type === 'weekly') {
            const targetDay = parseInt(dow);
            let daysUntil = (targetDay - now.getDay() + 7) % 7;
            if (daysUntil === 0 && next <= now) daysUntil = 7;
            next.setDate(now.getDate() + daysUntil);
          } else {
            if (next <= now) next.setDate(next.getDate() + 1);
          }
          schedule = { type, time, nextRun: next.toISOString(), cronLine: line.trim() };
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ schedule }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ schedule: null }));
      }
    })();
    return;
  }

  // ── Route : POST /api/backup-pause ────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/backup-pause') {
    if (!requireAuth(req, res)) return;
    (async () => {
      try {
        // Find backup process (new or legacy)
        let pids = [];
        for (const pattern of ['backup-biloute\\.sh', 'scripts/backup\\.sh']) {
          try {
            const out = await execCmd('pgrep', ['-f', pattern]);
            pids.push(...out.trim().split('\n').filter(Boolean));
          } catch(e) {}
        }
        // Also find child rsync processes
        try {
          const out = await execCmd('pgrep', ['-f', 'rsync.*/mnt/backup']);
          pids.push(...out.trim().split('\n').filter(Boolean));
        } catch(e) {}
        try {
          const out = await execCmd('pgrep', ['-f', 'rsync.*BirdSongs']);
          pids.push(...out.trim().split('\n').filter(Boolean));
        } catch(e) {}

        if (pids.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No backup process found' }));
          return;
        }

        const unique = [...new Set(pids)];
        // Check current state — if stopped (T), resume with SIGCONT; else pause with SIGSTOP
        let action = 'pause';
        try {
          const statOut = await execCmd('bash', ['-c', `cat /proc/${unique[0]}/status 2>/dev/null | grep State`]);
          if (/stopped|tracing/.test(statOut)) action = 'resume';
        } catch(e) {}

        const signal = action === 'pause' ? 'STOP' : 'CONT';
        for (const pid of unique) {
          try { await execCmd('kill', [`-${signal}`, pid]); } catch(e) {}
        }

        // Update status file
        const statusPath = path.join(__dirname, '..', 'config', 'backup-status.json');
        try {
          const raw = await fsp.readFile(statusPath, 'utf8');
          const s = JSON.parse(raw);
          if (action === 'pause') { s.state = 'paused'; s.detail = 'Mis en pause'; }
          else { s.state = 'running'; s.detail = 'Reprise...'; }
          s.updatedAt = new Date().toISOString();
          await fsp.writeFile(statusPath, JSON.stringify(s));
        } catch(e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, action }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : POST /api/backup-stop ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/backup-stop') {
    if (!requireAuth(req, res)) return;
    (async () => {
      try {
        let pids = [];
        for (const pattern of ['backup-biloute\\.sh', 'scripts/backup\\.sh']) {
          try {
            const out = await execCmd('pgrep', ['-f', pattern]);
            pids.push(...out.trim().split('\n').filter(Boolean));
          } catch(e) {}
        }
        try {
          const out = await execCmd('pgrep', ['-f', 'rsync.*/mnt/backup']);
          pids.push(...out.trim().split('\n').filter(Boolean));
        } catch(e) {}
        try {
          const out = await execCmd('pgrep', ['-f', 'rsync.*BirdSongs']);
          pids.push(...out.trim().split('\n').filter(Boolean));
        } catch(e) {}

        if (pids.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No backup process found' }));
          return;
        }

        const unique = [...new Set(pids)];
        // First SIGCONT (in case paused), then SIGTERM
        for (const pid of unique) {
          try { await execCmd('kill', ['-CONT', pid]); } catch(e) {}
        }
        for (const pid of unique) {
          try { await execCmd('kill', ['-TERM', pid]); } catch(e) {}
        }

        // Update status file
        const statusPath = path.join(__dirname, '..', 'config', 'backup-status.json');
        try {
          const s = { state: 'stopped', percent: 0, step: '', detail: 'Arrêté par l\'utilisateur', startedAt: null, updatedAt: new Date().toISOString() };
          // Try to preserve percent from existing status
          try {
            const raw = await fsp.readFile(statusPath, 'utf8');
            const prev = JSON.parse(raw);
            s.percent = prev.percent || 0;
            s.step = prev.step || '';
            s.startedAt = prev.startedAt;
          } catch(e) {}
          await fsp.writeFile(statusPath, JSON.stringify(s));
        } catch(e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, killed: unique.length }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // Route : GET /api/export/ebird
  if (req.method === 'GET' && pathname === '/api/export/ebird') {
    (async () => {
    try {
      const qp   = new URL(req.url, 'http://localhost').searchParams;
      const from = qp.get('from') || '2000-01-01';
      const to   = qp.get('to')   || '2099-12-31';
      const conf = parseFloat(qp.get('conf') || '0');

      const rows = db.prepare(
        'SELECT Com_Name, Sci_Name, Date, COUNT(*) as cnt FROM detections WHERE Date BETWEEN ? AND ? AND Confidence >= ? GROUP BY Date, Com_Name ORDER BY Date, Com_Name'
      ).all(from, to, conf);

      const bConf = await parseBirdnetConf();
      const lat = bConf.LATITUDE  || '';
      const lon = bConf.LONGITUDE || '';

      const csvHeaders = 'Common Name,Genus,Species,Number,Date,Start Time,State/Province,Country,Location,Latitude,Longitude,Protocol,Duration,All Obs Reported';
      const csvLines = [csvHeaders];
      for (const r of rows) {
        const parts = (r.Sci_Name || '').split(' ');
        const genus   = parts[0] || '';
        const species = parts.slice(1).join(' ') || '';
        // Convert YYYY-MM-DD to MM/DD/YYYY
        const dp = (r.Date || '').split('-');
        const dateFmt = dp.length === 3 ? dp[1] + '/' + dp[2] + '/' + dp[0] : r.Date;
        csvLines.push([
          '"' + (r.Com_Name || '').replace(/"/g, '""') + '"',
          '"' + genus.replace(/"/g, '""') + '"',
          '"' + species.replace(/"/g, '""') + '"',
          r.cnt,
          dateFmt,
          '',
          '',
          '',
          '',
          lat,
          lon,
          'Stationary',
          '',
          'N',
        ].join(','));
      }

      const csv = csvLines.join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="birdash-ebird-' + from + '-to-' + to + '.csv"',
      });
      res.end(csv);
    } catch (err) {
      console.error('[ebird-export]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    })();
    return;
  }

  // ── Route : GET /api/validations ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/validations') {
    if (!birdashDb) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'birdash.db not available' }));
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const date    = url.searchParams.get('date');
      const species = url.searchParams.get('species');
      let sql = 'SELECT date, time, sci_name, status, notes, updated_at FROM validations';
      const conditions = [];
      const params = [];
      if (date) { conditions.push('date = ?'); params.push(date); }
      if (species) { conditions.push('sci_name = ?'); params.push(species); }
      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY date DESC, time DESC';
      const rows = birdashDb.prepare(sql).all(...params);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch (err) {
      console.error('[validations GET]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── Route : POST /api/validations ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/validations') {
    if (!requireAuth(req, res)) return;
    if (!birdashDb) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'birdash.db not available' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { date, time, sciName, status, notes } = JSON.parse(body);
        if (!date || !time || !sciName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'date, time, sciName required' }));
          return;
        }
        const validStatuses = ['confirmed', 'doubtful', 'rejected', 'unreviewed'];
        if (status && !validStatuses.includes(status)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid status. Must be: ' + validStatuses.join(', ') }));
          return;
        }
        const now = new Date().toISOString();
        // If status is 'unreviewed', delete the row (reset)
        if (status === 'unreviewed') {
          birdashDb.prepare('DELETE FROM validations WHERE date = ? AND time = ? AND sci_name = ?')
            .run(date, time, sciName);
        } else {
          birdashDb.prepare(`INSERT INTO validations (date, time, sci_name, status, notes, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, time, sci_name) DO UPDATE SET
              status = excluded.status,
              notes = COALESCE(excluded.notes, notes),
              updated_at = excluded.updated_at`)
            .run(date, time, sciName, status || 'unreviewed', notes || '', now);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('[validations POST]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // ── Route : GET /api/validation-stats ─────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/validation-stats') {
    if (!birdashDb) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'birdash.db not available' }));
      return;
    }
    try {
      const rows = birdashDb.prepare(
        'SELECT status, COUNT(*) as count FROM validations GROUP BY status'
      ).all();
      const stats = { confirmed: 0, doubtful: 0, rejected: 0 };
      for (const r of rows) stats[r.status] = r.count;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (err) {
      console.error('[validation-stats]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Route : GET /api/health
  if (req.method === 'GET' && pathname === '/api/health') {
    try {
      const row = db.prepare("SELECT COUNT(*) as total FROM detections").get();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', total_detections: row.total }));
    } catch (err) {
      console.error('[health]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error' }));
    }
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════
  // ── Route : GET /api/model-comparison ────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/model-comparison') {
    (async () => {
      try {
        const qs = new URLSearchParams(req.url.split('?')[1] || '');
        const days = Math.min(parseInt(qs.get('days') || '7'), 90);
        const minDate = qs.get('dateFrom') || new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

        // Models active in period
        const models = db.prepare(`
          SELECT DISTINCT Model FROM detections WHERE Date >= ?
        `).all(minDate).map(r => r.Model);

        // Per-model stats
        const stats = {};
        for (const m of models) {
          const row = db.prepare(`
            SELECT COUNT(*) as total, COUNT(DISTINCT Sci_Name) as species,
                   round(AVG(Confidence),3) as avg_conf
            FROM detections WHERE Date >= ? AND Model = ?
          `).get(minDate, m);
          stats[m] = row;
        }

        // Species unique to each model
        const unique = {};
        for (const m of models) {
          const others = models.filter(o => o !== m);
          if (others.length === 0) continue;
          const placeholders = others.map(() => '?').join(',');
          const rows = db.prepare(`
            SELECT d.Sci_Name, d.Com_Name, COUNT(*) as n, round(AVG(d.Confidence),3) as avg_conf
            FROM detections d
            WHERE d.Date >= ? AND d.Model = ?
            AND d.Sci_Name NOT IN (
              SELECT DISTINCT Sci_Name FROM detections
              WHERE Date >= ? AND Model IN (${placeholders})
            )
            GROUP BY d.Sci_Name ORDER BY n DESC
          `).all(minDate, m, minDate, ...others);
          unique[m] = rows;
        }

        // Species detected by ALL models (overlap)
        let overlap = [];
        if (models.length >= 2) {
          const m1 = models[0], m2 = models[1];
          overlap = db.prepare(`
            SELECT a.Sci_Name, a.Com_Name,
              a.n as n1, a.avg_conf as conf1,
              b.n as n2, b.avg_conf as conf2
            FROM (
              SELECT Sci_Name, Com_Name, COUNT(*) as n, round(AVG(Confidence),3) as avg_conf
              FROM detections WHERE Date >= ? AND Model = ? GROUP BY Sci_Name
            ) a
            INNER JOIN (
              SELECT Sci_Name, COUNT(*) as n, round(AVG(Confidence),3) as avg_conf
              FROM detections WHERE Date >= ? AND Model = ? GROUP BY Sci_Name
            ) b ON a.Sci_Name = b.Sci_Name
            ORDER BY (a.n + b.n) DESC
            LIMIT 30
          `).all(minDate, m1, minDate, m2);
        }

        // Daily detection counts per model
        const daily = db.prepare(`
          SELECT Date, Model, COUNT(*) as n
          FROM detections WHERE Date >= ?
          GROUP BY Date, Model ORDER BY Date
        `).all(minDate);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models, stats, unique, overlap, daily, since: minDate }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // (readJsonFile/writeJsonFileAtomic defined before createServer)

  // ══════════════════════════════════════════════════════════════════════════
  // ── DETECTION RULES MODULE ──────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  const DETECTION_RULES_PATH = path.join(__dirname, '..', 'config', 'detection_rules.json');

  // ── Route : GET /api/detection-rules ────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/detection-rules') {
    const rules = readJsonFile(DETECTION_RULES_PATH) || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rules));
    return;
  }

  // ── Route : POST /api/detection-rules ───────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/detection-rules') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const rules = JSON.parse(body);
        writeJsonFileAtomic(DETECTION_RULES_PATH, rules);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Route : GET /api/flagged-detections ─────────────────────────────────
  // Returns detections that match flagging rules
  if (req.method === 'GET' && pathname === '/api/flagged-detections') {
    (async () => {
      try {
        const rules = readJsonFile(DETECTION_RULES_PATH) || {};
        if (!rules.auto_flag || !rules.rules) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ flagged: [] }));
          return;
        }

        const qs = new URLSearchParams(req.url.split('?')[1] || '');
        const dateFrom = qs.get('dateFrom') || qs.get('date') || new Date().toISOString().split('T')[0];
        const dateTo = qs.get('dateTo') || dateFrom;
        const limit = Math.min(parseInt(qs.get('limit') || '500'), 2000);

        // Get all detections for the date range
        const rows = db.prepare(`
          SELECT Date, Time, Sci_Name, Com_Name, Confidence, File_Name, Model
          FROM detections WHERE Date >= ? AND Date <= ? ORDER BY Date DESC, Time DESC LIMIT ?
        `).all(dateFrom, dateTo, limit);

        // Count per species per day (for isolated detection rule)
        const speciesCounts = {};
        for (const r of rows) {
          const dayKey = `${r.Date}|${r.Sci_Name}`;
          speciesCounts[dayKey] = (speciesCounts[dayKey] || 0) + 1;
        }

        // Get existing validations for the range
        const validations = {};
        try {
          const vals = birdashDb.prepare(`
            SELECT date, time, sci_name, status FROM validations WHERE date >= ? AND date <= ?
          `).all(dateFrom, dateTo);
          for (const v of vals) validations[`${v.date}|${v.time}|${v.sci_name}`] = v.status;
        } catch {}

        const flagged = [];
        const r = rules.rules;

        for (const det of rows) {
          const key = `${det.Date}|${det.Time}|${det.Sci_Name}`;
          const existing = validations[key];
          if (existing === 'confirmed' || existing === 'rejected') continue;

          const hour = parseInt(det.Time.split(':')[0]);
          const month = parseInt(det.Date.split('-')[1]);
          const daySpeciesKey = `${det.Date}|${det.Sci_Name}`;
          const reasons = [];

          // Rule: nocturnal species during day
          if (r.nocturnal_day?.enabled && r.nocturnal_day.species.includes(det.Sci_Name)) {
            if (hour >= r.nocturnal_day.day_start_hour && hour < r.nocturnal_day.day_end_hour) {
              reasons.push('Espece nocturne detectee de jour');
            }
          }

          // Rule: diurnal species at night
          if (r.diurnal_night?.enabled && r.diurnal_night.species.includes(det.Sci_Name)) {
            if (hour >= r.diurnal_night.night_start_hour || hour < r.diurnal_night.night_end_hour) {
              reasons.push('Espece diurne detectee de nuit');
            }
          }

          // Rule: out of season
          if (r.out_of_season?.enabled) {
            const allowed = r.out_of_season.species_months[det.Sci_Name];
            if (allowed && !allowed.includes(month)) {
              reasons.push('Hors saison migratoire');
            }
          }

          // Rule: isolated low confidence
          if (r.isolated_low_confidence?.enabled) {
            if (det.Confidence < r.isolated_low_confidence.max_confidence &&
                (speciesCounts[daySpeciesKey] || 0) <= r.isolated_low_confidence.max_daily_count) {
              reasons.push('Detection isolee a faible confiance');
            }
          }

          // Rule: non-European species
          if (r.non_european?.enabled && r.non_european.excluded_keywords) {
            if (r.non_european.excluded_keywords.some(kw => det.Com_Name.includes(kw))) {
              reasons.push('Espece non europeenne');
            }
          }

          if (reasons.length > 0) {
            flagged.push({
              date: det.Date, time: det.Time,
              sci_name: det.Sci_Name, com_name: det.Com_Name,
              confidence: det.Confidence, file_name: det.File_Name,
              model: det.Model,
              reasons,
              validation: existing || 'unreviewed',
            });
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ flagged, dateFrom, dateTo, total: rows.length }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : POST /api/bulk-validate ─────────────────────────────────────
  // Bulk confirm or reject detections
  if (req.method === 'POST' && pathname === '/api/bulk-validate') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { detections, status } = JSON.parse(body);
        if (!detections || !Array.isArray(detections) || !['confirmed', 'rejected', 'doubtful'].includes(status)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'detections array and status required' }));
          return;
        }
        const stmt = birdashDb.prepare(`
          INSERT OR REPLACE INTO validations (date, time, sci_name, status, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `);
        const tx = birdashDb.transaction(() => {
          for (const d of detections) {
            stmt.run(d.date, d.time, d.sci_name, status);
          }
        });
        tx();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: detections.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── AUDIO CONFIG MODULE ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  const AUDIO_CONFIG_PATH = path.join(__dirname, '..', 'config', 'audio_config.json');
  const AUDIO_PROFILES_PATH = path.join(__dirname, '..', 'config', 'audio_profiles.json');
  const AG_CONFIG_PATH = path.join(__dirname, '..', 'config', 'adaptive_gain.json');

  // (Adaptive gain: state, agPushSample, agUpdate defined at module level)

  // ── Route : GET /api/audio/devices ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/devices') {
    (async () => {
      try {
        const { stdout } = await new Promise((resolve, reject) => {
          require('child_process').exec('arecord -l 2>/dev/null', (err, stdout, stderr) => {
            resolve({ stdout: stdout || '', stderr });
          });
        });
        const devices = [];
        const lines = stdout.split('\n');
        for (const line of lines) {
          const m = line.match(/^card (\d+): (\w+) \[(.+?)\], device (\d+): (.+)/);
          if (m) {
            const id = `hw:${m[1]},${m[3 + 1]}`;
            const name = m[3];
            const isUsb = /usb|rode|ai.?micro|scarlett|behringer|zoom|tascam|presonus/i.test(name);
            // Get details via arecord --dump-hw-params
            let channels = 2, rates = [];
            try {
              const { stdout: info } = await new Promise((resolve, reject) => {
                require('child_process').exec(
                  `arecord -D ${id} --dump-hw-params -d 0 2>&1 || true`,
                  { timeout: 3000 },
                  (err, stdout) => resolve({ stdout: stdout || '' })
                );
              });
              const chMatch = info.match(/CHANNELS\s*:.*?(\d+)/s);
              if (chMatch) channels = parseInt(chMatch[1]);
              const rateMatch = info.match(/RATE\s*:\s*(\d+)/);
              if (rateMatch) rates.push(parseInt(rateMatch[1]));
            } catch {}
            const cardName = m[2]; // ALSA card name (e.g. AIMicro)
            const dsnoop_id = `dsnoop:CARD=${cardName},DEV=${m[4]}`;
            devices.push({
              id: dsnoop_id, // Use dsnoop for shared access
              hw_id: id,     // Direct hw access (exclusive)
              name,
              alsa_card: parseInt(m[1]),
              alsa_device: parseInt(m[4]),
              channels,
              sample_rates: rates.length ? rates : [48000],
              usb_audio: isUsb,
            });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ devices }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/audio/adaptive-gain/state ───────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/adaptive-gain/state') {
    const cfg = readJsonFile(AG_CONFIG_PATH) || AG_DEFAULTS;
    agUpdate(cfg);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, state: { ..._agState, history_count: _agState.history.length }, config: { ...AG_DEFAULTS, ...cfg } }));
    return;
  }

  // ── Route : GET /api/audio/adaptive-gain/config ─────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/adaptive-gain/config') {
    const cfg = readJsonFile(AG_CONFIG_PATH) || AG_DEFAULTS;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...AG_DEFAULTS, ...cfg }));
    return;
  }

  // ── Route : POST /api/audio/adaptive-gain/config ────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/adaptive-gain/config') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        const AG_KEYS = ['enabled','mode','observer_only','min_db','max_db','step_up_db','step_down_db',
          'update_interval_s','history_s','noise_percentile','target_floor_dbfs','clip_guard_dbfs','activity_hold_s'];
        const filtered = {};
        for (const k of Object.keys(updates)) { if (AG_KEYS.includes(k)) filtered[k] = updates[k]; }
        const current = readJsonFile(AG_CONFIG_PATH) || {};
        Object.assign(current, filtered);
        writeJsonFileAtomic(AG_CONFIG_PATH, current);
        // Start/stop collector based on enabled state
        if (current.enabled) startAgCollector();
        else stopAgCollector();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, config: { ...AG_DEFAULTS, ...current } }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Route : GET /api/audio/config ───────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/config') {
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(config));
    return;
  }

  // ── Route : POST /api/audio/config ──────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/config') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const updates = JSON.parse(body);
        // Whitelist allowed audio config keys
        const AUDIO_KEYS = ['device_id','device_name','input_channels','capture_sample_rate','bit_depth',
          'output_sample_rate','channel_strategy','hop_size_s','highpass_enabled','highpass_cutoff_hz',
          'lowpass_enabled','lowpass_cutoff_hz','denoise_enabled','denoise_strength',
          'rms_normalize','rms_target','cal_gain_ch0','cal_gain_ch1','cal_date','profile_name'];
        const filtered = {};
        for (const k of Object.keys(updates)) {
          if (AUDIO_KEYS.includes(k)) filtered[k] = updates[k];
        }
        if (Object.keys(filtered).length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No valid audio config keys provided' }));
          return;
        }
        const current = readJsonFile(AUDIO_CONFIG_PATH) || {};
        const oldDevice = current.device_id;
        Object.assign(current, filtered);
        writeJsonFileAtomic(AUDIO_CONFIG_PATH, current);

        // When device changes, generate ALSA dsnoop config for shared access
        if (filtered.device_id && filtered.device_id !== oldDevice) {
          try {
            const devId = filtered.device_id;
            // Extract ALSA card name from hw_id or dsnoop id
            let cardName = '';
            const hwMatch = devId.match(/CARD=(\w+)/);
            if (hwMatch) cardName = hwMatch[1];
            else {
              // Try to find card name from device list
              const { execSync } = require('child_process');
              const arecordOut = execSync('arecord -l 2>/dev/null', { encoding: 'utf8' });
              const cardMatch = arecordOut.match(/card \d+: (\w+) \[/);
              if (cardMatch) cardName = cardMatch[1];
            }
            if (cardName) {
              const channels = current.input_channels || 2;
              const rate = current.capture_sample_rate || 48000;
              const asoundrc = `# Auto-generated by Birdash for ${current.device_name || cardName}\n` +
                `pcm.birdash {\n    type dsnoop\n    ipc_key 2048\n    slave {\n` +
                `        pcm "hw:CARD=${cardName},DEV=0"\n        channels ${channels}\n` +
                `        rate ${rate}\n    }\n}\n`;
              fs.writeFileSync(path.join(process.env.HOME, '.asoundrc'), asoundrc);
              // Update device_id to use the dsnoop alias
              current.device_id = 'birdash';
              writeJsonFileAtomic(AUDIO_CONFIG_PATH, current);
              console.log(`[audio] ALSA dsnoop config generated for ${cardName}`);
              // Restart recording service to pick up new device
              try { require('child_process').exec('sudo systemctl restart birdengine-recording'); } catch {}
            }
          } catch (e) {
            console.warn('[audio] ALSA config generation failed:', e.message);
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, config: current }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Route : GET /api/audio/profiles ─────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/profiles') {
    const profiles = readJsonFile(AUDIO_PROFILES_PATH) || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ profiles }));
    return;
  }

  // ── Route : POST /api/audio/profiles ────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/profiles') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const raw = JSON.parse(body);
        if (!raw.profile_name) throw new Error('profile_name required');
        // Validate and whitelist profile fields
        const PROFILE_KEYS = ['profile_name','highpass_enabled','highpass_cutoff_hz',
          'lowpass_enabled','lowpass_cutoff_hz','denoise_enabled','denoise_strength',
          'hop_size_s','channel_strategy','rms_normalize','rms_target'];
        const profile = { profile_name: raw.profile_name };
        for (const k of PROFILE_KEYS) { if (k in raw) profile[k] = raw[k]; }
        const profiles = readJsonFile(AUDIO_PROFILES_PATH) || {};
        if (profiles[profile.profile_name]?.builtin) throw new Error('Cannot overwrite builtin profile');
        profiles[profile.profile_name] = { ...profile, builtin: false };
        writeJsonFileAtomic(AUDIO_PROFILES_PATH, profiles);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Route : POST /api/audio/profiles/activate ───────────────────────────
  if (req.method === 'POST' && pathname.match(/^\/api\/audio\/profiles\/(.+)\/activate$/)) {
    if (!requireAuth(req, res)) return;
    const name = decodeURIComponent(pathname.match(/^\/api\/audio\/profiles\/(.+)\/activate$/)[1]);
    const profiles = readJsonFile(AUDIO_PROFILES_PATH) || {};
    if (!profiles[name]) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Profile '${name}' not found` }));
      return;
    }
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    const p = profiles[name];
    Object.assign(config, {
      profile_name: name,
      channel_strategy: p.channel_strategy,
      hop_size_s: p.hop_size_s,
      highpass_enabled: p.highpass_enabled,
      highpass_cutoff_hz: p.highpass_cutoff_hz,
      rms_normalize: p.rms_normalize,
      rms_target: p.rms_target,
    });
    writeJsonFileAtomic(AUDIO_CONFIG_PATH, config);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, config }));
    return;
  }

  // ── Route : DELETE /api/audio/profiles/:name ────────────────────────────
  if (req.method === 'DELETE' && pathname.startsWith('/api/audio/profiles/')) {
    if (!requireAuth(req, res)) return;
    const name = decodeURIComponent(pathname.replace('/api/audio/profiles/', ''));
    const profiles = readJsonFile(AUDIO_PROFILES_PATH) || {};
    if (profiles[name]?.builtin) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cannot delete builtin profile' }));
      return;
    }
    delete profiles[name];
    writeJsonFileAtomic(AUDIO_PROFILES_PATH, profiles);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── Route : POST /api/audio/calibration/start ───────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/calibration/start') {
    if (!requireAuth(req, res)) return;
    (async () => {
      try {
        const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
        const device = config.device_id || 'default';
        const duration = 10;
        // Record 10s stereo WAV for calibration
        const tmpFile = '/tmp/birdash_calibration.wav';
        await new Promise((resolve, reject) => {
          const proc = require('child_process').spawn('arecord', [
            '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', '2',
            '-d', String(duration), tmpFile
          ]);
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`arecord exit ${code}`)));
          proc.on('error', reject);
          setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, (duration + 5) * 1000);
        });
        // Analyze RMS per channel using ffmpeg
        const analyzeChannel = async (ch) => {
          return new Promise((resolve) => {
            const ff = require('child_process').spawn('ffmpeg', [
              '-i', tmpFile, '-af', `pan=mono|c0=c${ch},astats=metadata=1:reset=0`, '-f', 'null', '-'
            ], { stdio: ['pipe', 'pipe', 'pipe'] });
            let output = '';
            ff.stderr.on('data', d => output += d);
            ff.on('close', () => {
              const m = output.match(/RMS level dB:\s*([-\d.]+)/);
              resolve(m ? parseFloat(m[1]) : -60);
            });
          });
        };
        const rms0 = await analyzeChannel(0);
        const rms1 = await analyzeChannel(1);
        const diffDb = Math.abs(rms0 - rms1);
        // Calculate gain compensation (reference = louder channel)
        let gain0 = 1.0, gain1 = 1.0;
        if (rms0 < rms1) {
          gain0 = Math.pow(10, (rms1 - rms0) / 20);
        } else {
          gain1 = Math.pow(10, (rms0 - rms1) / 20);
        }
        const result = {
          rms_ch0_db: Math.round(rms0 * 10) / 10,
          rms_ch1_db: Math.round(rms1 * 10) / 10,
          diff_db: Math.round(diffDb * 10) / 10,
          gain_ch0: Math.round(gain0 * 1000) / 1000,
          gain_ch1: Math.round(gain1 * 1000) / 1000,
          status: diffDb < 1 ? 'excellent' : diffDb < 3 ? 'normal' : 'warning',
          message: diffDb < 1
            ? 'Excellente correspondance. Calibration non nécessaire.'
            : diffDb < 3
            ? 'Écart normal entre capsules. Calibration appliquée.'
            : 'Écart important détecté. Vérifiez le câblage et le placement.',
        };
        // Clean up
        try { fs.unlinkSync(tmpFile); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : POST /api/audio/calibration/apply ───────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/calibration/apply') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { gain_ch0, gain_ch1 } = JSON.parse(body);
        const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
        config.cal_gain_ch0 = gain_ch0;
        config.cal_gain_ch1 = gain_ch1;
        config.cal_date = new Date().toISOString();
        writeJsonFileAtomic(AUDIO_CONFIG_PATH, config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, config }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Route : GET /api/audio/monitor ──────────────────────────────────────
  // SSE stream for real-time audio levels using arecord + raw PCM analysis
  if (req.method === 'GET' && pathname === '/api/audio/monitor') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    const device = config.device_id || 'default';
    const channels = config.input_channels || 2;
    const sampleRate = 48000;
    // Stream raw PCM from arecord and compute RMS in Node.js
    const proc = require('child_process').spawn('arecord', [
      '-D', device, '-f', 'S16_LE', '-r', String(sampleRate),
      '-c', String(channels), '-t', 'raw',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const bytesPerSample = 2; // S16_LE
    const chunkDuration = 0.5; // 500ms
    const chunkBytes = sampleRate * channels * bytesPerSample * chunkDuration;
    let buffer = Buffer.alloc(0);

    proc.stdout.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= chunkBytes) {
        const chunk = buffer.subarray(0, chunkBytes);
        buffer = buffer.subarray(chunkBytes);
        // Compute RMS per channel
        const samplesPerChannel = (chunkBytes / bytesPerSample) / channels;
        const rms = [0, 0];
        let peak = [0, 0];
        for (let i = 0; i < chunkBytes; i += bytesPerSample * channels) {
          for (let ch = 0; ch < channels; ch++) {
            const offset = i + ch * bytesPerSample;
            if (offset + 1 < chunk.length) {
              const sample = chunk.readInt16LE(offset) / 32768.0;
              rms[ch] += sample * sample;
              const abs = Math.abs(sample);
              if (abs > peak[ch]) peak[ch] = abs;
            }
          }
        }
        const rms0db = rms[0] > 0 ? Math.round(10 * Math.log10(rms[0] / samplesPerChannel) * 10) / 10 : -60;
        const peak0db = peak[0] > 0 ? Math.round(20 * Math.log10(peak[0]) * 10) / 10 : -60;
        // Feed adaptive gain system
        agPushSample(rms0db, peak0db);
        const event = {
          ch0_rms_db: rms0db,
          ch1_rms_db: channels > 1 && rms[1] > 0 ? Math.round(10 * Math.log10(rms[1] / samplesPerChannel) * 10) / 10 : -60,
          clipping_ch0: peak[0] > 0.99,
          clipping_ch1: peak[1] > 0.99,
          timestamp: Date.now(),
        };
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });
    proc.stderr.on('data', () => {}); // ignore arecord stderr
    proc.on('close', () => { try { res.end(); } catch {} });
    req.on('close', () => { proc.kill(); });
    return;
  }

  // ── Route : GET /api/audio/live-stream ───────────────────────────────────
  // Continuous MP3 stream from mic for live spectrogram
  if (req.method === 'GET' && pathname === '/api/live-stream') {
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    const device = config.device_id || 'default';

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked',
    });
    // CORS already set globally via getCorsOrigin()

    // arecord → ffmpeg (mp3 encode) → HTTP response
    const proc = require('child_process').spawn('ffmpeg', [
      '-f', 'alsa', '-ac', '2', '-ar', '48000', '-i', device,
      '-acodec', 'libmp3lame', '-b:a', '128k', '-ac', '1', '-ar', '48000', '-af', 'volume=3',
      '-f', 'mp3', '-fflags', '+nobuffer', '-flush_packets', '1',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stdout.on('data', (chunk) => {
      try { res.write(chunk); } catch {}
    });
    proc.stderr.on('data', () => {}); // ignore ffmpeg logs
    proc.on('close', () => { try { res.end(); } catch {} });
    req.on('close', () => { proc.kill(); });
    return;
  }

  // ── Route : GET /api/live-pcm ────────────────────────────────────────────
  // Raw PCM stream (16-bit LE, mono, 24kHz) for live spectrogram
  if (req.method === 'GET' && pathname === '/api/live-pcm') {
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    const device = config.device_id || 'default';

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked',
    });

    // ffmpeg: capture from ALSA → mono 48kHz → raw PCM out
    const proc = require('child_process').spawn('ffmpeg', [
      '-f', 'alsa', '-ac', '2', '-ar', '48000', '-i', device,
      '-ac', '1', '-ar', '48000', '-af', 'volume=3', '-f', 's16le',
      '-fflags', '+nobuffer', '-flush_packets', '1',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stdout.on('data', (chunk) => {
      try { res.write(chunk); } catch {}
    });
    proc.stderr.on('data', () => {});
    proc.on('close', () => { try { res.end(); } catch {} });
    req.on('close', () => { proc.kill(); });
    return;
  }

  // ── Route : POST /api/audio/filter-preview ───────────────────────────────
  // Record 3s, apply filters via Python, return before/after spectrograms
  if (req.method === 'POST' && pathname === '/api/audio/filter-preview') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const filterConf = JSON.parse(body);
          const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
          const device = config.device_id || 'default';
          const channels = config.input_channels || 2;
          const tmpWav = '/tmp/birdash_filter_preview.wav';

          // Record 3 seconds
          await new Promise((resolve, reject) => {
            const proc = require('child_process').spawn('arecord', [
              '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', String(channels),
              '-d', '3', tmpWav
            ]);
            proc.on('close', code => code === 0 ? resolve() : reject(new Error(`arecord exit ${code}`)));
            proc.on('error', reject);
            setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 8000);
          });

          // Run Python filter preview script
          const pyBin = path.join(process.env.HOME || '/home/bjorn', 'birdengine', 'venv', 'bin', 'python');
          const scriptPath = path.join(__dirname, '..', 'engine', 'filter_preview.py');
          const result = await new Promise((resolve, reject) => {
            const proc = require('child_process').spawn(pyBin, [
              scriptPath, tmpWav, JSON.stringify(filterConf)
            ], { stdio: ['pipe', 'pipe', 'pipe'] });
            let stdout = '', stderr = '';
            proc.stdout.on('data', d => { stdout += d; });
            proc.stderr.on('data', d => { stderr += d; });
            proc.on('close', code => {
              if (code === 0) resolve(stdout);
              else reject(new Error(stderr || `python exit ${code}`));
            });
            proc.on('error', reject);
            setTimeout(() => { proc.kill(); reject(new Error('python timeout')); }, 30000);
          });

          try { fs.unlinkSync(tmpWav); } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(result);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return;
  }

  // ── Route : GET /api/audio/test ─────────────────────────────────────────
  // Capture 5s and return spectrogram as base64 PNG
  if (req.method === 'GET' && pathname === '/api/audio/test') {
    (async () => {
      try {
        const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
        const device = config.device_id || 'default';
        const tmpWav = '/tmp/birdash_audio_test.wav';
        const tmpPng = '/tmp/birdash_audio_test.png';
        // Record 5s
        await new Promise((resolve, reject) => {
          const proc = require('child_process').spawn('arecord', [
            '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', '2',
            '-d', '5', tmpWav
          ]);
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`arecord exit ${code}`)));
          proc.on('error', reject);
          setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 10000);
        });
        // Generate spectrogram
        await new Promise((resolve, reject) => {
          const ff = require('child_process').spawn('ffmpeg', [
            '-y', '-i', tmpWav, '-lavfi', 'showspectrumpic=s=800x400:legend=0:color=intensity',
            '-frames:v', '1', tmpPng
          ]);
          ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg ' + code)));
          ff.on('error', reject
          );
        });
        const png = fs.readFileSync(tmpPng);
        try { fs.unlinkSync(tmpWav); fs.unlinkSync(tmpPng); } catch {}
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(png);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════

  console.warn(`[BIRDASH] 404 — route inconnue : ${req.method} ${pathname}`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Route inconnue : ${req.method} ${pathname}` }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[BIRDASH] API démarrée sur http://127.0.0.1:${PORT}`);
});

// ── Module-level adaptive gain collector ──────────────────────────────────
const _AG_CFG_PATH = path.join(__dirname, '..', 'config', 'adaptive_gain.json');
const _AG_AUDIO_CFG_PATH = path.join(__dirname, '..', 'config', 'audio_config.json');
let _agBgProc = null, _agBgInterval = null;
function _agBgStart() {
  if (_agBgProc) return;
  try {
    const audioCfg = JSON.parse(fs.readFileSync(_AG_AUDIO_CFG_PATH, 'utf8'));
    const device = audioCfg.device_id || 'default';
    const channels = audioCfg.input_channels || 2;
    _agBgProc = require('child_process').spawn('arecord', [
      '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', String(channels), '-t', 'raw',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunkBytes = 48000 * channels * 2 * 0.5; // 500ms
    let buf = Buffer.alloc(0);
    _agBgProc.stdout.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= chunkBytes) {
        const chunk = buf.subarray(0, chunkBytes);
        buf = buf.subarray(chunkBytes);
        const samplesPerCh = chunkBytes / 2 / channels;
        let rmsSum = 0, pk = 0;
        for (let i = 0; i < chunkBytes; i += 2 * channels) {
          const s = chunk.readInt16LE(i) / 32768.0;
          rmsSum += s * s;
          if (Math.abs(s) > pk) pk = Math.abs(s);
        }
        const rmsDb = rmsSum > 0 ? Math.round(10 * Math.log10(rmsSum / samplesPerCh) * 10) / 10 : -60;
        const peakDb = pk > 0 ? Math.round(20 * Math.log10(pk) * 10) / 10 : -60;
        // Push via the request-scoped function won't work — we need a global reference
        // Use the _agState directly (it's closure-accessible from the createServer scope)
        // Actually _agState is also in request scope. We'll use a global bridge.
        agPushSample(rmsDb, peakDb);
      }
    });
    _agBgProc.stderr.on('data', () => {});
    _agBgProc.on('close', () => { _agBgProc = null; });
    console.log('[adaptive-gain] Background collector started (device: ' + device + ')');
  } catch (e) {
    console.warn('[adaptive-gain] Failed to start collector:', e.message);
  }
}
function _agBgStop() {
  if (_agBgProc) { try { _agBgProc.kill(); } catch{} _agBgProc = null; }
  if (_agBgInterval) { clearInterval(_agBgInterval); _agBgInterval = null; }
}
// Check config and auto-start/stop every 30s
_agBgInterval = setInterval(() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(_AG_CFG_PATH, 'utf8'));
    if (cfg.enabled && !_agBgProc) _agBgStart();
    else if (!cfg.enabled && _agBgProc) _agBgStop();
    if (cfg.enabled) agUpdate(cfg);
  } catch {}
}, 30000);
// Initial check after 5s
setTimeout(() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(_AG_CFG_PATH, 'utf8'));
    if (cfg.enabled) _agBgStart();
  } catch {}
}, 5000);

function gracefulShutdown() {
  if (_alertIntervalId) clearInterval(_alertIntervalId);
  if (_rateBucketCleanup) clearInterval(_rateBucketCleanup);
  if (_activeBackupProc) try { _activeBackupProc.kill(); } catch{}
  try { db.close(); } catch{} try { dbWrite.close(); } catch{}
  try { if (taxonomyDb) taxonomyDb.close(); } catch{} try { if (birdashDb) birdashDb.close(); } catch{}
  process.exit(0);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT',  gracefulShutdown);
