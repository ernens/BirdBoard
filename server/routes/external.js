'use strict';
/**
 * External API routes — BirdWeather, eBird notable, weather
 */
const https = require('https');
const resultCache = require('../lib/result-cache');

// Cache TTL for weather analytics endpoints (minutes).
// Weather itself updates hourly and the underlying detections only
// append, so a 5-min cache is safe and takes the weather page from
// "25 s under load" to "instant after the first visitor warms it".
const WEATHER_ANALYTICS_TTL = 5 * 60 * 1000;

// Wrapper: try cache by normalized URL key, fall through to compute.
// Returns true if it served a cached response (caller should return).
function serveFromCache(req, res, ctx, label) {
  const key = label + '|' + (req.url.split('?')[1] || '');
  const hit = resultCache.get(key);
  if (hit) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
    res.end(hit);
    return true;
  }
  // Patch res.end to capture the computed response body for caching
  const origEnd = res.end.bind(res);
  res.end = function (body) {
    if (typeof body === 'string' && res.statusCode === 200) {
      resultCache.set(key, body, WEATHER_ANALYTICS_TTL);
    }
    return origEnd(body);
  };
  return false;
}

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
  const { parseBirdnetConf, readJsonFile, birdashDb, db, EBIRD_API_KEY, EBIRD_REGION, BW_STATION_ID } = ctx;

  // ── Route : GET /api/birdweather/status ─────────────────────────────────────
  // Lightweight status check — used by the header to decide whether to show
  // the "Open on BirdWeather" button. Reads live from birdnet.conf so the
  // header reflects a station-ID change without restarting birdash.
  // (parseBirdnetConf is async — the original landed without await and
  // always returned an empty stationId.)
  if (req.method === 'GET' && pathname === '/api/birdweather/status') {
    parseBirdnetConf().then((conf) => {
      const stationId = String(conf.BIRDWEATHER_ID || '').trim();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stationId, enabled: stationId.length > 0 }));
    }).catch(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ stationId: '', enabled: false }));
    });
    return true;
  }

  // ── Route : GET /api/birdweather ─────────────────────────────────────────────
  // Proxy BirdWeather API — évite les CORS + cache 5 min
  // ?endpoint=stats|species|detections  ?period=day|week|month|all
  if (req.method === 'GET' && pathname === '/api/birdweather') {
    if (!BW_STATION_ID) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no_station', message: 'birdweatherStationId not configured in birdash-local.js' }));
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
      res.end(JSON.stringify({ error: 'no_key', message: 'EBIRD_API_KEY not configured. Get a free key at https://ebird.org/api/keygen' }));
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

  // ── Route : GET /api/weather/range?from=YYYY-MM-DD&to=YYYY-MM-DD ─────────
  // Returns all hourly snapshots in the date range (inclusive). Used by pages
  // that display many detections at once — avoids N round-trips for N visible
  // detections by letting the frontend look up by (date, hour) from one fetch.
  if (req.method === 'GET' && pathname === '/api/weather/range') {
    try {
      if (!birdashDb) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'weather_unavailable' }));
        return true;
      }
      const params = new URL(req.url, 'http://localhost').searchParams;
      const from = params.get('from');
      const to = params.get('to') || from;
      if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_request' }));
        return true;
      }
      const rows = birdashDb.prepare(`SELECT date, hour, temp_c, humidity_pct, wind_kmh,
          wind_dir_deg, precip_mm, cloud_pct, pressure_hpa, weather_code
          FROM weather_hourly WHERE date >= ? AND date <= ? ORDER BY date, hour`).all(from, to);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ from, to, count: rows.length, snapshots: rows }));
    } catch(e) {
      console.error('[weather/range]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'weather_error', message: e.message }));
    }
    return true;
  }

  // ── Route : GET /api/weather/at?date=YYYY-MM-DD&time=HH:MM:SS ────────────
  // Returns the hourly weather snapshot covering the given moment, populated
  // by the weather-watcher background poller. 404 if no snapshot recorded
  // yet (typical for very recent detections before the next hourly poll).
  if (req.method === 'GET' && pathname === '/api/weather/at') {
    try {
      if (!birdashDb) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'weather_unavailable' }));
        return true;
      }
      const params = new URL(req.url, 'http://localhost').searchParams;
      const date = params.get('date');
      const time = params.get('time');
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !time) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_request' }));
        return true;
      }
      const hour = parseInt(time.split(':')[0], 10);
      if (isNaN(hour) || hour < 0 || hour > 23) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_time' }));
        return true;
      }
      const row = birdashDb.prepare(`SELECT temp_c, humidity_pct, wind_kmh, wind_dir_deg,
          precip_mm, cloud_pct, pressure_hpa, weather_code FROM weather_hourly
          WHERE date = ? AND hour = ?`).get(date, hour);
      if (!row) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_found' }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ date, hour, ...row }));
    } catch(e) {
      console.error('[weather/at]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'weather_error', message: e.message }));
    }
    return true;
  }

  // ════════════════════════════════════════════════════════════════════════
  // ── Weather analytics (phase C) ────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════
  // All four endpoints below JOIN active_detections (read DB) with
  // weather_hourly via the ATTACH'd `vdb` schema. The PK on
  // weather_hourly(date, hour) keeps each lookup O(log N).

  // WMO weather code → category bucket. Mirrored client-side in
  // bird-weather-chip.js wmoIcon/wmoLabel for consistency.
  const WMO_CASE = `CASE
    WHEN w.weather_code = 0 THEN 'clear'
    WHEN w.weather_code <= 2 THEN 'partly_cloudy'
    WHEN w.weather_code = 3 THEN 'cloudy'
    WHEN w.weather_code <= 48 THEN 'fog'
    WHEN w.weather_code <= 57 THEN 'drizzle'
    WHEN w.weather_code <= 67 OR (w.weather_code BETWEEN 80 AND 82) THEN 'rain'
    WHEN w.weather_code BETWEEN 71 AND 86 THEN 'snow'
    WHEN w.weather_code >= 95 THEN 'storm'
    ELSE 'unknown' END`;

  // Shared JOIN clause — used by every analytics query so we only have to
  // change the join shape in one place if the schema ever moves.
  const WEATHER_JOIN = `JOIN vdb.weather_hourly w
      ON w.date = d.Date AND w.hour = CAST(SUBSTR(d.Time, 1, 2) AS INT)`;

  // ── Route : GET /api/weather/condition-summary ───────────────────────────
  // Overall counts of detections + distinct species per WMO category.
  // Drives the pie/bar overview at the top of the analytics section.
  if (req.method === 'GET' && pathname === '/api/weather/condition-summary') {
    if (serveFromCache(req, res, ctx, 'cond-summary')) return true;
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const minConf = parseFloat(params.get('conf') || '0.7');
      const rows = db.prepare(`SELECT ${WMO_CASE} AS condition,
          COUNT(*) AS detections, COUNT(DISTINCT d.Sci_Name) AS species
        FROM active_detections d ${WEATHER_JOIN}
        WHERE d.Confidence >= ? GROUP BY condition ORDER BY detections DESC`).all(minConf);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows }));
    } catch(e) {
      console.error('[weather/condition-summary]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'analytics_error', message: e.message }));
    }
    return true;
  }

  // Shared filter parser for /species-by-condition and /match-summary.
  // Reads weather + time + date filters from URLSearchParams and returns
  // { wherePred: [...], args: [...] } ready to splice into a query.
  function parseWeatherFilters(params) {
    const wherePred = ['d.Confidence >= ?'];
    const args = [parseFloat(params.get('conf') || '0.7')];
    const numFilter = (key, col, op) => {
      const v = params.get(key);
      if (v == null || v === '') return;
      const n = parseFloat(v);
      if (!isNaN(n)) { wherePred.push(`w.${col} ${op} ?`); args.push(n); }
    };
    numFilter('temp_min',   'temp_c',   '>=');
    numFilter('temp_max',   'temp_c',   '<=');
    numFilter('precip_min', 'precip_mm', '>=');
    numFilter('precip_max', 'precip_mm', '<=');
    numFilter('wind_min',   'wind_kmh', '>=');
    numFilter('wind_max',   'wind_kmh', '<=');
    const hourMin = params.get('hour_min'), hourMax = params.get('hour_max');
    if (hourMin != null && hourMin !== '') {
      const h = parseInt(hourMin, 10);
      if (!isNaN(h)) { wherePred.push(`CAST(SUBSTR(d.Time, 1, 2) AS INT) >= ?`); args.push(h); }
    }
    if (hourMax != null && hourMax !== '') {
      const h = parseInt(hourMax, 10);
      if (!isNaN(h)) { wherePred.push(`CAST(SUBSTR(d.Time, 1, 2) AS INT) <= ?`); args.push(h); }
    }
    const dateFrom = params.get('date_from'), dateTo = params.get('date_to');
    if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) { wherePred.push(`d.Date >= ?`); args.push(dateFrom); }
    if (dateTo   && /^\d{4}-\d{2}-\d{2}$/.test(dateTo))   { wherePred.push(`d.Date <= ?`); args.push(dateTo); }
    const codesRaw = (params.get('codes') || '').split(',').map(s => s.trim()).filter(s => /^\d+$/.test(s));
    if (codesRaw.length) {
      wherePred.push(`w.weather_code IN (${codesRaw.map(() => '?').join(',')})`);
      args.push(...codesRaw.map(Number));
    }
    return { wherePred, args };
  }

  // ── Route : GET /api/weather/species-by-condition ────────────────────────
  // Top species matching weather predicates. Drives the cold/storm/rain/wind
  // leaderboards AND the custom-search card. All filters optional, AND'd.
  // Params:
  //   temp_min, temp_max          (°C)
  //   codes=95,96,99               WMO codes (comma list)
  //   precip_min, precip_max       (mm)
  //   wind_min, wind_max           (km/h)
  //   hour_min, hour_max           (0-23, by detection time)
  //   date_from, date_to           (YYYY-MM-DD, season filter)
  //   conf=0.7  limit=20
  if (req.method === 'GET' && pathname === '/api/weather/species-by-condition') {
    if (serveFromCache(req, res, ctx, 'species-by-cond')) return true;
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const { wherePred, args } = parseWeatherFilters(params);
      const limit = Math.min(500, Math.max(1, parseInt(params.get('limit') || '20')));
      const rows = db.prepare(`SELECT d.Sci_Name AS sci_name, d.Com_Name AS com_name,
          COUNT(*) AS detections, ROUND(AVG(d.Confidence) * 100, 1) AS avg_conf
        FROM active_detections d ${WEATHER_JOIN}
        WHERE ${wherePred.join(' AND ')}
        GROUP BY d.Sci_Name, d.Com_Name
        ORDER BY detections DESC LIMIT ?`).all(...args, limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ rows, total: rows.length }));
    } catch(e) {
      console.error('[weather/species-by-condition]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'analytics_error', message: e.message }));
    }
    return true;
  }

  // ── Route : GET /api/weather/match-summary ───────────────────────────────
  // Same filter shape as species-by-condition, but returns just the totals
  // — used by the live "12 348 détections · 47 espèces" header on the
  // custom-search card so we don't transfer the full row list just to count.
  if (req.method === 'GET' && pathname === '/api/weather/match-summary') {
    if (serveFromCache(req, res, ctx, 'match-summary')) return true;
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const { wherePred, args } = parseWeatherFilters(params);
      const row = db.prepare(`SELECT COUNT(*) AS detections,
          COUNT(DISTINCT d.Sci_Name) AS species
        FROM active_detections d ${WEATHER_JOIN}
        WHERE ${wherePred.join(' AND ')}`).get(...args);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(row || { detections: 0, species: 0 }));
    } catch(e) {
      console.error('[weather/match-summary]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'analytics_error', message: e.message }));
    }
    return true;
  }

  // ── Route : GET /api/weather/species-heatmap ─────────────────────────────
  // Cross-tab: top N species × temperature buckets. Returns dense matrix
  // suitable for ECharts/Chart.js heatmap rendering.
  // Params: top=30  conf=0.7  bin_size=5  bin_min=-15  bin_max=35
  if (req.method === 'GET' && pathname === '/api/weather/species-heatmap') {
    if (serveFromCache(req, res, ctx, 'species-heatmap')) return true;
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const minConf = parseFloat(params.get('conf') || '0.7');
      const top = Math.min(60, Math.max(5, parseInt(params.get('top') || '30')));
      const binSize = Math.min(10, Math.max(1, parseInt(params.get('bin_size') || '5')));
      const binMin = parseInt(params.get('bin_min') || '-15');
      const binMax = parseInt(params.get('bin_max') || '35');

      // Step 1: top N species in the joined dataset (i.e. species with at
      // least one detection that has weather data).
      const topSpecies = db.prepare(`SELECT d.Sci_Name AS sci_name, d.Com_Name AS com_name,
          COUNT(*) AS total
        FROM active_detections d ${WEATHER_JOIN}
        WHERE d.Confidence >= ?
        GROUP BY d.Sci_Name, d.Com_Name
        ORDER BY total DESC LIMIT ?`).all(minConf, top);
      if (!topSpecies.length) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ bins: [], species: [] }));
        return true;
      }
      // Step 2: per-(species, bin) count using bin index from temperature.
      // bin_idx = floor((temp_c - bin_min) / bin_size); clamped at edges so
      // outliers fall into the first/last bin rather than being dropped.
      const placeholders = topSpecies.map(() => '?').join(',');
      const sciNames = topSpecies.map(s => s.sci_name);
      const cells = db.prepare(`SELECT d.Sci_Name AS sci_name,
          MAX(0, MIN(?, CAST((w.temp_c - ?) / ? AS INT))) AS bin_idx,
          COUNT(*) AS n
        FROM active_detections d ${WEATHER_JOIN}
        WHERE d.Confidence >= ? AND w.temp_c IS NOT NULL
          AND d.Sci_Name IN (${placeholders})
        GROUP BY d.Sci_Name, bin_idx`).all(
          Math.floor((binMax - binMin) / binSize) - 1, binMin, binSize, minConf, ...sciNames);

      const binCount = Math.floor((binMax - binMin) / binSize);
      const bins = [];
      for (let i = 0; i < binCount; i++) {
        const lo = binMin + i * binSize, hi = lo + binSize;
        bins.push({ idx: i, label: `${lo}…${hi}°C`, lo, hi });
      }
      const cellMap = new Map();
      for (const c of cells) cellMap.set(`${c.sci_name}|${c.bin_idx}`, c.n);
      const species = topSpecies.map(s => ({
        sci_name: s.sci_name, com_name: s.com_name, total: s.total,
        counts: bins.map(b => cellMap.get(`${s.sci_name}|${b.idx}`) || 0),
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bins, species }));
    } catch(e) {
      console.error('[weather/species-heatmap]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'analytics_error', message: e.message }));
    }
    return true;
  }

  // ── Route : GET /api/weather/species-profile?species=Sci_name ────────────
  // Per-species distribution across weather conditions and temperature ranges.
  // Drives the "Profil météo" panel on species.html.
  if (req.method === 'GET' && pathname === '/api/weather/species-profile') {
    if (serveFromCache(req, res, ctx, 'species-profile')) return true;
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const sciName = params.get('species') || '';
      const minConf = parseFloat(params.get('conf') || '0.7');
      if (!sciName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_request', message: 'species param required' }));
        return true;
      }
      // Look up by Sci_Name OR Com_Name (callers sometimes pass either)
      const cond = db.prepare(`SELECT ${WMO_CASE} AS condition, COUNT(*) AS n
        FROM active_detections d ${WEATHER_JOIN}
        WHERE (d.Sci_Name = ? OR d.Com_Name = ?) AND d.Confidence >= ?
        GROUP BY condition ORDER BY n DESC`).all(sciName, sciName, minConf);
      // Temperature distribution in 5°C bins (clamped -15…+35)
      const temps = db.prepare(`SELECT
          MAX(0, MIN(9, CAST((w.temp_c - (-15)) / 5 AS INT))) AS bin_idx,
          COUNT(*) AS n
        FROM active_detections d ${WEATHER_JOIN}
        WHERE (d.Sci_Name = ? OR d.Com_Name = ?) AND d.Confidence >= ? AND w.temp_c IS NOT NULL
        GROUP BY bin_idx ORDER BY bin_idx`).all(sciName, sciName, minConf);
      const tempBins = [];
      for (let i = 0; i < 10; i++) tempBins.push({ idx: i, label: `${-15 + i * 5}…${-10 + i * 5}°C`, n: 0 });
      for (const t of temps) if (tempBins[t.bin_idx]) tempBins[t.bin_idx].n = t.n;
      // Quick stats
      const stats = db.prepare(`SELECT COUNT(*) AS total,
          ROUND(AVG(w.temp_c), 1) AS avg_temp,
          ROUND(MIN(w.temp_c), 1) AS min_temp,
          ROUND(MAX(w.temp_c), 1) AS max_temp,
          ROUND(AVG(w.wind_kmh), 1) AS avg_wind,
          ROUND(SUM(CASE WHEN w.precip_mm > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS pct_with_precip
        FROM active_detections d ${WEATHER_JOIN}
        WHERE (d.Sci_Name = ? OR d.Com_Name = ?) AND d.Confidence >= ? AND w.temp_c IS NOT NULL`)
        .get(sciName, sciName, minConf);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ species: sciName, conditions: cond, temp_bins: tempBins, stats }));
    } catch(e) {
      console.error('[weather/species-profile]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'analytics_error', message: e.message }));
    }
    return true;
  }

  return false;
}

module.exports = { handle };
