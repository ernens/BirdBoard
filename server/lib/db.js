'use strict';
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const https = require('https');

let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('[BIRDASH] better-sqlite3 non trouvé. Exécute : npm install better-sqlite3');
  process.exit(1);
}

// Charger la config locale (birdash-local.js) si disponible
let _localConfig = {};
try {
  const localPath = path.join(__dirname, '..', 'public', 'js', 'birdash-local.js');
  if (fs.existsSync(localPath)) {
    _localConfig = require(localPath);
    console.log('[BIRDASH] Config locale chargée : birdash-local.js');
  }
} catch(e) {
  console.warn('[BIRDASH] birdash-local.js non chargé :', e.message);
}

const EBIRD_API_KEY  = process.env.EBIRD_API_KEY  || _localConfig.ebirdApiKey        || '';
const EBIRD_REGION   = (_localConfig.location && _localConfig.location.region) || 'BE';
const BW_STATION_ID  = process.env.BW_STATION_ID  || _localConfig.birdweatherStationId || '';

const DB_PATH = process.env.BIRDASH_DB || path.join(
  process.env.HOME, 'birdash', 'data', 'birds.db'
);
const SONGS_DIR = process.env.BIRDASH_SONGS_DIR || path.join(
  process.env.HOME, 'BirdSongs', 'Extracted', 'By_Date'
);

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

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');

const dbWrite = new Database(DB_PATH, { fileMustExist: true });
dbWrite.pragma('journal_mode = WAL');
dbWrite.pragma('busy_timeout = 5000');

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

// ── Pre-aggregated statistics tables ──────────────────────────────────────────
const aggregates = require('./aggregates');
aggregates.createTables(dbWrite);

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
const TAXONOMY_DB_PATH = path.join(process.env.HOME, 'birdash', 'config', 'taxonomy.db');
const TAXONOMY_CSV_URL = 'https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=csv&cat=species';
const TAXONOMY_CACHE_PATH = path.join(process.env.HOME, 'birdash', 'config', 'ebird-taxonomy.csv');
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
  taxonomyDb.exec('CREATE INDEX IF NOT EXISTS idx_tax_order ON species_taxonomy(order_name)');
  taxonomyDb.exec('CREATE INDEX IF NOT EXISTS idx_tax_family ON species_taxonomy(family_sci)');
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
  try {
    const stat = await fsp.stat(TAXONOMY_CACHE_PATH);
    const age = Date.now() - stat.mtimeMs;
    if (age < 30 * 24 * 3600 * 1000) {
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

  const lines = csvData.split('\n');
  const header = lines[0];
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

module.exports = {
  db, dbWrite, birdashDb, taxonomyDb, DB_PATH, SONGS_DIR,
  EBIRD_API_KEY, EBIRD_REGION, BW_STATION_ID,
  aggregates,
  refreshTaxonomy, closeAll() {
    aggregates.stopPeriodicRefresh();
    try { db.close(); } catch{} try { dbWrite.close(); } catch{}
    try { if (taxonomyDb) taxonomyDb.close(); } catch{} try { if (birdashDb) birdashDb.close(); } catch{}
  },
};
