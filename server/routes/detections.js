'use strict';
/**
 * Detection routes — CRUD, taxonomy, validations, model-comparison, flagged, bulk-validate
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const safeConfig = require('../lib/safe-config');
const { localDateStr, localDateOffset } = require('../lib/local-date');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const aggregates = require('../lib/aggregates');
const { clearQueryCache } = require('./data');

// ── In-memory cache for expensive endpoints ──────────────────────────────
const _cache = new Map();
function cached(key, ttlMs, fn) {
  const entry = _cache.get(key);
  if (entry && (Date.now() - entry.ts) < ttlMs) return entry.data;
  const data = fn();
  _cache.set(key, { data, ts: Date.now() });
  return data;
}

function handle(req, res, pathname, ctx) {
  const { requireAuth, db, dbWrite, birdashDb, taxonomyDb, readJsonFile, JSON_CT, SONGS_DIR, parseBirdnetConf } = ctx;

  // ── Route : DELETE /api/detections ─────────────────────────────────────────
  // Delete a single detection by composite key (Date + Time + Com_Name)
  if (req.method === 'DELETE' && pathname === '/api/detections') {
    if (!requireAuth(req, res)) return true;
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
            'SELECT File_Name FROM active_detections WHERE Date=? AND Time=? AND Com_Name=?'
          ).all(date, time, comName);

          if (rows.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Detection not found' }));
            return;
          }

          // Delete from DB
          const result = dbWrite.prepare(
            'DELETE FROM active_detections WHERE Date=? AND Time=? AND Com_Name=?'
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

          // Invalidate caches + refresh aggregates so the UI immediately
          // reflects the deletion without waiting for the 5-min timer.
          clearQueryCache();
          _cache.clear();
          try { aggregates.refreshToday(dbWrite, date); } catch {}

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
    return true;
  }

  // ── Route : DELETE /api/detections/species ─────────────────────────────────
  // Bulk-delete ALL detections for a species (requires typed confirmation)
  if (req.method === 'DELETE' && pathname === '/api/detections/species') {
    if (!requireAuth(req, res)) return true;
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
            'SELECT File_Name FROM active_detections WHERE Com_Name=?'
          ).all(comName);

          if (rows.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No detections found for this species' }));
            return;
          }

          // Delete all from DB in a transaction
          const deleteAll = dbWrite.transaction(() => {
            return dbWrite.prepare('DELETE FROM active_detections WHERE Com_Name=?').run(comName);
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

          clearQueryCache();
          _cache.clear();
          try { aggregates.rebuildAll(dbWrite); } catch {} // full rebuild after bulk delete

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
    return true;
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

        // Cache taxonomy for 10 min (expensive DISTINCT + N lookups)
        const taxCacheKey = `tax_${lang}`;
        const taxHit = _cache.get(taxCacheKey);
        if (taxHit && (Date.now() - taxHit.ts) < 10 * 60 * 1000) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(taxHit.json);
          return;
        }

        // Build a family_sci → localized family_com map if lang is provided
        const famTr = {};
        if (lang && lang !== 'en') {
          const trRows = taxonomyDb.prepare('SELECT family_sci, family_com FROM family_translations WHERE locale = ?').all(lang);
          for (const r of trRows) famTr[r.family_sci] = r.family_com;
        }

        // Get all detected species
        const detected = db.prepare('SELECT DISTINCT Sci_Name, Com_Name FROM active_detections ORDER BY Sci_Name').all();
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
        const json = JSON.stringify({ species: result, orders, families });
        _cache.set(taxCacheKey, { json, ts: Date.now() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(json);
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
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
          `SELECT Sci_Name, Com_Name, COUNT(*) as count FROM active_detections d WHERE 1=1 ${whereClause} GROUP BY Sci_Name ORDER BY count DESC`
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
    return true;
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
    return true;
  }

  // ── Route : POST /api/validations ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/validations') {
    if (!requireAuth(req, res)) return true;
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
        // Validation changes what active_detections returns (the VIEW
        // is dynamic), but cached query results still hold the old data.
        clearQueryCache();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        console.error('[validations POST]', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return true;
  }

  // ── Route : GET /api/validation-stats ─────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/validation-stats') {
    if (!birdashDb) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'birdash.db not available' }));
      return;
    }
    try {
      const qs = new URL(req.url, 'http://x').searchParams;
      const date = qs.get('date');
      let whereClause = '', params = [];
      if (date) { whereClause = ' WHERE date = ?'; params = [date]; }

      const rows = birdashDb.prepare(
        'SELECT status, COUNT(*) as count FROM validations' + whereClause + ' GROUP BY status'
      ).all(...params);
      const stats = { confirmed: 0, doubtful: 0, rejected: 0 };
      for (const r of rows) stats[r.status] = r.count;

      // Per-species aggregation (majority status per species for the date)
      let bySpecies = {};
      if (date) {
        const spRows = birdashDb.prepare(
          'SELECT sci_name, status, COUNT(*) as n FROM validations WHERE date = ? GROUP BY sci_name, status ORDER BY sci_name, n DESC'
        ).all(date);
        // Keep majority status per species
        const seen = {};
        for (const r of spRows) {
          if (!seen[r.sci_name]) { seen[r.sci_name] = r.status; bySpecies[r.sci_name] = r.status; }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...stats, bySpecies }));
    } catch (err) {
      console.error('[validation-stats]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return true;
  }

  // Route : GET /api/health
  if (req.method === 'GET' && pathname === '/api/health') {
    try {
      const row = db.prepare("SELECT COUNT(*) as total FROM active_detections").get();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', total_detections: row.total }));
    } catch (err) {
      console.error('[health]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error' }));
    }
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════
  // ── Route : GET /api/model-comparison ────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/model-comparison') {
    (async () => {
      try {
        const qs = new URLSearchParams(req.url.split('?')[1] || '');
        const days = Math.min(parseInt(qs.get('days') || '7'), 90);
        const minDate = qs.get('dateFrom') || localDateOffset(-days);
        // Confidence filter — consistent with all other endpoints (default 0.7)
        const minConf = parseFloat(qs.get('minConf') || '0.7');

        const cacheKey = `mc_${minDate}_${minConf}`;
        const hit = _cache.get(cacheKey);
        if (hit && (Date.now() - hit.ts) < 5 * 60 * 1000) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(hit.data));
          return;
        }

        // Models active in period (confidence-filtered to avoid counting noise)
        const models = db.prepare(`
          SELECT DISTINCT Model FROM active_detections WHERE Date >= ? AND Confidence >= ?
        `).all(minDate, minConf).map(r => r.Model);

        // Per-model stats — confidence filter prevents low-quality detections from inflating counts
        const stats = {};
        for (const m of models) {
          const row = db.prepare(`
            SELECT COUNT(*) as total, COUNT(DISTINCT Sci_Name) as species,
                   round(AVG(Confidence),3) as avg_conf
            FROM active_detections WHERE Date >= ? AND Model = ? AND Confidence >= ?
          `).get(minDate, m, minConf);
          stats[m] = row;
        }

        // Species unique to each model — confidence filter applied to both sides
        const unique = {};
        for (const m of models) {
          const others = models.filter(o => o !== m);
          if (others.length === 0) continue;
          const placeholders = others.map(() => '?').join(',');
          const rows = db.prepare(`
            SELECT d.Sci_Name, d.Com_Name, COUNT(*) as n, round(AVG(d.Confidence),3) as avg_conf
            FROM active_detections d
            WHERE d.Date >= ? AND d.Model = ? AND d.Confidence >= ?
            AND d.Sci_Name NOT IN (
              SELECT DISTINCT Sci_Name FROM active_detections
              WHERE Date >= ? AND Model IN (${placeholders}) AND Confidence >= ?
            )
            GROUP BY d.Sci_Name ORDER BY n DESC
          `).all(minDate, m, minConf, minDate, ...others, minConf);
          unique[m] = rows;
        }

        // Species detected by ALL models (overlap) — confidence filter for fair comparison
        let overlap = [];
        if (models.length >= 2) {
          const m1 = models[0], m2 = models[1];
          overlap = db.prepare(`
            SELECT a.Sci_Name, a.Com_Name,
              a.n as n1, a.avg_conf as conf1,
              b.n as n2, b.avg_conf as conf2
            FROM (
              SELECT Sci_Name, Com_Name, COUNT(*) as n, round(AVG(Confidence),3) as avg_conf
              FROM active_detections WHERE Date >= ? AND Model = ? AND Confidence >= ? GROUP BY Sci_Name
            ) a
            INNER JOIN (
              SELECT Sci_Name, COUNT(*) as n, round(AVG(Confidence),3) as avg_conf
              FROM active_detections WHERE Date >= ? AND Model = ? AND Confidence >= ? Group BY Sci_Name
            ) b ON a.Sci_Name = b.Sci_Name
            ORDER BY (a.n + b.n) DESC
            LIMIT 30
          `).all(minDate, m1, minConf, minDate, m2, minConf);
        }

        // Daily detection counts per model — confidence filter for consistency
        const daily = db.prepare(`
          SELECT Date, Model, COUNT(*) as n
          FROM active_detections WHERE Date >= ? AND Confidence >= ?
          GROUP BY Date, Model ORDER BY Date
        `).all(minDate, minConf);

        const result = { models, stats, unique, overlap, daily, since: minDate };
        _cache.set(cacheKey, { data: result, ts: Date.now() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // (readJsonFile/writeJsonFileAtomic defined before createServer)

  // ══════════════════════════════════════════════════════════════════════════
  // ── DETECTION RULES MODULE ──────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════

  const DETECTION_RULES_PATH = path.join(PROJECT_ROOT, 'config', 'detection_rules.json');

  // ── Route : GET /api/detection-rules ────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/detection-rules') {
    const rules = readJsonFile(DETECTION_RULES_PATH) || {};
    res.writeHead(200, JSON_CT);
    res.end(JSON.stringify(rules));
    return true;
  }

  // ── Route : POST /api/detection-rules ───────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/detection-rules') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const rules = JSON.parse(body);
        await safeConfig.updateConfig(
          DETECTION_RULES_PATH,
          () => rules,                     // full replacement
          null,
          { label: 'POST /api/detection-rules', defaultValue: {} }
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
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
        const dateFrom = qs.get('dateFrom') || qs.get('date') || localDateStr();
        const dateTo = qs.get('dateTo') || dateFrom;
        const limit = Math.min(parseInt(qs.get('limit') || '500'), 2000);

        // Get all detections for the date range
        const rows = db.prepare(`
          SELECT Date, Time, Sci_Name, Com_Name, Confidence, File_Name, Model
          FROM active_detections WHERE Date >= ? AND Date <= ? ORDER BY Date DESC, Time DESC LIMIT ?
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
        res.end(JSON.stringify({ flagged, dateFrom, dateTo, total: flagged.length }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/bulk-validate ─────────────────────────────────────
  // Bulk confirm or reject detections
  if (req.method === 'POST' && pathname === '/api/bulk-validate') {
    if (!requireAuth(req, res)) return true;
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
        clearQueryCache();
        // If any rejection was added, refresh aggregates so counts
        // reflect the exclusion immediately (not after 5-min timer).
        if (status === 'rejected') {
          try { aggregates.refreshToday(dbWrite); } catch {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, count: detections.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // ── AUDIO CONFIG MODULE ─────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════


  // (Adaptive gain: state, agPushSample, agUpdate defined at module level)

  // ── Route : GET /api/stats/daily ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/stats/daily') {
    const qs = new URL(req.url, 'http://x').searchParams;
    const from = qs.get('from') || '2000-01-01';
    const to   = qs.get('to')   || '2099-12-31';
    const minConf = parseFloat(qs.get('minConf') || '0');
    try {
      const rows = db.prepare(
        'SELECT date, sci_name, com_name, count, avg_conf, max_conf, first_time, last_time FROM daily_stats WHERE date BETWEEN ? AND ?' + (minConf > 0 ? ' AND avg_conf >= ?' : '') + ' ORDER BY date, com_name'
      ).all(...(minConf > 0 ? [from, to, minConf] : [from, to]));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── Route : GET /api/stats/species ────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/stats/species') {
    try {
      const rows = db.prepare(
        'SELECT sci_name, com_name, total_count, first_date, last_date, avg_conf, day_count FROM species_stats ORDER BY total_count DESC'
      ).all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── Route : GET /api/stats/monthly ────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/stats/monthly') {
    const qs = new URL(req.url, 'http://x').searchParams;
    const from = qs.get('from') || '2000-01';
    const to   = qs.get('to')   || '2099-12';
    try {
      const rows = db.prepare(
        'SELECT year_month, sci_name, com_name, count, avg_conf, day_count FROM monthly_stats WHERE year_month BETWEEN ? AND ? ORDER BY year_month, count DESC'
      ).all(from, to);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── Route : GET /api/reports/weekly ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/reports/weekly') {
    (async () => {
      try {
        const qs = new URL(req.url, 'http://x').searchParams;
        const weeklyReport = require('../lib/weekly-report');

        // If ?generate=true, compute a fresh report
        if (qs.get('generate') === 'true') {
          const end = qs.get('end') || localDateStr();
          const start = localDateOffset(-6);
          const report = weeklyReport.generateReport(db, start, end);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(report));
          return;
        }

        // Otherwise return saved reports
        const reportPath = require('path').join(process.env.HOME, 'birdash', 'config', 'weekly-reports.json');
        try {
          const raw = await require('fs').promises.readFile(reportPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(raw);
        } catch(e) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/reports/weekly/send ──────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/reports/weekly/send') {
    if (!requireAuth(req, res)) return true;
    (async () => {
      try {
        const weeklyReport = require('../lib/weekly-report');
        const end = localDateStr();
        const start = localDateOffset(-6);
        const report = weeklyReport.generateReport(db, start, end);
        const text = weeklyReport.formatText(report, 'BirdStation');
        const sent = await weeklyReport.sendReport(
          `BirdStation Weekly — ${report.overall.species} species`,
          text
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, sent, report }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/admin/rebuild-stats ─────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/admin/rebuild-stats') {
    if (!requireAuth(req, res)) return true;
    try {
      const { rebuildAll } = require('../lib/aggregates');
      const result = rebuildAll(ctx.dbWrite || dbWrite);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  return false;
}

module.exports = { handle };
