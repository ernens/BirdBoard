/**
 * bird-queries.js — Centralized SQL query library for Birdash
 *
 * Single source of truth for all SQL patterns. Confidence threshold
 * is applied automatically from BIRD_CONFIG.defaultConfidence unless
 * overridden via the optional `c` parameter (for pages with sliders).
 *
 * Usage:
 *   const Q = BIRDASH_QUERIES;
 *   const rows = await birdQuery(...Q.todayStats('2026-04-06'));
 *   const rows = await birdQuery(...Q.todayStats('2026-04-06', 0.5)); // custom conf
 *
 * Each function returns [sql, params] — spread into birdQuery(sql, params).
 */
(function (config) {
  'use strict';

  const C = () => config.defaultConfidence || 0.7;

  const Q = {

    // ═══════════════════════════════════════════════════════════
    //  GENERAL / CROSS-PAGE
    // ═══════════════════════════════════════════════════════════

    /** All distinct species names — detections, species, filters.
     *  Uses raw table (not VIEW) — full-table scan on 1M+ rows is
     *  200× slower through the NOT EXISTS VIEW, and the ~13 rejected
     *  entries are negligible for a species picker. */
    allSpeciesNames() {
      return ['SELECT DISTINCT Com_Name, MAX(Sci_Name) as Sci_Name FROM detections GROUP BY Com_Name ORDER BY Com_Name ASC', []];
    },

    /**
     * Species observed at or above the confidence threshold, with their
     * detection count. Used by pickers that drive views which themselves
     * filter by confidence (e.g. phenology.html), so the dropdown
     * doesn't list species the page can't visualize.
     *
     * Returns rows: { Com_Name, Sci_Name, n } sorted by count desc then
     * common name asc, so well-documented species rise to the top.
     */
    speciesWithCounts(c) {
      return [
        'SELECT Com_Name, MAX(Sci_Name) as Sci_Name, COUNT(*) as n FROM active_detections WHERE Confidence >= ? GROUP BY Com_Name ORDER BY n DESC, Com_Name ASC',
        [(c != null ? c : C())]
      ];
    },

    /** All distinct common names only — detections filter */
    allCommonNames() {
      return ['SELECT DISTINCT Com_Name FROM detections ORDER BY Com_Name ASC', []];
    },

    /** First observation date per species — today, calendar, recent, gallery */
    firstObservations(c) {
      return ['SELECT Com_Name, MIN(Date) as first_date FROM active_detections WHERE Confidence>=? GROUP BY Com_Name', [(c != null ? c : C())]];
    },

    /** Species first seen on a specific date — today, calendar, recent */
    newSpeciesForDate(date, c) {
      return ['SELECT Com_Name FROM active_detections WHERE Confidence>=? GROUP BY Com_Name HAVING MIN(Date)=?', [(c != null ? c : C()), date]];
    },

    /** New species since a date — detections, gallery */
    newSpeciesSince(dateFrom, c) {
      return ['SELECT Com_Name FROM detections GROUP BY Com_Name HAVING MIN(Date)>=?', [dateFrom || '2000-01-01']];
    },

    /** Current confidence threshold */
    confidence() { return C(); },

    // ═══════════════════════════════════════════════════════════
    //  DASHBOARD (Bird Flow)
    // ═══════════════════════════════════════════════════════════

    /** Day stats: total + unique species — dashboard, today, overview */
    todayStats(date, c) {
      return ['SELECT COUNT(*) as total, COUNT(DISTINCT Com_Name) as species FROM active_detections WHERE Date=? AND Confidence>=?', [date, (c != null ? c : C())]];
    },

    /** Extended day stats with avg confidence — today, calendar, recent */
    todayStatsExtended(date, c) {
      return [
        'SELECT COUNT(*) as n, COUNT(DISTINCT Com_Name) as sp, ROUND(AVG(Confidence)*100,1) as conf, MAX(Date) as last_date, MAX(Time) as last_time FROM active_detections WHERE Date=? AND Confidence>=?',
        [date, (c != null ? c : C())]
      ];
    },

    /** Last hour detection count — today, calendar, recent, overview */
    lastHourCount(date, c) {
      return [
        "SELECT COUNT(*) as n FROM active_detections WHERE Date=? AND Confidence>=? AND Time>=time('now','-1 hour','localtime')",
        [date, (c != null ? c : C())]
      ];
    },

    /**
     * Latest N detections — dashboard, overview, species.
     * Deduplicates same-clip same-species across models (BirdNET + Perch),
     * keeping the highest-confidence row via SQLite bare-column MAX trick.
     */
    latestDetections(n = 1, c) {
      return [
        'SELECT Date, Time, Sci_Name, Com_Name, MAX(Confidence) as Confidence, Model, File_Name FROM active_detections WHERE Confidence>=? GROUP BY Date, Time, Com_Name ORDER BY Date DESC, Time DESC LIMIT ?',
        [(c != null ? c : C()), n]
      ];
    },

    /** Latest detection (unfiltered) — overview */
    latestDetectionRaw() {
      return ['SELECT Date, Time, Com_Name, Sci_Name, Confidence, File_Name, Model FROM detections ORDER BY Date DESC, Time DESC LIMIT 1', []];
    },

    /** Best detection of a given day (highest confidence) — overview */
    bestOfDay(date) {
      return ['SELECT Date, Time, Com_Name, Sci_Name, Confidence, File_Name, Model FROM detections WHERE Date=? ORDER BY Confidence DESC, Time DESC LIMIT 1', [date]];
    },

    // ═══════════════════════════════════════════════════════════
    //  SPECIES BY DATE / RANGE
    // ═══════════════════════════════════════════════════════════

    /** Species grouped for a date (by last time desc) — dashboard */
    speciesByDate(date, limit = 100, c) {
      return [
        'SELECT Com_Name, Sci_Name, COUNT(*) as n, MAX(Time) as last_time FROM active_detections WHERE Date=? AND Confidence>=? GROUP BY Sci_Name ORDER BY last_time DESC LIMIT ?',
        [date, (c != null ? c : C()), limit]
      ];
    },

    /** Top species for a date range with limit — overview */
    topSpecies(dateFrom, limit, c) {
      return [
        'SELECT Com_Name, Sci_Name, COUNT(*) as n FROM active_detections WHERE Date>=? AND Confidence>=? GROUP BY Com_Name, Sci_Name ORDER BY n DESC LIMIT ?',
        [dateFrom, (c != null ? c : C()), limit]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  DETECTIONS DETAIL
    // ═══════════════════════════════════════════════════════════

    /** Detections for a species on a date — today, calendar, recent */
    detectionsForSpecies(date, comName, c) {
      return [
        'SELECT Time, Confidence, File_Name, Model FROM active_detections WHERE Date=? AND Com_Name=? AND Confidence>=? ORDER BY Time DESC',
        [date, comName, (c != null ? c : C())]
      ];
    },

    /** All detections of a species (latest first) — species page */
    speciesDetections(comName, limit = 15, c) {
      // Confidence filter ensures detection list matches filtered totals
      return [
        'SELECT Date, Time, Confidence, File_Name, Model FROM active_detections WHERE Com_Name=? AND Confidence>=? ORDER BY Date DESC, Time DESC LIMIT ?',
        [comName, (c != null ? c : C()), limit]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  HOURLY / TEMPORAL DISTRIBUTION
    // ═══════════════════════════════════════════════════════════

    /** Hourly distribution for a date — today, overview.
     *  Uses hourly_stats (pre-aggregated) for ×100 speed gain.
     *  Falls back to raw scan if hourly_stats is empty (upgrade in progress). */
    hourlyDistribution(date, c) {
      return [
        "SELECT hour as h, SUM(count_07) as n FROM hourly_stats WHERE date=? GROUP BY hour ORDER BY hour ASC",
        [date]
      ];
    },
    /** Fallback if hourly_stats returns nothing (table empty/not rebuilt yet) */
    hourlyDistributionRaw(date, c) {
      return [
        "SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as h, COUNT(*) as n FROM active_detections WHERE Date=? AND Confidence>=? GROUP BY h",
        [date, (c != null ? c : C())]
      ];
    },

    /** Hourly distribution for a species — species page.
     *  Uses hourly_stats for speed; falls back to raw if empty. */
    hourlyBySpecies(comName, c) {
      return [
        "SELECT hour as h, SUM(count_07) as n FROM hourly_stats WHERE com_name=? GROUP BY hour ORDER BY hour ASC",
        [comName]
      ];
    },
    hourlyBySpeciesRaw(comName, c) {
      return [
        "SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as h, COUNT(*) as n FROM active_detections WHERE Com_Name=? AND Confidence>=? GROUP BY h ORDER BY h ASC",
        [comName, (c != null ? c : C())]
      ];
    },

    /** Daily count for a species in a date range — species page */
    dailyBySpecies(comName, dateFrom, c) {
      return [
        "SELECT Date, COUNT(*) as n FROM active_detections WHERE Com_Name=? AND Date>=? AND Confidence>=? GROUP BY Date ORDER BY Date ASC",
        [comName, dateFrom, (c != null ? c : C())]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  OVERVIEW
    // ═══════════════════════════════════════════════════════════

    /** Total detection count (all time, confidence-filtered) — overview.
     *  Raw table: full-table VIEW scan is 200× slower and the ~13
     *  rejected entries are 0.001% of 1M — invisible in a total count. */
    totalDetections(c) {
      return ['SELECT COUNT(*) as n FROM detections WHERE Confidence>=?', [(c != null ? c : C())]];
    },

    /** Detection count for a single date — overview */
    countForDate(date, c) {
      return ['SELECT COUNT(*) as n FROM active_detections WHERE Date=? AND Confidence>=?', [date, (c != null ? c : C())]];
    },

    // rareTodayCount — REMOVED. overview.html now uses /api/rare-today
    // (eBird-based) instead of this naive HAVING COUNT(*)<=5 heuristic.
    // Keeping the dead code around would invite accidental reuse.

    // ═══════════════════════════════════════════════════════════
    //  STATS
    // ═══════════════════════════════════════════════════════════

    /** Confidence distribution histogram — stats */
    confidenceHistogram() {
      return [
        "SELECT CAST(CAST(Confidence*10 AS INT) AS TEXT)||'0%' as bucket, CAST(CAST(Confidence*10 AS INT)*10 AS INTEGER) as pct, COUNT(*) as n FROM detections GROUP BY CAST(Confidence*10 AS INT) ORDER BY pct ASC",
        []
      ];
    },

    /** Record highest confidence ever — stats */
    recordConfidence() {
      return ['SELECT Date, Com_Name, Sci_Name, ROUND(Confidence*100,1) as conf FROM detections ORDER BY Confidence DESC LIMIT 1', []];
    },

    // ═══════════════════════════════════════════════════════════
    //  SPECIES PAGE
    // ═══════════════════════════════════════════════════════════

    /** Check if species exists — species page */
    speciesExists(comName, c) {
      // Confidence filter prevents showing species that only have low-confidence detections
      return ['SELECT COUNT(*) as n FROM active_detections WHERE Com_Name=? AND Confidence>=?', [comName, (c != null ? c : C())]];
    },

    // ═══════════════════════════════════════════════════════════
    //  PHENOLOGY (observed, derived from detections only)
    // ═══════════════════════════════════════════════════════════

    /** Distinct years where the species was observed — phenology page */
    phenologyYears(comName, c) {
      return [
        "SELECT DISTINCT CAST(strftime('%Y', Date) AS INTEGER) as year FROM active_detections WHERE Com_Name=? AND Confidence>=? ORDER BY year DESC",
        [comName, (c != null ? c : C())]
      ];
    },

    /** Weekly detection count for a given year — phenology presence/abundance modes */
    phenologyWeekly(comName, year, c) {
      return [
        "SELECT MIN(CAST(strftime('%W', Date) AS INTEGER), 52) as week, COUNT(*) as n FROM active_detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND Confidence>=? GROUP BY week ORDER BY week",
        [comName, String(year), (c != null ? c : C())]
      ];
    },

    /** Average hour of detection per week — phenology hourly mode + dawn chorus inference */
    phenologyHourlyByWeek(comName, year, c) {
      return [
        "SELECT MIN(CAST(strftime('%W', Date) AS INTEGER), 52) as week, ROUND(AVG(CAST(SUBSTR(Time,1,2) AS REAL)),1) as avg_hour, SUM(CASE WHEN CAST(SUBSTR(Time,1,2) AS INTEGER) BETWEEN 4 AND 8 THEN 1 ELSE 0 END) as dawn_n, COUNT(*) as n FROM active_detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND Confidence>=? GROUP BY week ORDER BY week",
        [comName, String(year), (c != null ? c : C())]
      ];
    },

    /** First and last observation dates for a year — phenology arrival/departure */
    phenologyFirstLast(comName, year, c) {
      return [
        "SELECT MIN(Date) as first_date, MAX(Date) as last_date, COUNT(*) as total FROM active_detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND Confidence>=?",
        [comName, String(year), (c != null ? c : C())]
      ];
    },

    /** Aggregate stats for one ISO week of a year — phenology week zoom */
    phenologyWeekDetails(comName, year, week, c) {
      return [
        "SELECT MIN(Date) as date_from, MAX(Date) as date_to, COUNT(*) as n, COUNT(DISTINCT Date) as days, MIN(Time) as first_time, MAX(Time) as last_time, ROUND(AVG(CAST(SUBSTR(Time,1,2) AS REAL)),1) as avg_hour FROM active_detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND CAST(strftime('%W', Date) AS INTEGER)=? AND Confidence>=?",
        [comName, String(year), week, (c != null ? c : C())]
      ];
    },

    /** Hourly histogram for one ISO week of a year — phenology week zoom */
    phenologyWeekHourly(comName, year, week, c) {
      return [
        "SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as h, COUNT(*) as n FROM active_detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND CAST(strftime('%W', Date) AS INTEGER)=? AND Confidence>=? GROUP BY h ORDER BY h",
        [comName, String(year), week, (c != null ? c : C())]
      ];
    },

    /** Top detections by confidence for one ISO week of a year — phenology week zoom */
    phenologyWeekTopDetections(comName, year, week, limit, c) {
      return [
        "SELECT Date, Time, ROUND(Confidence*100,1) as conf, File_Name, Model FROM active_detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND CAST(strftime('%W', Date) AS INTEGER)=? AND Confidence>=? ORDER BY Confidence DESC LIMIT ?",
        [comName, String(year), week, (c != null ? c : C()), limit || 5]
      ];
    },

    /** Same week of previous year — phenology week zoom (year-over-year) */
    phenologyWeekPrevYear(comName, year, week, c) {
      return [
        "SELECT COUNT(*) as n FROM active_detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND CAST(strftime('%W', Date) AS INTEGER)=? AND Confidence>=?",
        [comName, String(parseInt(year) - 1), week, (c != null ? c : C())]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  BIODIVERSITY
    // ═══════════════════════════════════════════════════════════

    /** Top species (all time, for taxonomy) — biodiversity */
    topSpeciesAllTime(limit, c) {
      return [
        'SELECT Com_Name, MAX(Sci_Name) as Sci_Name FROM active_detections WHERE Confidence>=? GROUP BY Com_Name ORDER BY COUNT(*) DESC LIMIT ?',
        [(c != null ? c : C()), limit]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════

    /** Build a parameterized WHERE clause with guaranteed confidence. */
    buildWhere(opts = {}) {
      const c = opts.conf || C();
      const clauses = ['Confidence>=?'];
      const params = [c];
      if (opts.dateFrom) { clauses.push('Date>=?'); params.push(opts.dateFrom); }
      if (opts.dateTo)   { clauses.push('Date<=?'); params.push(opts.dateTo); }
      if (opts.species)  { clauses.push('Com_Name=?'); params.push(opts.species); }
      if (opts.speciesList && opts.speciesList.length) {
        clauses.push('Com_Name IN (' + opts.speciesList.map(() => '?').join(',') + ')');
        params.push(...opts.speciesList);
      }
      if (opts.sciName) { clauses.push('Sci_Name=?'); params.push(opts.sciName); }
      if (opts.extra) { for (const e of opts.extra) clauses.push(e); }
      return { where: clauses.join(' AND '), params };
    },

    /**
     * Try a fast query first (pre-aggregated), fallback to raw if it
     * returns empty (table not yet rebuilt after an upgrade).
     * Usage: const rows = await Q.withFallback(birdQuery, Q.hourlyDistribution(d), Q.hourlyDistributionRaw(d));
     */
    async withFallback(birdQuery, fast, slow) {
      try {
        const rows = await birdQuery(...fast);
        if (rows && rows.length > 0) return rows;
      } catch {}
      return birdQuery(...slow);
    },

    /**
     * Adaptive time-series query — auto-selects resolution based on date range.
     * Returns { sql, params, resolution, labelFn }
     *   resolution: 'hourly' | 'daily' | 'weekly' | 'monthly'
     *   labelFn(row): formats the bucket label for Chart.js
     *
     * @param {string} dateFrom — 'YYYY-MM-DD'
     * @param {string} dateTo   — 'YYYY-MM-DD'
     * @param {number} [conf]   — confidence threshold
     */
    adaptiveTimeSeries(dateFrom, dateTo, conf) {
      const c = conf || C();
      const d0 = new Date(dateFrom + 'T00:00:00');
      const d1 = new Date(dateTo + 'T23:59:59');
      const days = Math.max(1, Math.round((d1 - d0) / 86400000));

      let resolution, selectExpr, groupExpr, orderExpr;

      if (days <= 1) {
        // Hourly: 24 bars
        resolution = 'hourly';
        selectExpr = 'CAST(SUBSTR(Time,1,2) AS INTEGER) as bucket';
        groupExpr  = 'CAST(SUBSTR(Time,1,2) AS INTEGER)';
        orderExpr  = 'bucket ASC';
      } else if (days <= 90) {
        // Daily
        resolution = 'daily';
        selectExpr = 'Date as bucket';
        groupExpr  = 'Date';
        orderExpr  = 'bucket ASC';
      } else if (days <= 365) {
        // Weekly (ISO week approximation via 7-day buckets)
        resolution = 'weekly';
        selectExpr = "Date as bucket";
        groupExpr  = "Date";
        orderExpr  = "bucket ASC";
      } else {
        // Monthly
        resolution = 'monthly';
        selectExpr = 'SUBSTR(Date,1,7) as bucket';
        groupExpr  = 'SUBSTR(Date,1,7)';
        orderExpr  = 'bucket ASC';
      }

      const sql = `SELECT ${selectExpr}, COUNT(*) as det, COUNT(DISTINCT Com_Name) as sp FROM active_detections WHERE Confidence>=? AND Date>=? AND Date<=? GROUP BY ${groupExpr} ORDER BY ${orderExpr}`;
      const params = [c, dateFrom, dateTo];

      // Label formatter for Chart.js
      const monthsShort = null; // will be passed at render time
      const labelFn = function(row, t) {
        const b = String(row.bucket);
        switch(resolution) {
          case 'hourly':  return b + 'h';
          case 'daily': {
            const parts = b.split('-');
            const ms = t ? t('months_short') : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return parseInt(parts[2]) + ' ' + (ms[parseInt(parts[1])-1] || parts[1]);
          }
          case 'weekly': {
            const parts = b.split('-');
            const ms = t ? t('months_short') : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return parseInt(parts[2]) + ' ' + (ms[parseInt(parts[1])-1] || parts[1]);
          }
          case 'monthly': {
            const parts = b.split('-');
            const ms = t ? t('months_short') : ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            return (ms[parseInt(parts[1])-1] || parts[1]) + ' ' + parts[0].slice(2);
          }
          default: return b;
        }
      };

      return { sql, params, resolution, days, labelFn };
    },

    /**
     * Post-process adaptiveTimeSeries results for weekly resolution:
     * aggregate daily rows into 7-day buckets.
     */
    aggregateWeekly(rows) {
      if (!rows.length) return rows;
      const buckets = [];
      let current = null;
      for (const r of rows) {
        const d = new Date(r.bucket + 'T12:00:00');
        const weekStart = new Date(d);
        // Bucket by user's "first day of week" pref (Monday/Sunday).
        const fd = (window.BirdFmt && window.BirdFmt.firstDayOfWeek) ? window.BirdFmt.firstDayOfWeek() : 1;
        weekStart.setDate(d.getDate() - ((d.getDay() - fd + 7) % 7));
        const key = weekStart.toISOString().split('T')[0];
        if (!current || current.bucket !== key) {
          current = { bucket: key, det: 0, sp: 0, _species: new Set() };
          buckets.push(current);
        }
        current.det += r.det;
        // sp is approximate (can't deduplicate across days without raw data)
        current.sp = Math.max(current.sp, r.sp);
      }
      return buckets;
    },

    // ═══════════════════════════════════════════════════════════
    //  ANALYSES — Deep per-species/group analysis
    // ═══════════════════════════════════════════════════════════

    /** IN-clause placeholder helper: returns '?,?,?' for N items */
    _inPh(arr) { return arr.map(() => '?').join(','); },

    /** Resample expression for detection counting modes */
    _resampleExpr(mode) {
      switch (mode) {
        case 'raw':    return 'COUNT(*) as n';
        case 'hourly': return "COUNT(DISTINCT Date || SUBSTR(Time,1,2)) as n";
        case 'daily':  return "COUNT(DISTINCT Date) as n";
        default:       return "COUNT(DISTINCT Date || SUBSTR(Time,1,2) || CAST(CAST(SUBSTR(Time,4,2) AS INTEGER)/15 AS INTEGER)) as n";
      }
    },

    /** Species list with resample count — analyses filter panel */
    analysesSpeciesList(dateFrom, dateTo, resampleMode, c) {
      const expr = Q._resampleExpr(resampleMode);
      return [
        'SELECT Com_Name, MIN(Sci_Name) as Sci_Name, ' + expr + ' FROM detections WHERE Date>=? AND Date<=? AND Confidence>=? GROUP BY Com_Name ORDER BY n DESC',
        [dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Aggregate KPIs for a set of species (by sci name) */
    analysesKpis(sciNames, dateFrom, dateTo, c) {
      const ph = Q._inPh(sciNames);
      return [
        'SELECT COUNT(*) as total, ROUND(AVG(Confidence)*100,1) as avg_conf, COUNT(DISTINCT Com_Name) as sp_count, COUNT(DISTINCT Date) as days FROM detections WHERE Sci_Name IN (' + ph + ') AND Date>=? AND Date<=? AND Confidence>=?',
        [...sciNames, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Resample count for species (single-species KPI) */
    analysesResampleCount(sciNames, dateFrom, dateTo, resampleMode, c) {
      const ph = Q._inPh(sciNames);
      const expr = Q._resampleExpr(resampleMode);
      return [
        'SELECT ' + expr + ' FROM detections WHERE Sci_Name IN (' + ph + ') AND Date>=? AND Date<=? AND Confidence>=?',
        [...sciNames, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Per-species breakdown (multi-species analysis) */
    analysesBreakdown(sciNames, dateFrom, dateTo, c) {
      const ph = Q._inPh(sciNames);
      return [
        'SELECT Com_Name, Sci_Name, COUNT(*) as count, ROUND(AVG(Confidence)*100,0) as avg_conf FROM detections WHERE Sci_Name IN (' + ph + ') AND Date>=? AND Date<=? AND Confidence>=? GROUP BY Com_Name ORDER BY count DESC',
        [...sciNames, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Hourly distribution for species group (polar chart) */
    analysesHourly(sciNames, dateFrom, dateTo, c) {
      const ph = Q._inPh(sciNames);
      return [
        'SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as h, COUNT(*) as n FROM detections WHERE Sci_Name IN (' + ph + ') AND Date>=? AND Date<=? AND Confidence>=? GROUP BY h ORDER BY h ASC',
        [...sciNames, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Quarter-hourly distribution (peak analysis) */
    analysesQuarterHourly(sciNames, dateFrom, dateTo, c) {
      const ph = Q._inPh(sciNames);
      return [
        'SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as h, CAST(CAST(SUBSTR(Time,4,2) AS INTEGER)/15 AS INTEGER)*15 as m, COUNT(*) as n FROM detections WHERE Sci_Name IN (' + ph + ') AND Date>=? AND Date<=? AND Confidence>=? GROUP BY h, m ORDER BY n DESC',
        [...sciNames, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Quarter breakdown for a specific hour (polar detail click) */
    analysesHourQuarters(comName, dateFrom, dateTo, hour, c) {
      return [
        'SELECT CAST(CAST(SUBSTR(Time,4,2) AS INTEGER)/15 AS INTEGER)*15 as m, COUNT(*) as n FROM detections WHERE Com_Name=? AND Date>=? AND Date<=? AND Confidence>=? AND CAST(SUBSTR(Time,1,2) AS INTEGER)=? GROUP BY m ORDER BY m ASC',
        [comName, dateFrom, dateTo, (c != null ? c : C()), hour]
      ];
    },

    /** Top detections for a specific hour (polar detail) */
    analysesHourTopDetections(comName, dateFrom, dateTo, hour, limit, c) {
      return [
        'SELECT Time, Confidence, File_Name FROM detections WHERE Com_Name=? AND Date>=? AND Date<=? AND Confidence>=? AND CAST(SUBSTR(Time,1,2) AS INTEGER)=? ORDER BY Confidence DESC LIMIT ?',
        [comName, dateFrom, dateTo, (c != null ? c : C()), hour, limit || 5]
      ];
    },

    /** Daily counts for a species group (series chart) */
    analysesDailyByGroup(sciNames, dateFrom, dateTo, c) {
      const ph = Q._inPh(sciNames);
      return [
        'SELECT Date, COUNT(*) as n FROM detections WHERE Sci_Name IN (' + ph + ') AND Date>=? AND Date<=? AND Confidence>=? GROUP BY Date ORDER BY Date ASC',
        [...sciNames, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Monthly counts for a species group (series chart) */
    analysesMonthlyByGroup(sciNames, dateFrom, dateTo, c) {
      const ph = Q._inPh(sciNames);
      return [
        'SELECT SUBSTR(Date,1,7) as ym, COUNT(*) as n FROM detections WHERE Sci_Name IN (' + ph + ') AND Date>=? AND Date<=? AND Confidence>=? GROUP BY ym ORDER BY ym ASC',
        [...sciNames, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Daily counts for a single species (series chart) */
    analysesDailySingle(comName, dateFrom, dateTo, c) {
      return [
        'SELECT Date, COUNT(*) as n FROM detections WHERE Com_Name=? AND Date>=? AND Date<=? AND Confidence>=? GROUP BY Date ORDER BY Date ASC',
        [comName, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Monthly counts for a single species (series chart) */
    analysesMonthlySingle(comName, dateFrom, dateTo, c) {
      return [
        'SELECT SUBSTR(Date,1,7) as ym, COUNT(*) as n FROM detections WHERE Com_Name=? AND Date>=? AND Date<=? AND Confidence>=? GROUP BY ym ORDER BY ym ASC',
        [comName, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Hourly distribution for a single species (circadian chart) */
    analysesCircadian(comName, dateFrom, dateTo, c) {
      return [
        'SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as hour, COUNT(*) as n FROM detections WHERE Com_Name=? AND Date BETWEEN ? AND ? AND Confidence>=? GROUP BY hour',
        [comName, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** 6-hourly heatmap slots (daily heatmap) */
    analysesHeatmapSlots(sciNames, dateFrom, dateTo, c) {
      const ph = Q._inPh(sciNames);
      return [
        'SELECT Date, CAST(SUBSTR(Time,1,2) AS INTEGER)*4+CAST(CAST(SUBSTR(Time,4,2) AS INTEGER)/15 AS INTEGER) as slot, COUNT(*) as n FROM detections WHERE Sci_Name IN (' + ph + ') AND Date>=? AND Date<=? AND Confidence>=? GROUP BY Date, slot ORDER BY Date ASC, slot ASC',
        [...sciNames, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** CSV export of detections for species group */
    analysesExport(sciNames, dateFrom, dateTo, limit, c) {
      const ph = Q._inPh(sciNames);
      return [
        'SELECT Date, Time, Com_Name, Sci_Name, ROUND(Confidence*100,1) as Confidence FROM detections WHERE Sci_Name IN (' + ph + ') AND Date>=? AND Date<=? AND Confidence>=? ORDER BY Date DESC, Time DESC LIMIT ?',
        [...sciNames, dateFrom, dateTo, (c != null ? c : C()), limit || 10000]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  COMPARE (species disambiguation page)
    // ═══════════════════════════════════════════════════════════

    /** Identity card for one species over a date range — compare page */
    compareIdentity(sciName, dateFrom, dateTo, c) {
      return [
        'SELECT MAX(Com_Name) as com_name, COUNT(*) as total, MIN(Date) as first_date, MAX(Date) as last_date, COUNT(DISTINCT Date) as active_days, ROUND(AVG(Confidence),3) as avg_conf, ROUND(MIN(Confidence),3) as min_conf, ROUND(MAX(Confidence),3) as max_conf FROM detections WHERE Sci_Name=? AND Date BETWEEN ? AND ? AND Confidence>=?',
        [sciName, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** 24-hour distribution for a species over a date range — compare page */
    compareHourlyProfile(sciName, dateFrom, dateTo, c) {
      return [
        'SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as h, COUNT(*) as n FROM detections WHERE Sci_Name=? AND Date BETWEEN ? AND ? AND Confidence>=? GROUP BY h ORDER BY h ASC',
        [sciName, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Weekly phenology for a species over a date range — compare page */
    compareWeeklyPhenology(sciName, dateFrom, dateTo, c) {
      return [
        "SELECT MIN(CAST(strftime('%W', Date) AS INTEGER), 52) as week, COUNT(*) as n FROM detections WHERE Sci_Name=? AND Date BETWEEN ? AND ? AND Confidence>=? GROUP BY week ORDER BY week ASC",
        [sciName, dateFrom, dateTo, (c != null ? c : C())]
      ];
    },

    /** Confidence histogram (18 bins of 0.05) for a species — compare page */
    compareConfidenceHist(sciName, dateFrom, dateTo, c) {
      return [
        'SELECT CAST((Confidence - 0.10) / 0.05 AS INTEGER) as bin, COUNT(*) as n FROM detections WHERE Sci_Name=? AND Date BETWEEN ? AND ? AND Confidence>=0.10 GROUP BY bin ORDER BY bin ASC',
        [sciName, dateFrom, dateTo]
      ];
    },

  };

  window.BIRDASH_QUERIES = Q;

})(BIRD_CONFIG);
