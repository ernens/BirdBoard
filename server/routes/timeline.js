'use strict';
/**
 * Timeline route — /api/timeline
 * Complex route computing daily detection timelines with astronomy data.
 * Extracted from server.js for modularity.
 */
const path = require('path');
const fs = require('fs');
const SunCalc = require('suncalc');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

let _timelineCache = {};
let _timelineCacheTs = {};

const TIMELINE_TTL_TODAY = 2 * 60 * 1000;  // 2 min for today
const TIMELINE_TTL_PAST  = 60 * 60 * 1000; // 60 min for past dates

function handle(req, res, pathname, ctx) {
  const { db, birdashDb, parseBirdnetConf, SONGS_DIR, readJsonFile, JSON_CT } = ctx;

  // ══════════════════════════════════════════════════════════════════════════════
  // ── Route : GET /api/timeline?date=YYYY-MM-DD ─────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════════
  if (req.method === 'GET' && pathname === '/api/timeline') {
    (async () => {
      try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
        const dateStr = params.get('date') || todayStr;
        const isToday = dateStr === todayStr;
        const minConf = parseFloat(params.get('minConf') || '0.7');
        const maxEvents = Math.min(999, parseInt(params.get('maxEvents') || '8'));

        // ── Cache check ──
        const cacheKey = `${dateStr}_${minConf}_${maxEvents}`;
        const ttl = isToday ? TIMELINE_TTL_TODAY : TIMELINE_TTL_PAST;
        if (_timelineCache[cacheKey] && (Date.now() - (_timelineCacheTs[cacheKey] || 0)) < ttl) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(_timelineCache[cacheKey]));
          return;
        }

        // ── Astronomy ──
        const conf = await parseBirdnetConf();
        const lat = parseFloat(conf.LATITUDE || conf.LAT || '0');
        const lon = parseFloat(conf.LONGITUDE || conf.LON || '0');
        const hasGPS = lat !== 0 || lon !== 0;

        let astronomy = {};
        if (hasGPS) {
          const d = new Date(dateStr + 'T12:00:00Z');
          const times = SunCalc.getTimes(d, lat, lon);
          const moon = SunCalc.getMoonIllumination(d);
          const toDecimal = dt => dt.getHours() + dt.getMinutes() / 60 + dt.getSeconds() / 3600;
          const fmt = dt => dt.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
          astronomy = {
            astronomicalDawn: toDecimal(times.nightEnd),
            nauticalDawn:     toDecimal(times.nauticalDawn),
            civilDawn:        toDecimal(times.dawn),
            sunrise:          toDecimal(times.sunrise),
            solarNoon:        toDecimal(times.solarNoon),
            sunset:           toDecimal(times.sunset),
            civilDusk:        toDecimal(times.dusk),
            nauticalDusk:     toDecimal(times.nauticalDusk),
            astronomicalDusk: toDecimal(times.night),
            moonPhase:        moon.phase,
            moonIllumination: moon.fraction,
            sunriseStr:       fmt(times.sunrise),
            sunsetStr:        fmt(times.sunset),
          };
        }

        // ── Detection rules ──
        const DETECTION_RULES_PATH_TL = path.join(PROJECT_ROOT, 'config', 'detection_rules.json');
        const rules = readJsonFile(DETECTION_RULES_PATH_TL) || {};
        const nocturnalSpecies = (rules.rules?.nocturnal_day?.species) || [];
        const outOfSeasonMap = (rules.rules?.out_of_season?.species_months) || {};

        // ── Basic stats ──
        const statsRow = db.prepare(`
          SELECT COUNT(*) as totalDetections,
                 COUNT(DISTINCT Com_Name) as totalSpecies
          FROM detections WHERE Date = ?
        `).get(dateStr);

        // ── Density (48 half-hour slots) ──
        const densityRows = db.prepare(`
          SELECT
            CAST(CAST(SUBSTR(Time,1,2) AS INT) * 2
              + CASE WHEN CAST(SUBSTR(Time,4,2) AS INT) >= 30 THEN 1 ELSE 0 END
            AS INT) as slot,
            COUNT(*) as count
          FROM detections WHERE Date = ?
          GROUP BY slot ORDER BY slot
        `).all(dateStr);

        // ── Events selection ──
        const events = [];
        const sunriseTime = hasGPS ? astronomy.sunriseStr : '06:30';
        const sunriseDecimal = hasGPS ? astronomy.sunrise : 6.5;
        const sunsetDecimal = hasGPS ? astronomy.sunset : 19.5;

        // 1. Nocturnal species
        if (nocturnalSpecies.length > 0) {
          const placeholders = nocturnalSpecies.map(() => '?').join(',');
          const noctRows = db.prepare(`
            SELECT Com_Name, Sci_Name, MAX(Confidence) as Confidence,
                   MIN(Time) as Time, File_Name
            FROM detections
            WHERE Date = ?
              AND (CAST(SUBSTR(Time,1,2) AS INT) < 6 OR CAST(SUBSTR(Time,1,2) AS INT) >= 21)
              AND Confidence >= ?
              AND Sci_Name IN (${placeholders})
            GROUP BY Com_Name
            ORDER BY MIN(Time) ASC
          `).all(dateStr, Math.max(minConf, 0.5), ...nocturnalSpecies);
          for (const r of noctRows) {
            const h = parseInt(r.Time.substr(0, 2)), m = parseInt(r.Time.substr(3, 2));
            events.push({
              id: `evt_${dateStr.replace(/-/g, '')}_${r.Time.replace(/:/g, '')}_${r.Sci_Name.replace(/ /g, '-')}`,
              type: 'nocturnal', time: r.Time.substr(0, 5),
              timeDecimal: h + m / 60,
              commonName: r.Com_Name, sciName: r.Sci_Name,
              confidence: r.Confidence,
              tags: ['nocturnal'],
              photoUrl: `/birds/api/photo?sci=${encodeURIComponent(r.Sci_Name)}`,
              photoFallback: '🦉',
              audioFile: r.File_Name,
              priority: 1,
            });
          }
        }

        // 2. Out-of-season species
        const currentMonth = new Date(dateStr).getMonth() + 1;
        const oosSciNames = Object.keys(outOfSeasonMap).filter(sci => {
          const months = outOfSeasonMap[sci];
          return months && !months.includes(currentMonth);
        });
        if (oosSciNames.length > 0) {
          const ph = oosSciNames.map(() => '?').join(',');
          const oosRows = db.prepare(`
            SELECT Com_Name, Sci_Name, MAX(Confidence) as Confidence,
                   MIN(Time) as Time, File_Name
            FROM detections
            WHERE Date = ? AND Sci_Name IN (${ph}) AND Confidence >= ?
            GROUP BY Com_Name ORDER BY Confidence DESC
          `).all(dateStr, ...oosSciNames, minConf);
          for (const r of oosRows) {
            if (events.some(e => e.sciName === r.Sci_Name)) continue;
            const h = parseInt(r.Time.substr(0, 2)), m = parseInt(r.Time.substr(3, 2));
            events.push({
              id: `evt_${dateStr.replace(/-/g, '')}_${r.Time.replace(/:/g, '')}_${r.Sci_Name.replace(/ /g, '-')}`,
              type: 'out_of_season', time: r.Time.substr(0, 5),
              timeDecimal: h + m / 60,
              commonName: r.Com_Name, sciName: r.Sci_Name,
              confidence: r.Confidence,
              tags: ['out_of_season'],
              photoUrl: `/birds/api/photo?sci=${encodeURIComponent(r.Sci_Name)}`,
              photoFallback: '⚠️',
              audioFile: r.File_Name,
              priority: 1,
            });
          }
        }

        // 3. Rare species (seen ≤3 times in past year)
        const rareRows = db.prepare(`
          WITH hist AS (
            SELECT Com_Name, COUNT(*) as cnt
            FROM detections
            WHERE Date < ? AND Date >= DATE(?, '-365 days')
            GROUP BY Com_Name
          ),
          today AS (
            SELECT Com_Name, Sci_Name, MAX(Confidence) as Confidence,
                   MIN(Time) as Time, File_Name
            FROM detections
            WHERE Date = ? AND Confidence >= ?
            GROUP BY Com_Name
          )
          SELECT t.Com_Name, t.Sci_Name, t.Confidence, t.Time, t.File_Name,
                 COALESCE(h.cnt, 0) as historical_count
          FROM today t
          LEFT JOIN hist h ON t.Com_Name = h.Com_Name
          WHERE COALESCE(h.cnt, 0) <= 3
          ORDER BY t.Confidence DESC
          LIMIT ?
        `).all(dateStr, dateStr, dateStr, minConf, maxEvents);
        for (const r of rareRows) {
          if (events.some(e => e.sciName === r.Sci_Name)) continue;
          const h = parseInt(r.Time.substr(0, 2)), m = parseInt(r.Time.substr(3, 2));
          events.push({
            id: `evt_${dateStr.replace(/-/g, '')}_${r.Time.replace(/:/g, '')}_${r.Sci_Name.replace(/ /g, '-')}`,
            type: 'rare', time: r.Time.substr(0, 5),
            timeDecimal: h + m / 60,
            commonName: r.Com_Name, sciName: r.Sci_Name,
            confidence: r.Confidence,
            tags: ['rare'],
            photoUrl: `/birds/api/photo?sci=${encodeURIComponent(r.Sci_Name)}`,
            photoFallback: '⭐',
            audioFile: r.File_Name,
            priority: 1,
          });
        }

        // 4. First of the year
        const yearStart = dateStr.substring(0, 4) + '-01-01';
        const foyRows = db.prepare(`
          WITH today AS (
            SELECT Com_Name, Sci_Name, MAX(Confidence) as Confidence,
                   MIN(Time) as Time, File_Name
            FROM detections
            WHERE Date = ? AND Confidence >= ?
            GROUP BY Com_Name
          ),
          prior AS (
            SELECT DISTINCT Com_Name FROM detections
            WHERE Date >= ? AND Date < ?
          )
          SELECT t.Com_Name, t.Sci_Name, t.Confidence, t.Time, t.File_Name
          FROM today t
          LEFT JOIN prior p ON t.Com_Name = p.Com_Name
          WHERE p.Com_Name IS NULL
          ORDER BY t.Time ASC
          LIMIT ?
        `).all(dateStr, minConf, yearStart, dateStr, maxEvents);
        for (const r of foyRows) {
          if (events.some(e => e.sciName === r.Sci_Name)) continue;
          const h = parseInt(r.Time.substr(0, 2)), m = parseInt(r.Time.substr(3, 2));
          events.push({
            id: `evt_${dateStr.replace(/-/g, '')}_${r.Time.replace(/:/g, '')}_${r.Sci_Name.replace(/ /g, '-')}`,
            type: 'firstyear', time: r.Time.substr(0, 5),
            timeDecimal: h + m / 60,
            commonName: r.Com_Name, sciName: r.Sci_Name,
            confidence: r.Confidence,
            tags: ['firstyear'],
            photoUrl: `/birds/api/photo?sci=${encodeURIComponent(r.Sci_Name)}`,
            photoFallback: '🪶',
            audioFile: r.File_Name,
            priority: 1,
          });
        }

        // 5. First diurnal detection of the day
        const firstDiurnal = db.prepare(`
          SELECT Com_Name, Sci_Name, Confidence, Time, File_Name
          FROM detections
          WHERE Date = ? AND Time >= ? AND Confidence >= ?
          ORDER BY Time ASC LIMIT 1
        `).get(dateStr, sunriseTime, minConf);
        if (firstDiurnal && !events.some(e => e.sciName === firstDiurnal.Sci_Name && e.time === firstDiurnal.Time.substr(0, 5))) {
          const h = parseInt(firstDiurnal.Time.substr(0, 2)), m = parseInt(firstDiurnal.Time.substr(3, 2));
          events.push({
            id: `evt_${dateStr.replace(/-/g, '')}_${firstDiurnal.Time.replace(/:/g, '')}_${firstDiurnal.Sci_Name.replace(/ /g, '-')}`,
            type: 'firstday', time: firstDiurnal.Time.substr(0, 5),
            timeDecimal: h + m / 60,
            commonName: firstDiurnal.Com_Name, sciName: firstDiurnal.Sci_Name,
            confidence: firstDiurnal.Confidence,
            tags: ['firstday'],
            photoUrl: `/birds/api/photo?sci=${encodeURIComponent(firstDiurnal.Sci_Name)}`,
            photoFallback: '🐦',
            audioFile: firstDiurnal.File_Name,
            priority: 1,
          });
        }

        // 6. Best detection of the day
        const bestDet = db.prepare(`
          SELECT Com_Name, Sci_Name, Confidence, Time, File_Name
          FROM detections
          WHERE Date = ? ORDER BY Confidence DESC LIMIT 1
        `).get(dateStr);
        if (bestDet && !events.some(e => e.sciName === bestDet.Sci_Name && e.time === bestDet.Time.substr(0, 5))) {
          const h = parseInt(bestDet.Time.substr(0, 2)), m = parseInt(bestDet.Time.substr(3, 2));
          events.push({
            id: `evt_${dateStr.replace(/-/g, '')}_${bestDet.Time.replace(/:/g, '')}_${bestDet.Sci_Name.replace(/ /g, '-')}`,
            type: 'best', time: bestDet.Time.substr(0, 5),
            timeDecimal: h + m / 60,
            commonName: bestDet.Com_Name, sciName: bestDet.Sci_Name,
            confidence: bestDet.Confidence,
            tags: ['best'],
            photoUrl: `/birds/api/photo?sci=${encodeURIComponent(bestDet.Sci_Name)}`,
            photoFallback: '🎵',
            audioFile: bestDet.File_Name,
            priority: 1,
          });
        }

        // 7. Species return (absent >= 10 days, back today)
        try {
          const returnRows = db.prepare(`
            WITH last AS (
              SELECT Com_Name, MAX(Date) as last_date
              FROM detections
              WHERE Date < ? AND Date >= DATE(?, '-90 days')
              GROUP BY Com_Name
            ),
            today AS (
              SELECT Com_Name, Sci_Name, MAX(Confidence) as Confidence,
                     MIN(Time) as Time, File_Name
              FROM detections
              WHERE Date = ? AND Confidence >= 0.7
              GROUP BY Com_Name
            )
            SELECT t.Com_Name, t.Sci_Name, t.Confidence, t.Time, t.File_Name,
                   l.last_date as last_seen
            FROM today t
            JOIN last l ON t.Com_Name = l.Com_Name
            WHERE l.last_date <= DATE(?, '-10 days')
            ORDER BY t.Confidence DESC
            LIMIT 5
          `).all(dateStr, dateStr, dateStr, dateStr);
          for (const r of returnRows) {
            if (events.some(e => e.sciName === r.Sci_Name)) continue;
            const h = parseInt(r.Time.substr(0, 2)), m = parseInt(r.Time.substr(3, 2));
            const absentDays = r.last_seen ? Math.round((new Date(dateStr) - new Date(r.last_seen)) / 86400000) : 0;
            events.push({
              id: `evt_${dateStr.replace(/-/g, '')}_${r.Time.replace(/:/g, '')}_${r.Sci_Name.replace(/ /g, '-')}`,
              type: 'species_return', time: r.Time.substr(0, 5),
              timeDecimal: h + m / 60,
              commonName: r.Com_Name, sciName: r.Sci_Name,
              confidence: r.Confidence,
              tags: ['species_return'],
              photoUrl: `/birds/api/photo?sci=${encodeURIComponent(r.Sci_Name)}`,
              photoFallback: '🔄',
              audioFile: r.File_Name,
              priority: 2, absentDays,
            });
          }
        } catch(e) { console.error('[timeline species_return]', e.message); }

        // 8. Activity spike (species with 2x+ their daily average today)
        try {
          const spikeRows = db.prepare(`
            WITH today AS (
              SELECT Com_Name, Sci_Name, COUNT(*) as today_count,
                     MIN(Time) as Time, MAX(Confidence) as Confidence, File_Name
              FROM detections
              WHERE Date = ? AND Confidence >= 0.7
              GROUP BY Com_Name
            ),
            baseline AS (
              SELECT Com_Name,
                     CAST(COUNT(*) AS FLOAT) / COUNT(DISTINCT Date) as avg_count
              FROM detections
              WHERE Date < ? AND Date >= DATE(?, '-30 days')
              GROUP BY Com_Name
            )
            SELECT t.Com_Name, t.Sci_Name, t.today_count, b.avg_count,
                   ROUND(CAST(t.today_count AS FLOAT) / b.avg_count, 1) as ratio,
                   t.Time, t.Confidence, t.File_Name
            FROM today t
            JOIN baseline b ON t.Com_Name = b.Com_Name
            WHERE b.avg_count >= 2 AND t.today_count >= b.avg_count * 2
            ORDER BY ratio DESC
            LIMIT 3
          `).all(dateStr, dateStr, dateStr);
          for (const r of spikeRows) {
            if (events.some(e => e.sciName === r.Sci_Name)) continue;
            const h = parseInt(r.Time.substr(0, 2)), m = parseInt(r.Time.substr(3, 2));
            events.push({
              id: `evt_${dateStr.replace(/-/g, '')}_${r.Time.replace(/:/g, '')}_${r.Sci_Name.replace(/ /g, '-')}`,
              type: 'activity_spike', time: r.Time.substr(0, 5),
              timeDecimal: h + m / 60,
              commonName: r.Com_Name, sciName: r.Sci_Name,
              confidence: r.Confidence,
              tags: ['activity_spike'],
              photoUrl: `/birds/api/photo?sci=${encodeURIComponent(r.Sci_Name)}`,
              photoFallback: '📈',
              audioFile: r.File_Name,
              priority: 3, spikeRatio: r.ratio,
            });
          }
        } catch(e) { console.error('[timeline activity_spike]', e.message); }

        // 9. Dawn chorus — top species detected in first hour after sunrise
        if (hasGPS) {
          try {
            const chorusEnd = `${String(Math.floor(sunriseDecimal + 1)).padStart(2, '0')}:${String(Math.round(((sunriseDecimal + 1) % 1) * 60)).padStart(2, '0')}`;
            const chorusRows = db.prepare(`
              SELECT Com_Name, Sci_Name, MAX(Confidence) as Confidence,
                     MIN(Time) as Time, File_Name
              FROM detections
              WHERE Date = ? AND Time >= ? AND Time <= ? AND Confidence >= ?
              GROUP BY Com_Name
              ORDER BY MIN(Time) ASC
              LIMIT 5
            `).all(dateStr, sunriseTime, chorusEnd, minConf); // Use minConf param instead of hardcoded value
            for (const r of chorusRows) {
              if (events.some(e => e.sciName === r.Sci_Name)) continue;
              const h = parseInt(r.Time.substr(0, 2)), m = parseInt(r.Time.substr(3, 2));
              events.push({
                id: `evt_${dateStr.replace(/-/g, '')}_${r.Time.replace(/:/g, '')}_${r.Sci_Name.replace(/ /g, '-')}`,
                type: 'firstday', time: r.Time.substr(0, 5),
                timeDecimal: h + m / 60,
                commonName: r.Com_Name, sciName: r.Sci_Name,
                confidence: r.Confidence,
                tags: ['firstday'],
                photoUrl: `/birds/api/photo?sci=${encodeURIComponent(r.Sci_Name)}`,
                photoFallback: '🐦',
                audioFile: r.File_Name,
                priority: 3,
              });
            }
          } catch(e) { console.error('[timeline dawn_chorus]', e.message); }
        }

        // 10. Top species — fill gaps with most-detected species of the day
        const MAX_BIRD_EVENTS = Math.max(12, maxEvents * 2);
        if (events.length < MAX_BIRD_EVENTS) {
          try {
            const topRows = db.prepare(`
              SELECT Com_Name, Sci_Name, COUNT(*) as n, MIN(Time) as Time,
                     MAX(Confidence) as Confidence, File_Name
              FROM detections
              WHERE Date = ? AND Confidence >= ?
              GROUP BY Com_Name
              ORDER BY COUNT(*) DESC
              LIMIT ?
            `).all(dateStr, minConf, MAX_BIRD_EVENTS);
            for (const r of topRows) {
              if (events.length >= MAX_BIRD_EVENTS) break;
              if (events.some(e => e.sciName === r.Sci_Name)) continue;
              const h = parseInt(r.Time.substr(0, 2)), m = parseInt(r.Time.substr(3, 2));
              events.push({
                id: `evt_${dateStr.replace(/-/g, '')}_${r.Time.replace(/:/g, '')}_${r.Sci_Name.replace(/ /g, '-')}`,
                type: 'top_species', time: r.Time.substr(0, 5),
                timeDecimal: h + m / 60,
                commonName: r.Com_Name, sciName: r.Sci_Name,
                confidence: r.Confidence,
                tags: ['top_species'],
                photoUrl: `/birds/api/photo?sci=${encodeURIComponent(r.Sci_Name)}`,
                photoFallback: '🐦',
                audioFile: r.File_Name,
                priority: 3, detectionCount: r.n,
              });
            }
          } catch(e) { console.error('[timeline top_species]', e.message); }
        }

        // ── Add astronomical events ──
        if (hasGPS) {
          events.push({
            id: `evt_${dateStr.replace(/-/g, '')}_sunrise`,
            type: 'astro', time: astronomy.sunriseStr,
            timeDecimal: astronomy.sunrise,
            commonName: 'Lever du soleil', sciName: '',
            confidence: 1, tags: [], photoFallback: '🌅',
            isAstro: true, priority: 0,
          });
          events.push({
            id: `evt_${dateStr.replace(/-/g, '')}_sunset`,
            type: 'astro', time: astronomy.sunsetStr,
            timeDecimal: astronomy.sunset,
            commonName: 'Coucher du soleil', sciName: '',
            confidence: 1, tags: [], photoFallback: '🌇',
            isAstro: true, priority: 0,
          });
        }

        // ── Clustering: group ≥3 events within 30 min window ──
        const sortedEvents = events.filter(e => !e.isAstro).sort((a, b) => a.timeDecimal - b.timeDecimal);
        const clusters = [];
        let i = 0;
        while (i < sortedEvents.length) {
          let j = i + 1;
          while (j < sortedEvents.length && sortedEvents[j].timeDecimal - sortedEvents[i].timeDecimal < 0.5) {
            j++;
          }
          const group = sortedEvents.slice(i, j);
          // Only cluster non-P1 events
          const p1Events = group.filter(e => e.priority === 1);
          const clusterableEvents = group.filter(e => e.priority > 1);
          if (clusterableEvents.length >= 3) {
            // Keep P1 events standalone, cluster the rest
            p1Events.forEach(e => clusters.push(e));
            const avgTime = clusterableEvents.reduce((s, e) => s + e.timeDecimal, 0) / clusterableEvents.length;
            const h = Math.floor(avgTime), m = Math.round((avgTime - h) * 60);
            clusters.push({
              id: `cluster_${dateStr.replace(/-/g, '')}_${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`,
              type: 'cluster',
              time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
              timeDecimal: avgTime,
              count: clusterableEvents.length,
              species: clusterableEvents.map(e => ({ commonName: e.commonName, sciName: e.sciName, type: e.type, photoFallback: e.photoFallback, photoUrl: e.photoUrl, confidence: e.confidence, time: e.time, tags: e.tags })),
              colors: clusterableEvents.map(e => {
                const typeColors = { nocturnal: '#818cf8', rare: '#f43f5e', firstyear: '#fbbf24', firstday: '#34d399', best: '#60a5fa' };
                return typeColors[e.type] || '#8b949e';
              }),
              priority: 3,
            });
          } else {
            group.forEach(e => clusters.push(e));
          }
          i = j;
        }

        // Re-add astro events
        const astroEvents = events.filter(e => e.isAstro);
        const allEvents = [...clusters, ...astroEvents].sort((a, b) => a.timeDecimal - b.timeDecimal);

        // ── Assign above/below positions ──
        let lastPos = 'below';
        for (const ev of allEvents) {
          if (ev.isAstro || ev.type === 'cluster') continue;
          if (ev.priority === 1) {
            ev.position = 'above';
          } else {
            ev.position = lastPos === 'above' ? 'below' : 'above';
          }
          lastPos = ev.position;
          ev.vOff = 62 + Math.floor(Math.random() * 28);
        }

        // ── Notable count ──
        const notableCount = allEvents.filter(e => !e.isAstro && e.type !== 'cluster' && e.priority <= 2).length;

        // ── Navigation ──
        const prevRow = db.prepare(`SELECT MAX(Date) as prev_date FROM detections WHERE Date < ?`).get(dateStr);
        const nextRow = db.prepare(`SELECT MIN(Date) as next_date FROM detections WHERE Date > ?`).get(dateStr);

        // ── Moon phase name ──
        let moonPhaseName = '';
        if (hasGPS) {
          const p = astronomy.moonPhase;
          if (p < 0.0625) moonPhaseName = 'new_moon';
          else if (p < 0.1875) moonPhaseName = 'waxing_crescent';
          else if (p < 0.3125) moonPhaseName = 'first_quarter';
          else if (p < 0.4375) moonPhaseName = 'waxing_gibbous';
          else if (p < 0.5625) moonPhaseName = 'full_moon';
          else if (p < 0.6875) moonPhaseName = 'waning_gibbous';
          else if (p < 0.8125) moonPhaseName = 'last_quarter';
          else if (p < 0.9375) moonPhaseName = 'waning_crescent';
          else moonPhaseName = 'new_moon';
        }

        const result = {
          date: dateStr,
          meta: {
            totalDetections: statsRow?.totalDetections || 0,
            totalSpecies: statsRow?.totalSpecies || 0,
            notableCount,
            sunrise: hasGPS ? astronomy.sunriseStr : null,
            sunset: hasGPS ? astronomy.sunsetStr : null,
            sunriseDecimal: hasGPS ? astronomy.sunrise : null,
            sunsetDecimal: hasGPS ? astronomy.sunset : null,
            moonPhase: hasGPS ? astronomy.moonPhase : null,
            moonIllumination: hasGPS ? astronomy.moonIllumination : null,
            moonPhaseName,
            isToday,
            hasPrevDay: !!prevRow?.prev_date,
            hasNextDay: !!nextRow?.next_date,
            astronomy: hasGPS ? astronomy : null,
          },
          events: allEvents,
          density: densityRows,
          navigation: {
            prevDate: prevRow?.prev_date || null,
            nextDate: nextRow?.next_date || null,
          },
        };

        _timelineCache[cacheKey] = result;
        _timelineCacheTs[cacheKey] = Date.now();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error('[timeline] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to compute timeline data' }));
      }
    })();
    return true;
  }


  return false;
}

module.exports = { handle };
