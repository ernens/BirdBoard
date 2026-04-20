'use strict';
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const { spawn } = require('child_process');
const safeConfig = require('./safe-config');

// ── BirdNET configuration ─────────────────────────────────────────────────────
const BIRDNET_CONF = '/etc/birdnet/birdnet.conf';
const _birdashEngine = path.join(process.env.HOME, 'birdash', 'engine');
const _birdengine = path.join(process.env.HOME, 'birdengine');
const _hasModels = (dir) => { try { return fs.readdirSync(path.join(dir, 'models')).some(f => f.endsWith('.tflite')); } catch { return false; } };
const BIRDNET_DIR = _hasModels(_birdengine) ? _birdengine : _hasModels(_birdashEngine) ? _birdashEngine : _birdengine;

let _birdnetConfCache = null;
let _birdnetConfTs = 0;
const BIRDNET_CONF_TTL = 60 * 1000;

async function parseBirdnetConf() {
  const now = Date.now();
  if (_birdnetConfCache && (now - _birdnetConfTs) < BIRDNET_CONF_TTL) {
    return _birdnetConfCache;
  }
  const raw = await fsp.readFile(BIRDNET_CONF, 'utf8');
  const conf = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    conf[key] = val;
  }
  _birdnetConfCache = conf;
  _birdnetConfTs = now;
  return conf;
}

// All writeBirdnetConf calls go through safe-config's per-path lock.
// We grab locks for BOTH birdnet.conf AND engine/config.toml so a sync that
// touches both files cannot interleave with another updater of either file.
const CONFIG_TOML_PATH = path.join(__dirname, '..', '..', 'engine', 'config.toml');

async function writeBirdnetConf(updates) {
  return safeConfig.withLock(BIRDNET_CONF, () =>
    safeConfig.withLock(CONFIG_TOML_PATH, () =>
      _writeBirdnetConfImpl(updates)
    )
  );
}

async function _writeBirdnetConfImpl(updates) {
  await fsp.copyFile(BIRDNET_CONF, BIRDNET_CONF + '.bak').catch(() => {});
  const raw = await fsp.readFile(BIRDNET_CONF, 'utf8');
  const lines = raw.split('\n');
  const written = new Set();
  const result = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key in updates) {
      written.add(key);
      const val = updates[key];
      const needsQuote = /[\s#"'$]/.test(String(val));
      return needsQuote ? `${key}="${val}"` : `${key}=${val}`;
    }
    return line;
  });
  for (const key of Object.keys(updates)) {
    if (!written.has(key)) {
      const val = updates[key];
      const needsQuote = /[\s#"'$]/.test(String(val));
      result.push(needsQuote ? `${key}="${val}"` : `${key}=${val}`);
      written.add(key);
    }
  }
  // Unique temp filename so racing callers can't unlink each other's file.
  const tmpFile = `/tmp/birdnet.conf.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpFile, result.join('\n'));
  try {
    await execCmd('sudo', ['cp', tmpFile, BIRDNET_CONF]);
  } finally {
    await fsp.unlink(tmpFile).catch(() => {});
  }
  // Invalidate cache so next read picks up new values
  _birdnetConfCache = null;
  _birdnetConfTs = 0;

  // Also sync MODEL and SECONDARY_MODEL to engine/config.toml — atomic
  // write via tmp + rename so a concurrent caller can't truncate the
  // file mid-write (this corrupted the trailing local_db line on
  // mickey.local when two POST /api/settings landed within 11s).
  const configToml = path.join(__dirname, '..', '..', 'engine', 'config.toml');
  try {
    if (fs.existsSync(configToml)) {
      let toml = await fsp.readFile(configToml, 'utf8');
      if (updates.MODEL) {
        const before = toml.match(/^model\s*=\s*"[^"]*"/m)?.[0];
        toml = toml.replace(/^model\s*=\s*"[^"]*"/m, `model = "${updates.MODEL}"`);
        const after = toml.match(/^model\s*=\s*"[^"]*"/m)?.[0];
        console.log(`[config] config.toml MODEL sync: ${before} → ${after}`);
      }
      if ('DUAL_MODEL_ENABLED' in updates) {
        const sec = updates.DUAL_MODEL_ENABLED === '1' || updates.DUAL_MODEL_ENABLED === 1
          ? (updates.SECONDARY_MODEL || 'perch_v2_dynint8') : '';
        toml = toml.replace(/^secondary_model\s*=\s*"[^"]*"/m, `secondary_model = "${sec}"`);
      }
      if (updates.SECONDARY_MODEL) {
        toml = toml.replace(/^secondary_model\s*=\s*"[^"]*"/m, `secondary_model = "${updates.SECONDARY_MODEL}"`);
      }
      if (updates.CONFIDENCE) {
        toml = toml.replace(/^birdnet_confidence\s*=\s*[\d.]+/m, `birdnet_confidence = ${updates.CONFIDENCE}`);
      }
      if ('LATITUDE' in updates) {
        const lat = Number(updates.LATITUDE);
        if (Number.isFinite(lat)) {
          const before = toml.match(/^latitude\s*=\s*-?[\d.]+/m)?.[0];
          toml = toml.replace(/^latitude\s*=\s*-?[\d.]+/m, `latitude = ${lat}`);
          const after = toml.match(/^latitude\s*=\s*-?[\d.]+/m)?.[0];
          console.log(`[config] config.toml LATITUDE sync: ${before} → ${after}`);
        }
      }
      if ('LONGITUDE' in updates) {
        const lon = Number(updates.LONGITUDE);
        if (Number.isFinite(lon)) {
          const before = toml.match(/^longitude\s*=\s*-?[\d.]+/m)?.[0];
          toml = toml.replace(/^longitude\s*=\s*-?[\d.]+/m, `longitude = ${lon}`);
          const after = toml.match(/^longitude\s*=\s*-?[\d.]+/m)?.[0];
          console.log(`[config] config.toml LONGITUDE sync: ${before} → ${after}`);
        }
      }
      const tomlTmp = `${configToml}.${process.pid}.${Date.now()}.tmp`;
      await fsp.writeFile(tomlTmp, toml);
      await fsp.rename(tomlTmp, configToml);  // atomic on POSIX
    }
  } catch(e) { console.warn('[config] Failed to sync config.toml:', e.message); }
}

function execCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `exit ${code}`)));
  });
}

const ALLOWED_SERVICES = ['birdengine', 'birdengine-recording', 'birdash', 'caddy', 'ttyd', 'birdash-tft'];

const SETTINGS_VALIDATORS = {
  SITE_NAME:       v => typeof v === 'string' && v.length <= 100,
  SITE_BRAND:      v => typeof v === 'string' && v.length <= 50,
  LATITUDE:        v => !isNaN(v) && v >= -90 && v <= 90,
  LONGITUDE:       v => !isNaN(v) && v >= -180 && v <= 180,
  ELEVATION:       v => v === '' || (!isNaN(v) && v >= -500 && v <= 9000),
  MODEL:           v => typeof v === 'string' && /^[a-zA-Z0-9_.\-]+$/.test(v),
  SF_THRESH:       v => !isNaN(v) && v >= 0 && v <= 1,
  CONFIDENCE:      v => !isNaN(v) && v >= 0.01 && v <= 0.99,
  BIRDNET_CONFIDENCE: v => !isNaN(v) && v >= 0.01 && v <= 0.99,
  PERCH_CONFIDENCE:   v => !isNaN(v) && v >= 0.01 && v <= 0.99,
  PERCH_MIN_MARGIN:   v => !isNaN(v) && v >= 0 && v <= 0.5,
  SENSITIVITY:     v => !isNaN(v) && v >= 0.5 && v <= 1.5,
  OVERLAP:         v => !isNaN(v) && v >= 0 && v <= 2.9,
  RECORDING_LENGTH: v => !isNaN(v) && v >= 6 && v <= 120,
  EXTRACTION_LENGTH: v => v === '' || (!isNaN(v) && v >= 3 && v <= 30),
  AUDIOFMT:        v => ['mp3','wav','flac','ogg'].includes(v),
  CHANNELS:        v => v == 1 || v == 2,
  DATABASE_LANG:   v => /^[a-z]{2}(_[A-Z]{2})?$/.test(v),
  BIRDWEATHER_ID:  v => typeof v === 'string' && v.length <= 64,
  EBIRD_API_KEY:   v => typeof v === 'string' && v.length <= 64,
  FULL_DISK:       v => ['purge','keep'].includes(v),
  PURGE_THRESHOLD: v => !isNaN(v) && v >= 50 && v <= 99,
  MAX_FILES_SPECIES: v => !isNaN(v) && v >= 0,
  PRIVACY_THRESHOLD: v => !isNaN(v) && v >= 0 && v <= 3,
  DUAL_MODEL_ENABLED: v => v == 0 || v == 1,
  SECONDARY_MODEL: v => typeof v === 'string' && v.length <= 100,
  NOTIFY_RARE_SPECIES: v => v == 0 || v == 1,
  NOTIFY_RARE_THRESHOLD: v => !isNaN(v) && v >= 1 && v <= 1000,
  NOTIFY_FIRST_SEASON: v => v == 0 || v == 1,
  NOTIFY_FAVORITES:    v => v == 0 || v == 1,
  NOTIFY_SEASON_DAYS: v => !isNaN(v) && v >= 7 && v <= 365,
  AUDIO_RETENTION_DAYS: v => !isNaN(v) && v >= 7 && v <= 365,
  NOTIFY_ENABLED: v => v == 0 || v == 1,
  NOTIFY_MIN_CONFIDENCE: v => v === '' || (!isNaN(v) && v >= 0 && v <= 1),
  REC_CARD:        v => typeof v === 'string' && v.length <= 200,
  RTSP_STREAM:     v => typeof v === 'string' && v.length <= 500,
  APPRISE_NOTIFY_EACH_DETECTION: v => v == 0 || v == 1,
  APPRISE_NOTIFY_NEW_SPECIES: v => v == 0 || v == 1,
  APPRISE_NOTIFY_NEW_SPECIES_EACH_DAY: v => v == 0 || v == 1,
  NOTIFY_DIGEST_ENABLED: v => v == 0 || v == 1,
  NOTIFY_DIGEST_TAG: v => typeof v === 'string' && v.length <= 50,
  MQTT_ENABLED:        v => v == 0 || v == 1,
  MQTT_BROKER:         v => typeof v === 'string' && v.length <= 200,
  MQTT_PORT:           v => v === '' || (!isNaN(v) && v >= 1 && v <= 65535),
  MQTT_USERNAME:       v => typeof v === 'string' && v.length <= 100,
  MQTT_PASSWORD:       v => typeof v === 'string' && v.length <= 200,
  MQTT_TOPIC_PREFIX:   v => typeof v === 'string' && v.length <= 100 && !/[+#]/.test(v),
  MQTT_QOS:            v => v == 0 || v == 1 || v == 2,
  MQTT_RETAIN:         v => v == 0 || v == 1,
  MQTT_TLS:            v => v == 0 || v == 1,
  MQTT_MIN_CONFIDENCE: v => v === '' || (!isNaN(v) && v >= 0 && v <= 1),
  MQTT_HASS_DISCOVERY: v => v == 0 || v == 1,
  APPRISE_NOTIFICATION_TITLE: v => typeof v === 'string' && v.length <= 200,
  APPRISE_NOTIFICATION_BODY: v => typeof v === 'string' && v.length <= 500,
  APPRISE_MINIMUM_SECONDS_BETWEEN_NOTIFICATIONS_PER_SPECIES: v => !isNaN(v) && v >= 0,
  BIRDASH_ALERT_TEMP_WARN: v => !isNaN(v) && v >= 30 && v <= 100,
  BIRDASH_ALERT_TEMP_CRIT: v => !isNaN(v) && v >= 30 && v <= 100,
  BIRDASH_ALERT_DISK_WARN: v => !isNaN(v) && v >= 30 && v <= 99,
  BIRDASH_ALERT_DISK_CRIT: v => !isNaN(v) && v >= 30 && v <= 99,
  BIRDASH_ALERT_RAM_WARN:  v => !isNaN(v) && v >= 30 && v <= 99,
  BIRDASH_ALERT_BACKLOG:   v => !isNaN(v) && v >= 1 && v <= 1000,
  BIRDASH_ALERT_NO_DET_H:  v => !isNaN(v) && v >= 1 && v <= 168,
  BIRDASH_ALERT_ON_TEMP:      v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_TEMP_CRIT: v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_DISK:      v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_RAM:       v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_BACKLOG:   v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_NO_DET:    v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_INFLUX:    v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_MISSING:   v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_RARE_VISITOR: v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_SVC_DOWN: v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_SOUND:            v => v == 0 || v == 1,
  BIRDASH_ALERT_SOUND_LOW_DBFS:      v => !isNaN(v) && v >= -120 && v <= 0,
  BIRDASH_ALERT_SOUND_HIGH_DBFS:     v => !isNaN(v) && v >= -60 && v <= 0,
  BIRDASH_ALERT_SOUND_SUSTAINED_MIN: v => !isNaN(v) && v >= 1 && v <= 120,
  IMAGE_PROVIDER:  v => ['WIKIPEDIA','FLICKR'].includes(v),
  RARE_SPECIES_THRESHOLD: v => !isNaN(v) && v >= 1 && v <= 365,
  RAW_SPECTROGRAM: v => v == 0 || v == 1,
  DATA_MODEL_VERSION: v => v == 1 || v == 2,
  AUTH_MODE:           v => ['off', 'protected', 'public-read'].includes(v),
  AUTH_USERNAME:       v => typeof v === 'string' && v.length >= 1 && v.length <= 64 && /^[A-Za-z0-9_.\-]+$/.test(v),
  AUTH_PASSWORD_HASH:  v => typeof v === 'string' && v.length <= 200,
  AUTH_SECRET:         v => typeof v === 'string' && /^[a-f0-9]{32,128}$/.test(v),
  AUTH_SESSION_HOURS:  v => !isNaN(v) && v >= 1 && v <= 720,
  RANGE_FILTER_PERCH_EBIRD: v => v == 0 || v == 1,
  PRIVACY_FILTER_ENABLED:    v => v == 0 || v == 1,
  PRIVACY_FILTER_THRESHOLD:  v => !isNaN(v) && v >= 0.05 && v <= 0.95,
  PRIVACY_FILTER_DELETE_AUDIO: v => v == 0 || v == 1,
  DOG_FILTER_ENABLED:        v => v == 0 || v == 1,
  DOG_FILTER_THRESHOLD:      v => !isNaN(v) && v >= 0.05 && v <= 0.95,
  DOG_FILTER_COOLDOWN_SEC:   v => !isNaN(v) && v >= 0 && v <= 600,
};

// ── Apprise binary discovery (cached at startup) ─────────────────────────
const _appriseCandidates = [
  path.join(process.env.HOME || '', 'birdash', 'engine', 'venv', 'bin', 'apprise'),
  path.join(process.env.HOME || '', 'birdengine', 'venv', 'bin', 'apprise'),
  '/usr/local/bin/apprise',
  '/usr/bin/apprise',
];
const APPRISE_BIN = _appriseCandidates.find(p => fs.existsSync(p)) || 'apprise';
if (APPRISE_BIN !== 'apprise') console.log(`[config] Apprise binary: ${APPRISE_BIN}`);

// ── Shared JSON file reader ───────────────────────────────────────────────
function readJsonFile(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

module.exports = {
  BIRDNET_CONF, BIRDNET_DIR, ALLOWED_SERVICES, SETTINGS_VALIDATORS, APPRISE_BIN,
  parseBirdnetConf, writeBirdnetConf, execCmd, readJsonFile,
};
