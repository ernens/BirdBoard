'use strict';
/**
 * Purge routes — soft-delete + restore for detections.
 *
 * The single canonical entry point for removing detections + audio. Other
 * pages may still surface "send to purge" actions later, but actual
 * deletion (and restoration) lives here.
 *
 * Soft-delete pattern:
 *   - Row moves from `detections` to `detections_trashed` (same shape +
 *     trashed_at + original_path).
 *   - mp3 + .mp3.png mv'd from ~/BirdSongs/Extracted/By_Date/<date>/<sp>/
 *     to ~/BirdSongs/Trashed/By_Date/<date>/<sp>/ — same filesystem, so
 *     it's a rename, not a copy. No extra disk used during the move.
 *   - Restore is the symmetric operation.
 *   - A nightly cron hard-purges entries older than the retention window
 *     (default 90 days, override via BIRDASH_TRASH_RETENTION_DAYS).
 */

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const aggregates = require('../lib/aggregates');
const resultCache = require('../lib/result-cache');

// detections live under ~/BirdSongs/Extracted/By_Date/<date>/<species>/file
// We mirror to ~/BirdSongs/Trashed/By_Date/<date>/<species>/file — same
// filesystem so mv is instant, easy to inspect by hand if needed.
function trashDir(songsDir) {
  // SONGS_DIR ends with "Extracted/By_Date" by convention, walk up two then in.
  return path.resolve(songsDir, '..', '..', 'Trashed', 'By_Date');
}

// Both live + trashed file paths derive from the same naming convention.
// Filename pattern: "<species_underscored>-<conf>-<YYYY-MM-DD>-...".
function pathsForRow(row, songsDir) {
  const trashRoot = trashDir(songsDir);
  const m = row.File_Name.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
  if (!m) return null;
  const species = m[1];
  const date = m[2];
  return {
    livePath: path.join(songsDir, date, species, row.File_Name),
    trashPath: path.join(trashRoot, date, species, row.File_Name),
  };
}

// Move file (and its .png sibling) live → trash, or trash → live.
// Tolerates missing files — common for clips already pruned by the
// rolling-cleanup, or restored after the user manually deleted from disk.
async function moveAudio(srcDir, srcBase, dstDir, dstBase) {
  await fsp.mkdir(dstDir, { recursive: true });
  const moved = [];
  for (const ext of ['', '.png']) {
    const src = path.join(srcDir, srcBase + ext);
    const dst = path.join(dstDir, dstBase + ext);
    try {
      await fsp.rename(src, dst);
      moved.push(dst);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return moved;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ── Filter parsing — shared by /list (active + trash views) ─────────────────
// Returns { whereSql, params } that work against either table since they
// share column names.
function buildWhere(qp) {
  const where = [];
  const params = [];
  const species = qp.get('species');
  if (species) {
    const list = species.split(',').filter(Boolean);
    if (list.length) {
      where.push(`Com_Name IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }
  const dateFrom = qp.get('date_from');
  if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    where.push('Date >= ?'); params.push(dateFrom);
  }
  const dateTo = qp.get('date_to');
  if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    where.push('Date <= ?'); params.push(dateTo);
  }
  const model = qp.get('model');
  if (model) {
    const list = model.split(',').filter(Boolean);
    if (list.length) {
      where.push(`Model IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }
  const confMin = parseFloat(qp.get('conf_min'));
  if (!isNaN(confMin)) { where.push('Confidence >= ?'); params.push(confMin); }
  const confMax = parseFloat(qp.get('conf_max'));
  if (!isNaN(confMax)) { where.push('Confidence <= ?'); params.push(confMax); }
  const source = qp.get('source');
  if (source === '__null__') {
    where.push('Source IS NULL');
  } else if (source) {
    const list = source.split(',').filter(Boolean);
    if (list.length) {
      where.push(`Source IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }
  return {
    whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '',
    params,
  };
}

function handle(req, res, pathname, ctx) {
  const { requireAuth, db, dbWrite, SONGS_DIR } = ctx;

  // ── GET /api/purge/list ────────────────────────────────────────────────
  // Lists active or trashed detections matching the filters.
  // Query: view=active|trash, species, date_from, date_to, model, conf_min,
  //        conf_max, source, orphaned (1=mp3 missing on disk), limit, offset.
  //
  // The orphaned filter scans the filesystem (one stat per row), which is
  // fast on NVMe but unbounded on a million-row DB. Hard cap: 10000 rows
  // pre-filter — if exceeded, returns an explicit error so the UI can
  // suggest narrowing the date/species filters first.
  if (req.method === 'GET' && pathname === '/api/purge/list') {
    const url = new URL(req.url, 'http://x');
    const qp = url.searchParams;
    const view = qp.get('view') === 'trash' ? 'trash' : 'active';
    const limit = Math.min(200, Math.max(1, parseInt(qp.get('limit') || '50')));
    const offset = Math.max(0, parseInt(qp.get('offset') || '0'));
    const orphaned = qp.get('orphaned') === '1';
    const { whereSql, params } = buildWhere(qp);

    const ORPHAN_SCAN_CAP = 50000;
    const cols = view === 'active'
      ? 'rowid AS rowid, Date, Time, Sci_Name, Com_Name, Confidence, Model, Source, File_Name'
      : 'id AS rowid, Date, Time, Sci_Name, Com_Name, Confidence, Model, Source, File_Name, trashed_at, original_path';
    const tbl = view === 'active' ? 'detections' : 'detections_trashed';
    const orderSql = view === 'active' ? 'ORDER BY Date DESC, Time DESC' : 'ORDER BY trashed_at DESC';

    (async () => {
      try {
        let rows, total;
        if (orphaned) {
          // Pre-filter row count for the safety cap
          const preTotal = db.prepare(`SELECT COUNT(*) AS n FROM ${tbl} ${whereSql}`).get(...params).n;
          if (preTotal > ORPHAN_SCAN_CAP) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'too_many_for_orphan_scan',
              message: `Narrow filters first — orphan scan caps at ${ORPHAN_SCAN_CAP} rows (current selection: ${preTotal}).`,
              cap: ORPHAN_SCAN_CAP,
              preTotal,
            }));
            return;
          }
          const allRows = db.prepare(`SELECT ${cols} FROM ${tbl} ${whereSql} ${orderSql}`).all(...params);
          const filtered = [];
          for (const r of allRows) {
            const m = (r.File_Name || '').match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
            if (!m) { filtered.push(r); continue; }   // unparseable → treat as orphan
            const fp = view === 'active'
              ? path.join(SONGS_DIR, m[2], m[1], r.File_Name)
              : path.join(trashDir(SONGS_DIR), m[2], m[1], r.File_Name);
            try { await fsp.access(fp); }
            catch { filtered.push(r); }
          }
          total = filtered.length;
          rows = filtered.slice(offset, offset + limit);
        } else {
          rows = db.prepare(`SELECT ${cols} FROM ${tbl} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`).all(...params, limit, offset);
          total = db.prepare(`SELECT COUNT(*) AS n FROM ${tbl} ${whereSql}`).get(...params).n;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ view, rows, total, limit, offset, orphaned }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── POST /api/purge/trash ──────────────────────────────────────────────
  // Body: { rowids: [n, ...] }  (rowids of `detections`)
  // Moves rows to detections_trashed + mv files to Trashed/By_Date/.
  if (req.method === 'POST' && pathname === '/api/purge/trash') {
    if (!requireAuth(req, res)) return true;
    readBody(req).then(async (body) => {
      const rowids = Array.isArray(body.rowids) ? body.rowids.filter(n => Number.isInteger(n)) : [];
      if (!rowids.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rowids[] required (integers)' }));
        return;
      }

      const placeholders = rowids.map(() => '?').join(',');
      const liveRows = dbWrite.prepare(
        `SELECT rowid AS rowid, * FROM detections WHERE rowid IN (${placeholders})`
      ).all(...rowids);

      if (!liveRows.length) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No matching detections' }));
        return;
      }

      const insertTrash = dbWrite.prepare(`
        INSERT INTO detections_trashed (
          Date, Time, Sci_Name, Com_Name, Confidence, Lat, Lon, Cutoff,
          Week, Sens, Overlap, File_Name, Model, Source,
          trashed_at, original_path
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      const deleteLive = dbWrite.prepare('DELETE FROM detections WHERE rowid = ?');
      const trashedAt = Math.floor(Date.now() / 1000);
      const datesAffected = new Set();
      const fileWarnings = [];
      let trashed = 0;

      // Per-row transaction so a single bad file doesn't kill the whole batch.
      // The mv happens BEFORE the row move so a failing mv doesn't leave the
      // DB in trash state with no file to restore.
      for (const row of liveRows) {
        const paths = pathsForRow(row, SONGS_DIR);
        if (!paths) {
          fileWarnings.push({ rowid: row.rowid, error: 'unparseable filename: ' + row.File_Name });
          continue;
        }
        try {
          await moveAudio(
            path.dirname(paths.livePath), row.File_Name,
            path.dirname(paths.trashPath), row.File_Name
          );
        } catch (e) {
          fileWarnings.push({ rowid: row.rowid, error: e.message });
          continue;
        }
        const tx = dbWrite.transaction(() => {
          insertTrash.run(
            row.Date, row.Time, row.Sci_Name, row.Com_Name, row.Confidence,
            row.Lat, row.Lon, row.Cutoff, row.Week, row.Sens, row.Overlap,
            row.File_Name, row.Model, row.Source, trashedAt, paths.livePath
          );
          deleteLive.run(row.rowid);
        });
        tx();
        trashed++;
        datesAffected.add(row.Date);
      }

      resultCache.clearAll();
      try {
        for (const date of datesAffected) aggregates.refreshToday(dbWrite, date);
      } catch {}

      console.log(`[purge] trashed ${trashed} detection(s)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, trashed, fileWarnings }));
    }).catch((e) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return true;
  }

  // ── POST /api/purge/restore ────────────────────────────────────────────
  // Body: { ids: [n, ...] }  (ids from detections_trashed)
  if (req.method === 'POST' && pathname === '/api/purge/restore') {
    if (!requireAuth(req, res)) return true;
    readBody(req).then(async (body) => {
      const ids = Array.isArray(body.ids) ? body.ids.filter(n => Number.isInteger(n)) : [];
      if (!ids.length) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'ids[] required (integers)' }));
        return;
      }
      const placeholders = ids.map(() => '?').join(',');
      const trashedRows = dbWrite.prepare(
        `SELECT * FROM detections_trashed WHERE id IN (${placeholders})`
      ).all(...ids);
      if (!trashedRows.length) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No matching trashed entries' }));
        return;
      }

      const insertLive = dbWrite.prepare(`
        INSERT INTO detections (
          Date, Time, Sci_Name, Com_Name, Confidence, Lat, Lon, Cutoff,
          Week, Sens, Overlap, File_Name, Model, Source
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `);
      const deleteTrash = dbWrite.prepare('DELETE FROM detections_trashed WHERE id = ?');
      const datesAffected = new Set();
      const fileWarnings = [];
      let restored = 0;

      for (const row of trashedRows) {
        const paths = pathsForRow(row, SONGS_DIR);
        // Try to mv files back; tolerate ENOENT (already gone). This is the
        // symmetric of the trash mv.
        if (paths) {
          try {
            await moveAudio(
              path.dirname(paths.trashPath), row.File_Name,
              path.dirname(paths.livePath), row.File_Name
            );
          } catch (e) {
            fileWarnings.push({ id: row.id, error: e.message });
          }
        }
        const tx = dbWrite.transaction(() => {
          insertLive.run(
            row.Date, row.Time, row.Sci_Name, row.Com_Name, row.Confidence,
            row.Lat, row.Lon, row.Cutoff, row.Week, row.Sens, row.Overlap,
            row.File_Name, row.Model, row.Source
          );
          deleteTrash.run(row.id);
        });
        tx();
        restored++;
        datesAffected.add(row.Date);
      }

      resultCache.clearAll();
      try {
        for (const date of datesAffected) aggregates.refreshToday(dbWrite, date);
      } catch {}

      console.log(`[purge] restored ${restored} detection(s)`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, restored, fileWarnings }));
    }).catch((e) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return true;
  }

  // ── POST /api/purge/empty-trash ────────────────────────────────────────
  // Body: { confirm: 'EMPTY' [, ids: [...]] }
  // Hard-deletes from detections_trashed + rm files. Optional ids restrict
  // to a subset; otherwise empties everything.
  if (req.method === 'POST' && pathname === '/api/purge/empty-trash') {
    if (!requireAuth(req, res)) return true;
    readBody(req).then(async (body) => {
      if (body.confirm !== 'EMPTY') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "confirm must equal 'EMPTY'" }));
        return;
      }
      const ids = Array.isArray(body.ids) ? body.ids.filter(n => Number.isInteger(n)) : null;
      const rows = ids && ids.length
        ? dbWrite.prepare(`SELECT * FROM detections_trashed WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
        : dbWrite.prepare('SELECT * FROM detections_trashed').all();

      let purged = 0, removed = 0;
      const trashRoot = trashDir(SONGS_DIR);
      for (const row of rows) {
        const paths = pathsForRow(row, SONGS_DIR);
        if (paths) {
          for (const ext of ['', '.png']) {
            try { await fsp.unlink(paths.trashPath + ext); removed++; } catch (e) { /* ENOENT OK */ }
          }
        }
        dbWrite.prepare('DELETE FROM detections_trashed WHERE id = ?').run(row.id);
        purged++;
      }
      // Best-effort: prune empty subdirs in the trash root
      try {
        const cmd = require('child_process');
        cmd.execSync(`find "${trashRoot}" -type d -empty -delete 2>/dev/null`, { stdio: 'ignore' });
      } catch {}

      console.log(`[purge] empty-trash: purged ${purged} rows, removed ${removed} files`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, purged, removed }));
    }).catch((e) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    });
    return true;
  }

  // ── GET /api/purge/file?id=N&type=mp3|png ──────────────────────────────
  // Streams a file from the trash directory. Caddy serves the live
  // /birds/audio/* paths but doesn't know about Trashed/, so we serve it
  // here so the Purge page can render trashed-row spectrograms + audio.
  if (req.method === 'GET' && pathname === '/api/purge/file') {
    const url = new URL(req.url, 'http://x');
    const id = parseInt(url.searchParams.get('id'));
    const type = url.searchParams.get('type') === 'png' ? '.png' : '';
    if (!Number.isInteger(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"error":"id required"}');
      return true;
    }
    const row = db.prepare('SELECT * FROM detections_trashed WHERE id = ?').get(id);
    if (!row) {
      res.writeHead(404); res.end(); return true;
    }
    const paths = pathsForRow(row, SONGS_DIR);
    if (!paths) {
      res.writeHead(404); res.end(); return true;
    }
    const fp = paths.trashPath + type;
    fsp.stat(fp).then((stat) => {
      const mime = type === '.png' ? 'image/png' : 'audio/mpeg';
      res.writeHead(200, { 'Content-Type': mime, 'Content-Length': stat.size, 'Cache-Control': 'private, max-age=300' });
      fs.createReadStream(fp).pipe(res);
    }).catch(() => {
      res.writeHead(404); res.end();
    });
    return true;
  }

  // ── GET /api/purge/species?q=foo ───────────────────────────────────────
  // Autocomplete for the species filter — distinct Com_Name (UNION of
  // active + trash) matching the prefix, capped at 20 results.
  if (req.method === 'GET' && pathname === '/api/purge/species') {
    const q = String(new URL(req.url, 'http://x').searchParams.get('q') || '').trim();
    if (!q) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ species: [] }));
      return true;
    }
    try {
      const rows = db.prepare(`
        SELECT Com_Name FROM (
          SELECT Com_Name FROM detections WHERE Com_Name LIKE ? COLLATE NOCASE
          UNION
          SELECT Com_Name FROM detections_trashed WHERE Com_Name LIKE ? COLLATE NOCASE
        ) GROUP BY Com_Name ORDER BY Com_Name LIMIT 20
      `).all(q + '%', q + '%');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ species: rows.map(r => r.Com_Name) }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── GET /api/purge/stats ───────────────────────────────────────────────
  // Lightweight summary for the page header: counts + retention window.
  if (req.method === 'GET' && pathname === '/api/purge/stats') {
    try {
      const activeCount = db.prepare('SELECT COUNT(*) AS n FROM detections').get().n;
      // detections_trashed is created by a deferred migration (5s after
      // boot) to avoid SQLITE_BUSY contention with the engine. On a fresh
      // install or in the first 5 s of uptime the table may not exist yet —
      // treat that as "no trash" rather than 500ing the whole header card.
      let trashCount = 0;
      let oldest = null;
      try {
        trashCount = db.prepare('SELECT COUNT(*) AS n FROM detections_trashed').get().n;
        oldest = db.prepare('SELECT MIN(trashed_at) AS t FROM detections_trashed').get().t;
      } catch (e) {
        if (!/no such table/i.test(e.message)) throw e;
      }
      const retentionDays = parseInt(process.env.BIRDASH_TRASH_RETENTION_DAYS || '90');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        activeCount, trashCount,
        oldestTrashedAt: oldest || null,
        retentionDays,
      }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  return false;
}

// ── Hard-purge job (called from the alerts loop) ────────────────────────────
// Drops trashed entries older than retention + their files. Idempotent.
async function runRetention(ctx) {
  const { dbWrite, SONGS_DIR } = ctx;
  const days = parseInt(process.env.BIRDASH_TRASH_RETENTION_DAYS || '90');
  if (!days || days <= 0) return { skipped: true };
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = dbWrite.prepare(
    'SELECT * FROM detections_trashed WHERE trashed_at < ?'
  ).all(cutoff);
  if (!rows.length) return { purged: 0, removed: 0 };
  let purged = 0, removed = 0;
  for (const row of rows) {
    const paths = pathsForRow(row, SONGS_DIR);
    if (paths) {
      for (const ext of ['', '.png']) {
        try { await fsp.unlink(paths.trashPath + ext); removed++; } catch (e) { /* ENOENT OK */ }
      }
    }
    dbWrite.prepare('DELETE FROM detections_trashed WHERE id = ?').run(row.id);
    purged++;
  }
  console.log(`[purge:retention] expired ${purged} rows / ${removed} files (${days}d)`);
  return { purged, removed };
}

module.exports = { handle, runRetention };
