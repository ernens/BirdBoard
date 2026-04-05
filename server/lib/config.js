'use strict';
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const { spawn } = require('child_process');

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

async function writeBirdnetConf(updates) {
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
  const tmpFile = '/tmp/birdnet.conf.tmp';
  await fsp.writeFile(tmpFile, result.join('\n'));
  await execCmd('sudo', ['cp', tmpFile, BIRDNET_CONF]);
  await fsp.unlink(tmpFile).catch(() => {});
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

const ALLOWED_SERVICES = ['birdengine', 'birdengine-recording', 'birdash', 'caddy', 'ttyd'];

const SETTINGS_VALIDATORS = {
  SITE_NAME:       v => typeof v === 'string' && v.length <= 100,
  SITE_BRAND:      v => typeof v === 'string' && v.length <= 50,
  LATITUDE:        v => !isNaN(v) && v >= -90 && v <= 90,
  LONGITUDE:       v => !isNaN(v) && v >= -180 && v <= 180,
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
  REC_CARD:        v => typeof v === 'string' && v.length <= 200,
  RTSP_STREAM:     v => typeof v === 'string' && v.length <= 500,
  APPRISE_NOTIFY_EACH_DETECTION: v => v == 0 || v == 1,
  APPRISE_NOTIFY_NEW_SPECIES: v => v == 0 || v == 1,
  APPRISE_NOTIFY_NEW_SPECIES_EACH_DAY: v => v == 0 || v == 1,
  APPRISE_WEEKLY_REPORT: v => v == 0 || v == 1,
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
  IMAGE_PROVIDER:  v => ['WIKIPEDIA','FLICKR'].includes(v),
  RARE_SPECIES_THRESHOLD: v => !isNaN(v) && v >= 1 && v <= 365,
  RAW_SPECTROGRAM: v => v == 0 || v == 1,
  DATA_MODEL_VERSION: v => v == 1 || v == 2,
};

module.exports = {
  BIRDNET_CONF, BIRDNET_DIR, ALLOWED_SERVICES, SETTINGS_VALIDATORS,
  parseBirdnetConf, writeBirdnetConf, execCmd,
};
