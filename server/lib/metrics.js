'use strict';
/**
 * Prometheus metrics — exposes birdash internals on /metrics in the
 * standard Prometheus exposition format. Aimed at people who already run
 * Grafana / Prometheus / VictoriaMetrics and want one more scrape target
 * for their station.
 *
 * No labels with high cardinality (no per-species detection counters); the
 * detection store is the SQLite DB itself, this is just for trends.
 *
 * Refreshed lazily on every scrape — querying a few aggregates from a
 * 1M-row table is sub-millisecond, no need for a background timer.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const promClient = require('prom-client');

const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register, prefix: 'birdash_node_' });

const VERSION = (() => {
  try { return require('../../package.json').version; } catch { return 'unknown'; }
})();

// ── Custom metrics ────────────────────────────────────────────────────────

const versionInfo = new promClient.Gauge({
  name: 'birdash_version_info',
  help: 'birdash version (always 1, version is the label)',
  labelNames: ['version'],
  registers: [register],
});
versionInfo.set({ version: VERSION }, 1);

const detectionsTotal = new promClient.Gauge({
  name: 'birdash_detections_total',
  help: 'Total non-rejected detections in the database',
  registers: [register],
});

const detectionsToday = new promClient.Gauge({
  name: 'birdash_detections_today',
  help: 'Number of detections recorded today',
  registers: [register],
});

const detectionsLastHour = new promClient.Gauge({
  name: 'birdash_detections_last_hour',
  help: 'Number of detections in the last hour',
  registers: [register],
});

const speciesToday = new promClient.Gauge({
  name: 'birdash_species_today',
  help: 'Distinct species detected today',
  registers: [register],
});

const species30d = new promClient.Gauge({
  name: 'birdash_species_30d',
  help: 'Distinct species detected over the last 30 days',
  registers: [register],
});

const lastDetectionAge = new promClient.Gauge({
  name: 'birdash_last_detection_age_seconds',
  help: 'Seconds since the most recent detection',
  registers: [register],
});

const dbSizeBytes = new promClient.Gauge({
  name: 'birdash_db_size_bytes',
  help: 'birds.db file size on disk',
  registers: [register],
});

const cpuTemp = new promClient.Gauge({
  name: 'birdash_cpu_temp_celsius',
  help: 'CPU temperature in Celsius',
  registers: [register],
});

const cpuUsagePct = new promClient.Gauge({
  name: 'birdash_cpu_usage_percent',
  help: 'System-wide CPU usage from load1 / cores',
  registers: [register],
});

const memUsedBytes = new promClient.Gauge({
  name: 'birdash_memory_used_bytes',
  help: 'System memory used (bytes)',
  registers: [register],
});

const memTotalBytes = new promClient.Gauge({
  name: 'birdash_memory_total_bytes',
  help: 'System memory total (bytes)',
  registers: [register],
});

const diskUsedBytes = new promClient.Gauge({
  name: 'birdash_disk_used_bytes',
  help: 'Root filesystem used (bytes)',
  registers: [register],
});

const diskTotalBytes = new promClient.Gauge({
  name: 'birdash_disk_total_bytes',
  help: 'Root filesystem total (bytes)',
  registers: [register],
});

const fanRpm = new promClient.Gauge({
  name: 'birdash_fan_rpm',
  help: 'Cooling fan RPM (Pi 5 active cooler)',
  registers: [register],
});

const systemUptime = new promClient.Gauge({
  name: 'birdash_system_uptime_seconds',
  help: 'System uptime in seconds (from /proc/uptime)',
  registers: [register],
});

const featureEnabled = new promClient.Gauge({
  name: 'birdash_feature_enabled',
  help: '1 if the feature is enabled, 0 otherwise',
  labelNames: ['feature'],
  registers: [register],
});

// ── Sound level (dBFS, uncalibrated) ──────────────────────────────────────
// Written per WAV by the Python engine into config/sound_level.json.
// Trend-only: reflects relative input loudness, not absolute SPL.

const soundLeq = new promClient.Gauge({
  name: 'birdash_sound_leq_dbfs',
  help: 'Leq (RMS) over the last processed WAV, in dBFS (0 = full scale)',
  registers: [register],
});

const soundPeak = new promClient.Gauge({
  name: 'birdash_sound_peak_dbfs',
  help: 'Peak amplitude of the last processed WAV, in dBFS',
  registers: [register],
});

const soundLeqAvg1h = new promClient.Gauge({
  name: 'birdash_sound_leq_1h_avg_dbfs',
  help: 'Energy-average Leq over the last hour, in dBFS',
  registers: [register],
});

const soundAgeSec = new promClient.Gauge({
  name: 'birdash_sound_last_reading_age_seconds',
  help: 'Seconds since the last sound-level reading was written by the engine',
  registers: [register],
});

// ── Refresh helpers ───────────────────────────────────────────────────────

let _db = null;
let _execCmd = null;
let _parseBirdnetConf = null;

function _refreshDb() {
  if (!_db) return;
  try {
    const total = _db.prepare('SELECT COUNT(*) AS n FROM detections').get();
    detectionsTotal.set(total.n || 0);

    const today = new Date().toISOString().slice(0, 10);
    const todayRow = _db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT Sci_Name) AS s FROM detections WHERE Date = ?').get(today);
    detectionsToday.set(todayRow.n || 0);
    speciesToday.set(todayRow.s || 0);

    // Last hour — Date+Time strings, build a SQL-comparable cutoff.
    const cutoff = new Date(Date.now() - 3600 * 1000);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    const cutoffTime = cutoff.toISOString().slice(11, 19);
    const lastHour = _db.prepare(
      "SELECT COUNT(*) AS n FROM detections WHERE (Date > ?) OR (Date = ? AND Time >= ?)"
    ).get(cutoffDate, cutoffDate, cutoffTime);
    detectionsLastHour.set(lastHour.n || 0);

    const span30 = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
    const sp30 = _db.prepare('SELECT COUNT(DISTINCT Sci_Name) AS s FROM detections WHERE Date >= ?').get(span30);
    species30d.set(sp30.s || 0);

    const last = _db.prepare('SELECT Date, Time FROM detections ORDER BY Date DESC, Time DESC LIMIT 1').get();
    if (last && last.Date && last.Time) {
      const lastTs = new Date(`${last.Date}T${last.Time}`).getTime();
      if (!isNaN(lastTs)) lastDetectionAge.set(Math.max(0, Math.floor((Date.now() - lastTs) / 1000)));
    }
  } catch (e) {
    console.warn('[metrics] DB refresh:', e.message);
  }

  try {
    const dbPath = process.env.BIRDASH_DB || path.join(process.env.HOME, 'BirdNET-Pi/scripts/birds.db');
    const st = fs.statSync(dbPath);
    dbSizeBytes.set(st.size);
  } catch {}
}

async function _refreshSystem() {
  try {
    const memRaw = await fsp.readFile('/proc/meminfo', 'utf8');
    const memParse = k => parseInt((memRaw.match(new RegExp(k + ':\\s+(\\d+)')) || [0,0])[1]) * 1024;
    const total = memParse('MemTotal'), avail = memParse('MemAvailable');
    memTotalBytes.set(total);
    memUsedBytes.set(total - avail);
  } catch {}

  try {
    const loadRaw = await fsp.readFile('/proc/loadavg', 'utf8');
    const load1 = parseFloat(loadRaw.trim().split(/\s+/)[0]);
    const cpuRaw = await fsp.readFile('/proc/cpuinfo', 'utf8');
    const cores = (cpuRaw.match(/^processor/gm) || []).length || 1;
    cpuUsagePct.set(Math.min(100, Math.round(load1 / cores * 100)));
  } catch {}

  try {
    const uptimeRaw = await fsp.readFile('/proc/uptime', 'utf8');
    systemUptime.set(parseFloat(uptimeRaw.split(/\s+/)[0]));
  } catch {}

  try {
    const tempRaw = await fsp.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    cpuTemp.set(parseInt(tempRaw.trim()) / 1000);
  } catch {}

  try {
    const out = await _execCmd('df', ['-B1', '/']);
    const parts = out.split('\n')[1].trim().split(/\s+/);
    diskTotalBytes.set(parseInt(parts[1]));
    diskUsedBytes.set(parseInt(parts[2]));
  } catch {}

  try {
    const fanDir = fs.readdirSync('/sys/devices/platform/cooling_fan/hwmon/')[0];
    const rpm = parseInt((await fsp.readFile(`/sys/devices/platform/cooling_fan/hwmon/${fanDir}/fan1_input`, 'utf8')).trim());
    fanRpm.set(rpm);
  } catch {}
}

function _refreshSoundLevel() {
  try {
    const soundPath = path.join(process.env.HOME || '/home/bjorn', 'birdash/config/sound_level.json');
    if (!fs.existsSync(soundPath)) return;
    const raw = fs.readFileSync(soundPath, 'utf8');
    const state = JSON.parse(raw);
    const cur = state && state.current;
    if (cur && typeof cur.leq === 'number') {
      soundLeq.set(cur.leq);
      soundPeak.set(typeof cur.peak === 'number' ? cur.peak : -120);
      if (typeof cur.ts === 'number') {
        soundAgeSec.set(Math.max(0, Math.floor(Date.now() / 1000 - cur.ts)));
      }
    }
    const buf = state && state.buffer;
    if (Array.isArray(buf) && buf.length) {
      // Energy-average: sum(10^(leq/10)) / N → 10·log10 of that
      const cutoff = Date.now() / 1000 - 3600;
      const recent = buf.filter(e => typeof e.leq === 'number' && typeof e.ts === 'number' && e.ts >= cutoff);
      if (recent.length) {
        const sum = recent.reduce((s, e) => s + Math.pow(10, e.leq / 10), 0);
        soundLeqAvg1h.set(10 * Math.log10(sum / recent.length));
      }
    }
  } catch (e) {
    // Missing file is fine (engine hasn't written yet, or feature off)
  }
}

async function _refreshFeatures() {
  if (!_parseBirdnetConf) return;
  try {
    const conf = await _parseBirdnetConf();
    const flag = (k) => conf[k] === '1' ? 1 : 0;
    featureEnabled.set({ feature: 'mqtt' },          flag('MQTT_ENABLED'));
    featureEnabled.set({ feature: 'notifications' }, flag('NOTIFY_ENABLED'));
    featureEnabled.set({ feature: 'dual_model' },    flag('DUAL_MODEL_ENABLED'));
    featureEnabled.set({ feature: 'birdweather' },   conf.BIRDWEATHER_ID ? 1 : 0);
    featureEnabled.set({ feature: 'weekly_digest' }, flag('NOTIFY_DIGEST_ENABLED'));
  } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────

function init({ db, execCmd, parseBirdnetConf }) {
  _db = db;
  _execCmd = execCmd;
  _parseBirdnetConf = parseBirdnetConf;
}

async function collect() {
  _refreshDb();
  _refreshSoundLevel();
  await Promise.all([_refreshSystem(), _refreshFeatures()]);
  return register.metrics();
}

function contentType() { return register.contentType; }

module.exports = { init, collect, contentType };
