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
  process.env.HOME, 'BirdNET-Pi', 'scripts', 'birds.db'
);
const SONGS_DIR = process.env.BIRDASH_SONGS_DIR || path.join(
  process.env.HOME, 'BirdSongs', 'Extracted', 'By_Date'
);
const PHOTO_CACHE_DIR = path.join(process.env.HOME, 'birdash', 'photo-cache');
const AUDIO_RATE = 48000;

// ── BirdNET-Pi Settings helpers ──────────────────────────────────────────────
const BIRDNET_CONF = '/etc/birdnet/birdnet.conf';
const BIRDNET_DIR = path.join(process.env.HOME, 'BirdNET-Pi');

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
  REC_CARD:        v => typeof v === 'string' && v.length <= 200,
  RTSP_STREAM:     v => typeof v === 'string' && v.length <= 500,
  APPRISE_NOTIFY_EACH_DETECTION: v => v == 0 || v == 1,
  APPRISE_NOTIFY_NEW_SPECIES: v => v == 0 || v == 1,
  APPRISE_NOTIFY_NEW_SPECIES_EACH_DAY: v => v == 0 || v == 1,
  APPRISE_WEEKLY_REPORT: v => v == 0 || v == 1,
  APPRISE_NOTIFICATION_TITLE: v => typeof v === 'string' && v.length <= 200,
  APPRISE_MINIMUM_SECONDS_BETWEEN_NOTIFICATIONS_PER_SPECIES: v => !isNaN(v) && v >= 0,
  IMAGE_PROVIDER:  v => ['WIKIPEDIA','FLICKR'].includes(v),
  RARE_SPECIES_THRESHOLD: v => !isNaN(v) && v >= 1 && v <= 365,
  RAW_SPECTROGRAM: v => v == 0 || v == 1,
  DATA_MODEL_VERSION: v => v == 1 || v == 2,
};

// Allowed services for restart
const ALLOWED_SERVICES = ['birdnet_analysis', 'birdnet_recording', 'birdnet_log', 'birdnet_stats',
  'chart_viewer', 'livestream', 'spectrogram_viewer', 'web_terminal', 'birdash'];

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
const BW_TTL = 5 * 60 * 1000;
let _ebirdCache = null;
let _ebirdCacheTs = 0;
const _speciesNamesCache = {}; // lang → { sci: comName }
let _detectedSpeciesCache = null; // [sci, sci, …]
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

// Vérifie que la DB existe
if (!fs.existsSync(DB_PATH)) {
  console.error(`[BIRDASH] birds.db introuvable : ${DB_PATH}`);
  process.exit(1);
}

// Ouvre en lecture seule (requêtes SELECT)
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

// Connexion en écriture pour les suppressions uniquement
const dbWrite = new Database(DB_PATH, { fileMustExist: true });
dbWrite.pragma('journal_mode = WAL');
dbWrite.pragma('busy_timeout = 5000');

console.log(`[BIRDASH] birds.db ouvert : ${DB_PATH}`);

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
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of _rateBuckets) {
    if (now - b.ts > RATE_WINDOW * 2) _rateBuckets.delete(ip);
  }
}, 5 * 60 * 1000);

function rateLimit(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = _rateBuckets.get(ip);
  if (!bucket || now - bucket.ts > RATE_WINDOW) {
    bucket = { count: 0, ts: now };
    _rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > RATE_MAX;
}

// --- Handler HTTP
const server = http.createServer((req, res) => {
  // Headers de sécurité
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // CORS — restrictif par défaut
  const allowedOrigin = getCorsOrigin(req);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
    if (!_speciesNamesCache[lang]) {
      const labelFile = path.join(
        process.env.HOME, 'BirdNET-Pi', 'model', 'l18n', `labels_${lang}.json`
      );
      try {
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
    const detected = _detectedSpeciesCache || (function() {
      const rows = db.prepare('SELECT DISTINCT Sci_Name FROM detections').all();
      _detectedSpeciesCache = rows.map(r => r.Sci_Name);
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
    const sciName = new URL(req.url, 'http://localhost').searchParams.get('sci');
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

        // 3. French Wikipedia — description FR + extract habitat/diet info
        const wikiFr = await fetchJson(
          `https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`
        );
        if (wikiFr?.extract) {
          result.summaryFr = wikiFr.extract;
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
    if (_bwCache && _bwCache[cacheKey] && (Date.now() - _bwCacheTs) < BW_TTL) {
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
        _bwCache[cacheKey] = data;
        _bwCacheTs = Date.now();
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
            let out = '';
            ff.stdout.on('data', d => out += d);
            ff.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error('ffprobe ' + code)));
            ff.on('error', reject);
            setTimeout(() => { try { ff.kill(); } catch(e) {} reject(new Error('timeout')); }, 5000);
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
          req.on('close', () => {
            try { ff.kill(); } catch(e) {}
            resolve();
          });
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
        const streamDir = path.join(process.env.HOME, 'BirdSongs', 'StreamData');
        let backlog = 0, lagSecs = 0, newestFile = '';
        try {
          const files = (await fsp.readdir(streamDir)).filter(f => f.endsWith('.wav')).sort();
          backlog = files.length;
          if (files.length > 0) {
            newestFile = files[files.length - 1];
            const stat = await fsp.stat(path.join(streamDir, newestFile));
            lagSecs = Math.floor((Date.now() - stat.mtimeMs) / 1000);
          }
        } catch(e) {}

        // Get last analysis log line for inference speed
        let inferenceTime = null;
        try {
          const logOut = await execCmd('journalctl', ['-u', 'birdnet_analysis', '-n', '50', '--no-pager']);
          const timeMatch = logOut.match(/DONE! Time ([\d.]+) SECONDS/g);
          if (timeMatch && timeMatch.length > 0) {
            const last = timeMatch[timeMatch.length - 1];
            inferenceTime = parseFloat(last.match(/([\d.]+)/)[1]);
          }
        } catch(e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          model: conf.MODEL || 'unknown',
          sfThresh: parseFloat(conf.SF_THRESH || '0.03'),
          sensitivity: parseFloat(conf.SENSITIVITY || '1.0'),
          confidence: parseFloat(conf.CONFIDENCE || '0.7'),
          backlog,
          lagSecs,
          inferenceTime,
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
        const modelDir = path.join(BIRDNET_DIR, 'model');
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
        const labelDir = path.join(BIRDNET_DIR, 'model', 'l18n');
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

  console.warn(`[BIRDASH] 404 — route inconnue : ${req.method} ${pathname}`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Route inconnue : ${req.method} ${pathname}` }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[BIRDASH] API démarrée sur http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT',  () => { db.close(); process.exit(0); });
