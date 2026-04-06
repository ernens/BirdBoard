/**
 * bird-queries.js — Shared SQL query library for Birdash
 *
 * All common queries in one place to ensure consistent confidence
 * filtering and avoid copy-paste drift between pages.
 *
 * Usage:  const Q = BIRDASH_QUERIES;
 *         const rows = await birdQuery(...Q.todayStats('2026-04-06'));
 *
 * Each function returns [sql, params] ready for birdQuery(sql, params).
 * Confidence threshold comes from BIRD_CONFIG.defaultConfidence (0.7).
 */
(function (config) {
  'use strict';

  const conf = () => config.defaultConfidence || 0.7;

  const Q = {

    // ── Day stats: total detections + unique species ──────────
    // Used by: dashboard, today, overview
    todayStats(date) {
      return [
        'SELECT COUNT(*) as total, COUNT(DISTINCT Com_Name) as species FROM detections WHERE Date=? AND Confidence>=?',
        [date, conf()]
      ];
    },

    // ── Latest N detections (most recent first) ──────────────
    // Used by: dashboard, overview, recent
    latestDetections(n = 1) {
      return [
        'SELECT Date, Time, Sci_Name, Com_Name, Confidence, Model, File_Name FROM detections WHERE Confidence>=? ORDER BY Date DESC, Time DESC LIMIT ?',
        [conf(), n]
      ];
    },

    // ── Species list for a date (grouped, with count + last time) ──
    // Used by: dashboard (recent species), today, calendar
    speciesByDate(date, limit = 100) {
      return [
        'SELECT Com_Name, Sci_Name, COUNT(*) as n, MAX(Time) as last_time FROM detections WHERE Date=? AND Confidence>=? GROUP BY Sci_Name ORDER BY last_time DESC LIMIT ?',
        [date, conf(), limit]
      ];
    },

    // ── Species list for a date (sorted by count desc) ───────
    // Used by: today (species ranking)
    speciesByDateRanked(date) {
      return [
        'SELECT Com_Name, MAX(Sci_Name) as Sci_Name, COUNT(*) as n, ROUND(MAX(Confidence)*100,1) as max_conf, ROUND(AVG(Confidence)*100,1) as avg_conf FROM detections WHERE Date=? AND Confidence>=? GROUP BY Com_Name ORDER BY n DESC',
        [date, conf()]
      ];
    },

    // ── First observation date per species ────────────────────
    // Used by: today, calendar, recent (new species badge)
    firstObservations() {
      return [
        'SELECT Com_Name, MIN(Date) as first_date FROM detections WHERE Confidence>=? GROUP BY Com_Name',
        [conf()]
      ];
    },

    // ── Species count for a specific day (just the number) ───
    // Used by: today (sub-count), calendar
    speciesCountForDate(date) {
      return [
        'SELECT COUNT(*) as n FROM detections WHERE Date=? AND Confidence>=?',
        [date, conf()]
      ];
    },

    // ── New species for a date (first seen = that date) ──────
    // Used by: today (new species filter)
    newSpeciesForDate(date) {
      return [
        'SELECT Com_Name FROM detections WHERE Confidence>=? GROUP BY Com_Name HAVING MIN(Date)=?',
        [conf(), date]
      ];
    },

    // ── Detections for a species on a date ────────────────────
    // Used by: today, calendar, species
    detectionsForSpecies(date, comName) {
      return [
        'SELECT Time, Confidence, File_Name, Model FROM detections WHERE Date=? AND Com_Name=? AND Confidence>=? ORDER BY Time DESC',
        [date, comName, conf()]
      ];
    },

    // ── Date range stats (total, species, days) ──────────────
    // Used by: stats, analyses, biodiversity
    dateRangeStats(dateFrom, dateTo) {
      return [
        'SELECT COUNT(*) as total, COUNT(DISTINCT Com_Name) as species, COUNT(DISTINCT Date) as days FROM detections WHERE Date>=? AND Date<=? AND Confidence>=?',
        [dateFrom, dateTo, conf()]
      ];
    },

    // ── Species aggregation for date range ────────────────────
    // Used by: stats, analyses, biodiversity
    speciesByDateRange(dateFrom, dateTo) {
      return [
        'SELECT Com_Name, MIN(Sci_Name) as Sci_Name, COUNT(*) as n FROM detections WHERE Date>=? AND Date<=? AND Confidence>=? GROUP BY Com_Name ORDER BY n DESC',
        [dateFrom, dateTo, conf()]
      ];
    },

    // ── Hourly distribution ──────────────────────────────────
    // Used by: today, overview, analyses
    hourlyDistribution(date) {
      return [
        "SELECT CAST(SUBSTR(Time,1,2) AS INTEGER) as h, COUNT(*) as n FROM detections WHERE Date=? AND Confidence>=? GROUP BY h",
        [date, conf()]
      ];
    },

    // ── All distinct species names ───────────────────────────
    // Used by: detections filter, species page
    allSpeciesNames() {
      return [
        'SELECT DISTINCT Com_Name, MAX(Sci_Name) as Sci_Name FROM detections GROUP BY Com_Name ORDER BY Com_Name ASC',
        []
      ];
    },

    // ── Helper: current confidence threshold ─────────────────
    confidence() {
      return conf();
    },
  };

  // Expose globally
  window.BIRDASH_QUERIES = Q;

})(BIRD_CONFIG);
