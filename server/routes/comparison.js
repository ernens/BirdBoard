'use strict';
/**
 * Comparison routes — /api/comparison/*
 * Inter-annual and week-over-week analysis using pre-aggregated tables.
 */

function handle(req, res, pathname, ctx) {
  const { db, JSON_CT } = ctx;

  // ── Route : GET /api/comparison/weekly ───────────────────────────────────
  // Compare a given ISO week across years.
  // ?week=15&year=2026  or  ?date=2026-04-09  (auto-computes week)
  if (req.method === 'GET' && pathname === '/api/comparison/weekly') {
    (async () => {
      try {
        const qs = new URL(req.url, 'http://x').searchParams;
        let year = parseInt(qs.get('year') || new Date().getFullYear());
        let week = parseInt(qs.get('week') || 0);
        const minConf = parseFloat(qs.get('minConf') || '0.7');

        // If date is provided, compute ISO week from it
        if (!week && qs.get('date')) {
          const d = new Date(qs.get('date') + 'T12:00:00');
          year = d.getFullYear();
          week = getISOWeek(d);
        }
        if (!week) {
          week = getISOWeek(new Date());
        }

        // Compute week boundaries for each year in the dataset
        const years = db.prepare(
          "SELECT DISTINCT SUBSTR(date,1,4) as y FROM daily_stats ORDER BY y"
        ).all().map(r => parseInt(r.y));

        const result = { week, years: {} };

        for (const y of years) {
          const [wStart, wEnd] = isoWeekBounds(y, week);
          const rows = db.prepare(`
            SELECT sci_name, com_name, SUM(count) as total, ROUND(AVG(avg_conf),4) as avg_conf,
                   COUNT(DISTINCT date) as days_present
            FROM daily_stats
            WHERE date BETWEEN ? AND ? AND avg_conf >= ?
            GROUP BY sci_name ORDER BY total DESC
          `).all(wStart, wEnd, minConf);

          const totalDet = rows.reduce((s, r) => s + r.total, 0);
          result.years[y] = {
            dateRange: [wStart, wEnd],
            species: rows,
            totalDetections: totalDet,
            speciesCount: rows.length,
          };
        }

        // Compute diffs between current year and previous year
        const curYear = year;
        const prevYear = years.filter(y => y < curYear).pop();
        if (prevYear && result.years[curYear] && result.years[prevYear]) {
          const cur = new Set(result.years[curYear].species.map(s => s.sci_name));
          const prev = new Set(result.years[prevYear].species.map(s => s.sci_name));

          result.newArrivals = result.years[curYear].species
            .filter(s => !prev.has(s.sci_name))
            .map(s => ({ ...s, status: 'new' }));

          result.departed = result.years[prevYear].species
            .filter(s => !cur.has(s.sci_name))
            .map(s => ({ ...s, status: 'absent' }));

          result.common = result.years[curYear].species
            .filter(s => prev.has(s.sci_name))
            .map(s => {
              const p = result.years[prevYear].species.find(ps => ps.sci_name === s.sci_name);
              return {
                ...s,
                prevTotal: p ? p.total : 0,
                delta: p ? s.total - p.total : s.total,
                deltaPercent: p && p.total > 0 ? Math.round((s.total - p.total) / p.total * 100) : null,
              };
            });

          result.comparison = { currentYear: curYear, previousYear: prevYear };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/comparison/seasonal ──────────────────────────────────
  // Compare a month across all years.
  // ?month=4  or  ?month=04
  if (req.method === 'GET' && pathname === '/api/comparison/seasonal') {
    (async () => {
      try {
        const qs = new URL(req.url, 'http://x').searchParams;
        const month = String(parseInt(qs.get('month') || new Date().getMonth() + 1)).padStart(2, '0');
        const minConf = parseFloat(qs.get('minConf') || '0.7');

        // Get all year-months matching this month
        const yms = db.prepare(
          "SELECT DISTINCT year_month FROM monthly_stats WHERE SUBSTR(year_month,6,2) = ? ORDER BY year_month"
        ).all(month).map(r => r.year_month);

        const result = { month: parseInt(month), years: {} };

        for (const ym of yms) {
          const y = parseInt(ym.substring(0, 4));
          const rows = db.prepare(`
            SELECT sci_name, com_name, count as total, avg_conf, day_count
            FROM monthly_stats
            WHERE year_month = ? AND avg_conf >= ?
            ORDER BY count DESC
          `).all(ym, minConf);

          result.years[y] = {
            yearMonth: ym,
            species: rows,
            totalDetections: rows.reduce((s, r) => s + r.total, 0),
            speciesCount: rows.length,
          };
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/comparison/species-trend ─────────────────────────────
  // Weekly detection count for a species across all years.
  // ?species=Phylloscopus+collybita
  if (req.method === 'GET' && pathname === '/api/comparison/species-trend') {
    (async () => {
      try {
        const qs = new URL(req.url, 'http://x').searchParams;
        const sci = qs.get('species');
        if (!sci) { res.writeHead(400, JSON_CT); res.end('{"error":"species param required"}'); return; }

        const rows = db.prepare(`
          SELECT date, count, avg_conf FROM daily_stats
          WHERE sci_name = ? ORDER BY date
        `).all(sci);

        // Group by ISO week + year
        const byYearWeek = {};
        for (const r of rows) {
          const d = new Date(r.date + 'T12:00:00');
          const y = d.getFullYear();
          const w = getISOWeek(d);
          const key = `${y}-W${String(w).padStart(2, '0')}`;
          if (!byYearWeek[key]) byYearWeek[key] = { year: y, week: w, total: 0, days: 0 };
          byYearWeek[key].total += r.count;
          byYearWeek[key].days++;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ species: sci, weeks: Object.values(byYearWeek) }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  return false;
}

// ── ISO Week utilities ────────────────────────────────────────────────────────
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function isoWeekBounds(year, week) {
  // Find the Monday of ISO week
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return [monday.toISOString().split('T')[0], sunday.toISOString().split('T')[0]];
}

module.exports = { handle };
