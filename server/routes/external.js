'use strict';
/**
 * External API routes — BirdWeather, eBird notable, weather
 */
const https = require('https');

let _bwCache = null, _bwCacheTs = 0;
const BW_TTL = 5 * 60 * 1000;
let _ebirdCache = null, _ebirdCacheTs = 0;
const EBIRD_TTL = 3600 * 1000;
let _weatherCache = null, _weatherCacheTs = 0;
const WEATHER_TTL = 3600 * 1000;

// Fetch JSON from HTTPS URL
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

function handle(req, res, pathname, ctx) {
  const { parseBirdnetConf, readJsonFile, EBIRD_API_KEY, EBIRD_REGION, BW_STATION_ID } = ctx;

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
    return true;
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
    return true;
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

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&past_days=${days}&forecast_days=2&timezone=auto`;

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
    return true;
  }


  return false;
}

module.exports = { handle };
