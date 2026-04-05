'use strict';
/**
 * Photo routes — photo resolution/caching, species-names, species-info
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const https = require('https');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const PHOTO_CACHE_DIR = path.join(process.env.HOME, 'birdash', 'photo-cache');

// Create photo cache dir if missing
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

// Cache a photo from external URL to disk, returns local path or null
async function cacheExternalPhoto(sciName, externalUrl, index) {
  if (!externalUrl) return null;
  const key = photoCacheKey(sciName);
  const suffix = index > 0 ? `_${index}` : '';
  const jpgPath = path.join(PHOTO_CACHE_DIR, `${key}${suffix}.jpg`);
  // Already cached?
  try { await fsp.access(jpgPath); return `/birds/api/photo-idx?sci=${encodeURIComponent(sciName)}&idx=${index}`; } catch {}
  // Download and cache
  try {
    const buf = await fetchBuffer(externalUrl);
    if (buf && buf.length >= 512) {
      await fsp.writeFile(jpgPath, buf);
      const metaPath = path.join(PHOTO_CACHE_DIR, `${key}${suffix}.json`);
      await fsp.writeFile(metaPath, JSON.stringify({ src: externalUrl.includes('inaturalist') ? 'iNaturalist' : 'Wikipedia', original: externalUrl }));
      return `/birds/api/photo-idx?sci=${encodeURIComponent(sciName)}&idx=${index}`;
    }
  } catch(e) { console.error(`[photo-cache] Failed to cache ${sciName}#${index}:`, e.message); }
  return null;
}


const _speciesNamesCache = {}; // lang → { sci: comName }
let _detectedSpeciesCache = null;
let _detectedSpeciesCacheTs = 0;

function handle(req, res, pathname, ctx) {
  const { requireAuth, db, taxonomyDb, JSON_CT, BIRDNET_DIR, parseBirdnetConf, readJsonFile } = ctx;

  // ── Route : GET /api/photo?sci=Pica+pica ────────────────────────────────────
  // Cache disque → iNaturalist → Wikipedia
  if (req.method === 'GET' && pathname === '/api/photo') {
    const sciName = new URL(req.url, 'http://localhost').searchParams.get('sci');

    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end('sci param required'); return true;
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
          res.writeHead(404); res.end('no photo found'); return true;
        }

        const imgBuf = await fetchBuffer(resolved.url);
        if (!imgBuf || imgBuf.length < 512) {
          res.writeHead(502); res.end('image fetch failed'); return true;
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
    return true;
  }

  // ── Route : GET /api/photo-idx?sci=Pica+pica&idx=0 ──────────────────────────
  // Serves cached indexed photos (multiple photos per species)
  if (req.method === 'GET' && pathname === '/api/photo-idx') {
    const idxParams = new URL(req.url, 'http://localhost').searchParams;
    const sciName = idxParams.get('sci');
    const idx = parseInt(idxParams.get('idx') || '0', 10);
    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end('sci param required'); return true;
    }
    (async () => {
      const key = photoCacheKey(sciName);
      const suffix = idx > 0 ? `_${idx}` : '';
      const jpgPath = path.join(PHOTO_CACHE_DIR, `${key}${suffix}.jpg`);
      try {
        await fsp.access(jpgPath);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=2592000',
        });
        fs.createReadStream(jpgPath).pipe(res);
      } catch {
        const fallback = path.join(PHOTO_CACHE_DIR, `${key}.jpg`);
        try {
          await fsp.access(fallback);
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000' });
          fs.createReadStream(fallback).pipe(res);
        } catch {
          res.writeHead(404); res.end('photo not found');
        }
      }
    })();
    return true;
  }

  // ── Route : DELETE /api/photo?sci=Pica+pica ─────────────────────────────────
  // Delete cached photo so next GET re-fetches from iNaturalist/Wikipedia
  if (req.method === 'DELETE' && pathname === '/api/photo') {
    if (!requireAuth(req, res)) return true;
    const sciName = new URL(req.url, 'http://localhost').searchParams.get('sci');
    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'sci param required' })); return true;
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
    return true;
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
    return true;
  }

  // ── Route : GET /api/species-names?lang=de ──────────────────────────────
  // Returns { "Sci_Name": "Translated Com_Name" } from BirdNET label files
  if (req.method === 'GET' && pathname === '/api/species-names') {
    const lang = new URL(req.url, 'http://localhost').searchParams.get('lang') || 'fr';
    if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(lang)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'invalid lang' })); return true;
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
    return true;
  }

  // ── Route : GET /api/species-info?sci=Pica+pica ───────────────────────────
  // Returns multiple photos + Wikipedia summary for species detail page
  if (req.method === 'GET' && pathname === '/api/species-info') {
    const spParams = new URL(req.url, 'http://localhost').searchParams;
    const sciName = spParams.get('sci');
    let infoLang = spParams.get('lang') || 'fr';
    if (!/^[a-z]{2}$/.test(infoLang)) infoLang = 'en'; // SSRF guard
    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'sci param required' })); return true;
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

        // Cache all photos locally and replace external URLs with local ones
        const cachedPhotos = await Promise.all(
          result.photos.map(async (p, i) => {
            const localUrl = await cacheExternalPhoto(sciName, p.url, i);
            return { url: localUrl || p.url, attr: p.attr, src: p.src };
          })
        );
        result.photos = cachedPhotos;

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
    return true;
  }


  return false;
}

module.exports = { handle, photoCacheKey, PHOTO_CACHE_DIR };
