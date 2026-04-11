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

    /** All distinct species names — detections, species, filters */
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
        'SELECT Com_Name, MAX(Sci_Name) as Sci_Name, COUNT(*) as n FROM detections WHERE Confidence >= ? GROUP BY Com_Name ORDER BY n DESC, Com_Name ASC',
        [c || C()]
      ];
    },

    /** All distinct common names only — detections filter */
    allCommonNames() {
      return ['SELECT DISTINCT Com_Name FROM detections ORDER BY Com_Name ASC', []];
    },

    /** First observation date per species — today, calendar, recent, gallery */
    firstObservations(c) {
      return ['SELECT Com_Name, MIN(Date) as first_date FROM detections WHERE Confidence>=? GROUP BY Com_Name', [c || C()]];
    },

    /** Species first seen on a specific date — today, calendar, recent */
    newSpeciesForDate(date, c) {
      return ['SELECT Com_Name FROM detections WHERE Confidence>=? GROUP BY Com_Name HAVING MIN(Date)=?', [c || C(), date]];
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
      return ['SELECT COUNT(*) as total, COUNT(DISTINCT Com_Name) as species FROM detections WHERE Date=? AND Confidence>=?', [date, c || C()]];
    },

    /** Extended day stats with avg confidence — today, calendar, recent */
    todayStatsExtended(date, c) {
      return [
        'SELECT COUNT(*) as n, COUNT(DISTINCT Com_Name) as sp, ROUND(AVG(Confidence)*100,1) as conf, MAX(Date) as last_date, MAX(Time) as last_time FROM detections WHERE Date=? AND Confidence>=?',
        [date, c || C()]
      ];
    },

    /** Last hour detection count — today, calendar, recent, overview */
    lastHourCount(date, c) {
      return [
        "SELECT COUNT(*) as n FROM detections WHERE Date=? AND Confidence>=? AND Time>=time('now','-1 hour','localtime')",
        [date, c || C()]
      ];
    },

    /**
     * Latest N detections — dashboard, overview, species.
     * Deduplicates same-clip same-species across models (BirdNET + Perch),
     * keeping the highest-confidence row via SQLite bare-column MAX trick.
     */
    latestDetections(n = 1, c) {
      return [
        'SELECT Date, Time, Sci_Name, Com_Name, MAX(Confidence) as Confidence, Model, File_Name FROM detections WHERE Confidence>=? GROUP BY Date, Time, Com_Name ORDER BY Date DESC, Time DESC LIMIT ?',
        [c || C(), n]
      ];
    },

    /** Latest detection (unfiltered) — overview */
    latestDetectionRaw() {
      return ['SELECT Date, Time, Com_Name, Sci_Name, Confidence, File_Name, Model FROM detections ORDER BY Date DESC, Time DESC LIMIT 1', []];
    },

    // ═══════════════════════════════════════════════════════════
    //  SPECIES BY DATE / RANGE
    // ═══════════════════════════════════════════════════════════

    /** Species grouped for a date (by last time desc) — dashboard */
    speciesByDate(date, limit = 100, c) {
      return [
        'SELECT Com_Name, Sci_Name, COUNT(*) as n, MAX(Time) as last_time FROM detections WHERE Date=? AND Confidence>=? GROUP BY Sci_Name ORDER BY last_time DESC LIMIT ?',
        [date, c || C(), limit]
      ];
    },

    /** Species ranked by count for a date — today, calendar, recent */
    speciesByDateRanked(date, c) {
      return [
        'SELECT Com_Name, MAX(Sci_Name) as Sci_Name, COUNT(*) as n, ROUND(MAX(Confidence)*100,1) as max_conf, ROUND(AVG(Confidence)*100,1) as avg_conf FROM detections WHERE Date=? AND Confidence>=? GROUP BY Com_Name ORDER BY n DESC',
        [date, c || C()]
      ];
    },

    /** Species for a date range — stats, analyses, biodiversity */
    speciesByDateRange(dateFrom, dateTo, c) {
      return [
        'SELECT Com_Name, MIN(Sci_Name) as Sci_Name, COUNT(*) as n FROM detections WHERE Date>=? AND Date<=? AND Confidence>=? GROUP BY Com_Name ORDER BY n DESC',
        [dateFrom, dateTo, c || C()]
      ];
    },

    /** Top species for a date range with limit — overview */
    topSpecies(dateFrom, limit, c) {
      return [
        'SELECT Com_Name, Sci_Name, COUNT(*) as n FROM detections WHERE Date>=? AND Confidence>=? GROUP BY Com_Name, Sci_Name ORDER BY n DESC LIMIT ?',
        [dateFrom, c || C(), limit]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  DETECTIONS DETAIL
    // ═══════════════════════════════════════════════════════════

    /** Detections for a species on a date — today, calendar, recent */
    detectionsForSpecies(date, comName, c) {
      return [
        'SELECT Time, Confidence, File_Name, Model FROM detections WHERE Date=? AND Com_Name=? AND Confidence>=? ORDER BY Time DESC',
        [date, comName, c || C()]
      ];
    },

    /** All detections of a species (latest first) — species page */
    speciesDetections(comName, limit = 15) {
      return [
        'SELECT Date, Time, Confidence, File_Name, Model FROM detections WHERE Com_Name=? ORDER BY Date DESC, Time DESC LIMIT ?',
        [comName, limit]
      ];
    },

    /** Filtered detections with dynamic WHERE — detections page */
    filteredDetections(where, params, limit = 10000) {
      return [
        `SELECT Date, Time, Com_Name, Sci_Name, ROUND(Confidence*100,1) as Confidence, File_Name, Model FROM detections WHERE ${where} ORDER BY Date DESC, Time DESC LIMIT ?`,
        [...params, limit]
      ];
    },

    /** Filtered detection count — detections page */
    filteredCount(where, params) {
      return [`SELECT COUNT(*) as n FROM detections WHERE ${where}`, params];
    },

    // ═══════════════════════════════════════════════════════════
    //  HOURLY / TEMPORAL DISTRIBUTION
    // ═══════════════════════════════════════════════════════════

    /** Hourly distribution for a date — today, overview */
    hourlyDistribution(date, c) {
      return [
        "SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as h, COUNT(*) as n FROM detections WHERE Date=? AND Confidence>=? GROUP BY h",
        [date, c || C()]
      ];
    },

    /** Hourly distribution for a species — species page */
    hourlyBySpecies(comName) {
      return [
        "SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as h, COUNT(*) as n FROM detections WHERE Com_Name=? GROUP BY h ORDER BY h ASC",
        [comName]
      ];
    },

    /** Monthly distribution for a species — species page */
    monthlyBySpecies(comName) {
      return [
        "SELECT CAST(SUBSTR(Date,6,2) AS INTEGER) as m, COUNT(*) as n FROM detections WHERE Com_Name=? GROUP BY m ORDER BY m ASC",
        [comName]
      ];
    },

    /** Daily count for a species in a date range — species page */
    dailyBySpecies(comName, dateFrom) {
      return [
        "SELECT Date, COUNT(*) as n FROM detections WHERE Com_Name=? AND Date>=? GROUP BY Date ORDER BY Date ASC",
        [comName, dateFrom]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  OVERVIEW
    // ═══════════════════════════════════════════════════════════

    /** Total detection count (all time) — overview */
    totalDetections() {
      return ['SELECT COUNT(*) as n FROM detections', []];
    },

    /** Detection count for a single date (unfiltered) — overview */
    countForDate(date) {
      return ['SELECT COUNT(*) as n FROM detections WHERE Date=?', [date]];
    },

    /** Daily detections+species for date range — overview chart */
    dailyStats(dateFrom, dateTo) {
      return [
        'SELECT Date, COUNT(*) as n, COUNT(DISTINCT Com_Name) as sp FROM detections WHERE Date>=? AND Date<=? GROUP BY Date ORDER BY Date ASC',
        [dateFrom, dateTo]
      ];
    },

    /** Rare species count for today — overview */
    rareTodayCount(date) {
      return [
        'WITH today_sp AS (SELECT DISTINCT Com_Name FROM detections WHERE Date=?), rare_sp AS (SELECT Com_Name FROM detections GROUP BY Com_Name HAVING COUNT(*)<=5) SELECT COUNT(*) as n FROM today_sp INNER JOIN rare_sp USING(Com_Name)',
        [date]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  STATS
    // ═══════════════════════════════════════════════════════════

    /** Global stats with date filter — stats page */
    globalStats(where, c) {
      return [
        `SELECT COUNT(*) as total, COUNT(DISTINCT Com_Name) as sp, ROUND(AVG(Confidence)*100,1) as avg_conf, ROUND(MAX(Confidence)*100,1) as max_conf, MIN(Date) as first, MAX(Date) as last FROM detections WHERE ${where}`,
        [c || C()]
      ];
    },

    /** Average detections per day — stats */
    avgPerDay(where, c) {
      return [
        `SELECT ROUND(AVG(n),0) as avg FROM (SELECT COUNT(*) as n FROM detections WHERE ${where} GROUP BY Date)`,
        [c || C()]
      ];
    },

    /** Monthly trend — stats */
    monthlyTrend(where, c) {
      return [
        `SELECT SUBSTR(Date,1,7) as ym, COUNT(*) as det, COUNT(DISTINCT Com_Name) as sp FROM detections WHERE ${where} GROUP BY ym ORDER BY ym ASC`,
        [c || C()]
      ];
    },

    /** Yearly trend — stats */
    yearlyTrend(where, c) {
      return [
        `SELECT SUBSTR(Date,1,4) as year, COUNT(*) as det, COUNT(DISTINCT Com_Name) as sp FROM detections WHERE ${where} GROUP BY year ORDER BY year ASC`,
        [c || C()]
      ];
    },

    /** Top N species by count — stats */
    topSpeciesByCount(where, limit, c) {
      return [
        `SELECT Com_Name, Sci_Name, COUNT(*) as n FROM detections WHERE ${where} GROUP BY Com_Name, Sci_Name ORDER BY n DESC LIMIT ?`,
        [c || C(), limit]
      ];
    },

    /** Top species by confidence — stats */
    topSpeciesByConfidence(where, limit, c) {
      return [
        `SELECT Com_Name, Sci_Name, ROUND(AVG(Confidence)*100,1) as avg_conf FROM detections WHERE ${where} GROUP BY Com_Name, Sci_Name HAVING COUNT(*)>=10 ORDER BY avg_conf DESC LIMIT ?`,
        [c || C(), limit]
      ];
    },

    /** Confidence distribution histogram — stats */
    confidenceHistogram() {
      return [
        "SELECT CAST(CAST(Confidence*10 AS INT) AS TEXT)||'0%' as bucket, CAST(CAST(Confidence*10 AS INT)*10 AS INTEGER) as pct, COUNT(*) as n FROM detections GROUP BY CAST(Confidence*10 AS INT) ORDER BY pct ASC",
        []
      ];
    },

    /** Record day (most detections) — stats */
    recordDay(where, c) {
      return [`SELECT Date, COUNT(*) as n FROM detections WHERE ${where} GROUP BY Date ORDER BY n DESC LIMIT 1`, [c || C()]];
    },

    /** Record day by species count — stats */
    recordDaySpecies(where, c) {
      return [`SELECT Date, COUNT(DISTINCT Com_Name) as n FROM detections WHERE ${where} GROUP BY Date ORDER BY n DESC LIMIT 1`, [c || C()]];
    },

    /** Record highest confidence ever — stats */
    recordConfidence() {
      return ['SELECT Date, Com_Name, Sci_Name, ROUND(Confidence*100,1) as conf FROM detections ORDER BY Confidence DESC LIMIT 1', []];
    },

    /** Full species catalog — stats */
    speciesCatalog(where, c) {
      return [
        `SELECT Com_Name, Sci_Name, COUNT(*) as n, ROUND(AVG(Confidence)*100,1) as avg_conf, MIN(Date) as first_date, MAX(Date) as last_date, COUNT(DISTINCT Date) as days FROM detections WHERE ${where} GROUP BY Com_Name, Sci_Name ORDER BY n DESC`,
        [c || C()]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  SPECIES PAGE
    // ═══════════════════════════════════════════════════════════

    /** Species stats summary — species page header */
    speciesStats(comName) {
      return [
        'SELECT COUNT(*) as total, COUNT(DISTINCT Date) as days, ROUND(AVG(Confidence)*100,1) as avg_conf, ROUND(MAX(Confidence)*100,1) as max_conf, MIN(Date) as first_date, MAX(Date) as last_date FROM detections WHERE Com_Name=?',
        [comName]
      ];
    },

    /** Species year-over-year monthly data — species page */
    speciesYearMonth(comName) {
      return [
        "SELECT SUBSTR(Date,1,4) as year, CAST(SUBSTR(Date,6,2) AS INTEGER) as month, COUNT(*) as n FROM detections WHERE Com_Name=? GROUP BY year, month ORDER BY year ASC, month ASC",
        [comName]
      ];
    },

    /** Check if species exists — species page */
    speciesExists(comName) {
      return ['SELECT COUNT(*) as n FROM detections WHERE Com_Name=?', [comName]];
    },

    // ═══════════════════════════════════════════════════════════
    //  PHENOLOGY (observed, derived from detections only)
    // ═══════════════════════════════════════════════════════════

    /** Distinct years where the species was observed — phenology page */
    phenologyYears(comName, c) {
      return [
        "SELECT DISTINCT CAST(strftime('%Y', Date) AS INTEGER) as year FROM detections WHERE Com_Name=? AND Confidence>=? ORDER BY year DESC",
        [comName, c || C()]
      ];
    },

    /** Weekly detection count for a given year — phenology presence/abundance modes */
    phenologyWeekly(comName, year, c) {
      return [
        "SELECT CAST(strftime('%W', Date) AS INTEGER) as week, COUNT(*) as n FROM detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND Confidence>=? GROUP BY week ORDER BY week",
        [comName, String(year), c || C()]
      ];
    },

    /** Average hour of detection per week — phenology hourly mode + dawn chorus inference */
    phenologyHourlyByWeek(comName, year, c) {
      return [
        "SELECT CAST(strftime('%W', Date) AS INTEGER) as week, ROUND(AVG(CAST(SUBSTR(Time,1,2) AS REAL)),1) as avg_hour, SUM(CASE WHEN CAST(SUBSTR(Time,1,2) AS INTEGER) BETWEEN 4 AND 8 THEN 1 ELSE 0 END) as dawn_n, COUNT(*) as n FROM detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND Confidence>=? GROUP BY week ORDER BY week",
        [comName, String(year), c || C()]
      ];
    },

    /** First and last observation dates for a year — phenology arrival/departure */
    phenologyFirstLast(comName, year, c) {
      return [
        "SELECT MIN(Date) as first_date, MAX(Date) as last_date, COUNT(*) as total FROM detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND Confidence>=?",
        [comName, String(year), c || C()]
      ];
    },

    /** Aggregate stats for one ISO week of a year — phenology week zoom */
    phenologyWeekDetails(comName, year, week, c) {
      return [
        "SELECT MIN(Date) as date_from, MAX(Date) as date_to, COUNT(*) as n, COUNT(DISTINCT Date) as days, MIN(Time) as first_time, MAX(Time) as last_time, ROUND(AVG(CAST(SUBSTR(Time,1,2) AS REAL)),1) as avg_hour FROM detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND CAST(strftime('%W', Date) AS INTEGER)=? AND Confidence>=?",
        [comName, String(year), week, c || C()]
      ];
    },

    /** Hourly histogram for one ISO week of a year — phenology week zoom */
    phenologyWeekHourly(comName, year, week, c) {
      return [
        "SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as h, COUNT(*) as n FROM detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND CAST(strftime('%W', Date) AS INTEGER)=? AND Confidence>=? GROUP BY h ORDER BY h",
        [comName, String(year), week, c || C()]
      ];
    },

    /** Top detections by confidence for one ISO week of a year — phenology week zoom */
    phenologyWeekTopDetections(comName, year, week, limit, c) {
      return [
        "SELECT Date, Time, ROUND(Confidence*100,1) as conf, File_Name, Model FROM detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND CAST(strftime('%W', Date) AS INTEGER)=? AND Confidence>=? ORDER BY Confidence DESC LIMIT ?",
        [comName, String(year), week, c || C(), limit || 5]
      ];
    },

    /** Same week of previous year — phenology week zoom (year-over-year) */
    phenologyWeekPrevYear(comName, year, week, c) {
      return [
        "SELECT COUNT(*) as n FROM detections WHERE Com_Name=? AND strftime('%Y', Date)=? AND CAST(strftime('%W', Date) AS INTEGER)=? AND Confidence>=?",
        [comName, String(parseInt(year) - 1), week, c || C()]
      ];
    },

    /** Multi-year weekly counts for the same species — phenology multi-year overlay */
    phenologyMultiYear(comName, c) {
      return [
        "SELECT CAST(strftime('%Y', Date) AS INTEGER) as year, CAST(strftime('%W', Date) AS INTEGER) as week, COUNT(*) as n FROM detections WHERE Com_Name=? AND Confidence>=? GROUP BY year, week ORDER BY year, week",
        [comName, c || C()]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  BIODIVERSITY
    // ═══════════════════════════════════════════════════════════

    /** Species by date range for biodiversity — biodiversity */
    biodiversitySpecies(dateFrom, dateTo, c) {
      return [
        'SELECT Com_Name, COUNT(*) as n FROM detections WHERE Date>=? AND Date<=? AND Confidence>=? GROUP BY Com_Name',
        [dateFrom, dateTo, c || C()]
      ];
    },

    /** Phenology: first/last seen per year — biodiversity */
    phenologyByYear(c) {
      return [
        "SELECT Sci_Name, Com_Name, strftime('%Y', Date) as year, MIN(Date) as first_seen, MAX(Date) as last_seen, COUNT(*) as cnt FROM detections WHERE Confidence>=? GROUP BY Sci_Name, year ORDER BY first_seen",
        [c || C()]
      ];
    },

    /** Top species (all time, for taxonomy) — biodiversity */
    topSpeciesAllTime(limit, c) {
      return [
        'SELECT Com_Name, MAX(Sci_Name) as Sci_Name FROM detections WHERE Confidence>=? GROUP BY Com_Name ORDER BY COUNT(*) DESC LIMIT ?',
        [c || C(), limit]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  ANALYSES
    // ═══════════════════════════════════════════════════════════

    /** Species by date range with custom expression — analyses */
    analysesSpecies(expr, dateFrom, dateTo, c) {
      return [
        `SELECT Com_Name, MIN(Sci_Name) as Sci_Name, ${expr} FROM detections WHERE Date>=? AND Date<=? AND Confidence>=? GROUP BY Com_Name ORDER BY n DESC`,
        [dateFrom, dateTo, c || C()]
      ];
    },

    /** Multi-species aggregate stats — analyses */
    analysesMultiStats(placeholders, sciNames, dateFrom, dateTo, c) {
      return [
        `SELECT COUNT(*) as total, ROUND(AVG(Confidence)*100,1) as avg_conf, COUNT(DISTINCT Com_Name) as sp_count, COUNT(DISTINCT Date) as days FROM detections WHERE Sci_Name IN (${placeholders}) AND Date>=? AND Date<=? AND Confidence>=?`,
        [...sciNames, dateFrom, dateTo, c || C()]
      ];
    },

    /** Daily counts for species IN list — analyses */
    dailyForSpecies(placeholders, sciNames, dateFrom, dateTo, c) {
      return [
        `SELECT Date, COUNT(*) as n FROM detections WHERE Sci_Name IN (${placeholders}) AND Date>=? AND Date<=? AND Confidence>=? GROUP BY Date ORDER BY Date ASC`,
        [...sciNames, dateFrom, dateTo, c || C()]
      ];
    },

    /** Monthly counts for species IN list — analyses */
    monthlyForSpecies(placeholders, sciNames, dateFrom, dateTo, c) {
      return [
        `SELECT SUBSTR(Date,1,7) as ym, COUNT(*) as n FROM detections WHERE Sci_Name IN (${placeholders}) AND Date>=? AND Date<=? AND Confidence>=? GROUP BY ym ORDER BY ym ASC`,
        [...sciNames, dateFrom, dateTo, c || C()]
      ];
    },

    /** Daily counts for single species — analyses */
    dailyForOneSpecies(comName, dateFrom, dateTo, c) {
      return [
        'SELECT Date, COUNT(*) as n FROM detections WHERE Com_Name=? AND Date>=? AND Date<=? AND Confidence>=? GROUP BY Date ORDER BY Date ASC',
        [comName, dateFrom, dateTo, c || C()]
      ];
    },

    /** Monthly counts for single species — analyses */
    monthlyForOneSpecies(comName, dateFrom, dateTo, c) {
      return [
        'SELECT SUBSTR(Date,1,7) as ym, COUNT(*) as n FROM detections WHERE Com_Name=? AND Date>=? AND Date<=? AND Confidence>=? GROUP BY ym ORDER BY ym ASC',
        [comName, dateFrom, dateTo, c || C()]
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  GALLERY
    // ═══════════════════════════════════════════════════════════

    /** Best recordings with ROW_NUMBER — gallery */
    bestRecordings(where, params) {
      return [
        `SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY Com_Name ORDER BY Confidence DESC) AS rn FROM detections WHERE ${where}) WHERE rn=1 ORDER BY Confidence DESC`,
        params
      ];
    },

    // ═══════════════════════════════════════════════════════════
    //  RARITIES
    // ═══════════════════════════════════════════════════════════

    /** Total distinct species — rarities */
    totalSpeciesCount(where, c) {
      return [`SELECT COUNT(DISTINCT Com_Name) as n FROM detections WHERE Confidence>=?${where ? ' AND ' + where : ''}`, [c || C()]];
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

    /** Shorthand: SELECT ... FROM detections WHERE {buildWhere} [suffix]. */
    query(select, opts = {}, suffix = '') {
      const { where, params } = Q.buildWhere(opts);
      return [select + ' ' + where + (suffix ? ' ' + suffix : ''), params];
    },

    /** Current confidence threshold. */
    confidence() { return C(); },

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

      const sql = `SELECT ${selectExpr}, COUNT(*) as det, COUNT(DISTINCT Com_Name) as sp FROM detections WHERE Confidence>=? AND Date>=? AND Date<=? GROUP BY ${groupExpr} ORDER BY ${orderExpr}`;
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
        weekStart.setDate(d.getDate() - d.getDay() + 1); // Monday
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
  };

  window.BIRDASH_QUERIES = Q;

})(BIRD_CONFIG);
