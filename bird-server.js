#!/usr/bin/env node
/**
 * PIBIRD — Backend API
 * Expose birds.db (SQLite) via HTTP POST /api/query
 * Port 7474 — proxifié par Caddy sous /birds/api/
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');

// --- Dépendance : better-sqlite3 (npm install better-sqlite3)
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('[PIBIRD] better-sqlite3 non trouvé. Exécute : npm install better-sqlite3');
  process.exit(1);
}

// --- Configuration
const PORT    = process.env.PIBIRD_PORT || 7474;
const DB_PATH = process.env.PIBIRD_DB   || path.join(
  process.env.HOME, 'BirdNET-Pi', 'scripts', 'birds.db'
);
// Répertoire racine des MP3 BirdNET
const SONGS_DIR = process.env.PIBIRD_SONGS_DIR || path.join(
  process.env.HOME, 'BirdSongs', 'Extracted', 'By_Date'
);
const AUDIO_RATE = 48000;

// ── Scan des MP3 récents ────────────────────────────────────────────────────
// Retourne la liste des MP3 des dernières 48h, triés par mtime croissant
function getRecentMp3s() {
  const files  = [];
  const cutoff = Date.now() - 48 * 3600 * 1000;

  for (let daysAgo = 0; daysAgo <= 1; daysAgo++) {
    const d = new Date(Date.now() - daysAgo * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    const dayDir  = path.join(SONGS_DIR, dateStr);
    if (!fs.existsSync(dayDir)) continue;

    let species;
    try { species = fs.readdirSync(dayDir); } catch(e) { continue; }

    for (const sp of species) {
      const spDir = path.join(dayDir, sp);
      let entries;
      try { entries = fs.readdirSync(spDir); } catch(e) { continue; }
      for (const f of entries) {
        if (!f.endsWith('.mp3')) continue;
        const fp = path.join(spDir, f);
        try {
          const { mtimeMs } = fs.statSync(fp);
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
  console.error(`[PIBIRD] birds.db introuvable : ${DB_PATH}`);
  process.exit(1);
}

// Ouvre en lecture seule
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

console.log(`[PIBIRD] birds.db ouvert : ${DB_PATH}`);

// --- Validation de sécurité
const ALLOWED_START = /^\s*(SELECT|PRAGMA|WITH)\s/i;
const FORBIDDEN     = /;\s*(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|ATTACH)/i;

function validateQuery(sql) {
  if (!sql || typeof sql !== 'string') return false;
  if (!ALLOWED_START.test(sql))        return false;
  if (FORBIDDEN.test(sql))             return false;
  if (sql.length > 8000)               return false;
  return true;
}

// --- Handler HTTP
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Extraire le pathname proprement (ignore query string éventuel)
  const pathname = req.url.split('?')[0].replace(/\/$/, '') || '/';
  console.log(`[PIBIRD] ${req.method} ${req.url} → pathname: ${pathname}`);

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
      const allFiles = getRecentMp3s();
      for (const f of allFiles) {
        if (f.mtime < startCutoff) streamed.add(f.path);
      }
      console.log(`[audio-stream] démarrage — ${streamed.size} fichiers anciens ignorés`);

      while (!aborted) {
        const pending = getRecentMp3s().filter(f => !streamed.has(f.path));

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
        console.error('[PIBIRD] Erreur SQL :', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
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
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: err.message }));
    }
    return;
  }

  console.warn(`[PIBIRD] 404 — route inconnue : ${req.method} ${pathname}`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Route inconnue : ${req.method} ${pathname}` }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[PIBIRD] API démarrée sur http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT',  () => { db.close(); process.exit(0); });
