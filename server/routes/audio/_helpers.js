'use strict';
/**
 * audio/_helpers — shared utilities for the audio sub-routes.
 *
 * Anything used by more than one module under server/routes/audio/ lives
 * here. Single-use helpers stay in their own module to keep this file
 * small and the call graph local.
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const safeConfig = require('../../lib/safe-config');
const { readJsonFile } = require('../../lib/config');

const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');

const AUDIO_RATE = 48000;

const AUDIO_CONFIG_PATH    = path.join(PROJECT_ROOT, 'config', 'audio_config.json');
const AUDIO_PROFILES_PATH  = path.join(PROJECT_ROOT, 'config', 'audio_profiles.json');
const AG_CONFIG_PATH       = path.join(PROJECT_ROOT, 'config', 'adaptive_gain.json');
const AUDIO_CFG_EXAMPLE    = path.join(PROJECT_ROOT, 'config', 'audio_config.example.json');

// Whitelisted keys for /api/audio/config and /api/audio/adaptive-gain/config.
// Any key not in the whitelist is silently dropped on POST — important to
// keep clients from injecting arbitrary fields into the config files.
const AUDIO_KEYS = ['device_id','device_name','input_channels','capture_sample_rate','bit_depth',
  'output_sample_rate','channel_strategy','hop_size_s','highpass_enabled','highpass_cutoff_hz',
  'lowpass_enabled','lowpass_cutoff_hz','denoise_enabled','denoise_strength',
  'noise_profile_enabled','noise_profile_path',
  'rms_normalize','rms_target','cal_gain_ch0','cal_gain_ch1','cal_date','profile_name'];

const AG_KEYS = ['enabled','mode','observer_only','min_db','max_db','step_up_db','step_down_db',
  'update_interval_s','history_s','noise_percentile','target_floor_dbfs','clip_guard_dbfs','activity_hold_s'];

/**
 * GET handler for any JSON config file. Reads, optionally merges defaults,
 * and writes the response.
 */
function jsonConfigGet(res, filePath, defaults) {
  const cfg = readJsonFile(filePath);
  const merged = defaults ? { ...defaults, ...(cfg || {}) } : (cfg || {});
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(merged));
}

/**
 * POST handler for any JSON config file. Reads body, filters against
 * `whitelist`, merges via safe-config (per-file mutex + atomic write),
 * then optionally invokes `afterSave(merged, filtered)` for side effects.
 *
 * Never call fs.writeFile directly from a route — that defeats the lock
 * and re-introduces lost-update races (mickey.local 2026-04-11 corruption
 * of engine/config.toml).
 */
function jsonConfigPost(req, res, filePath, whitelist, afterSave, label) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const updates = JSON.parse(body);
      const filtered = {};
      for (const k of Object.keys(updates)) {
        if (whitelist.includes(k)) filtered[k] = updates[k];
      }
      if (Object.keys(filtered).length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No valid config keys provided' }));
        return;
      }
      const next = await safeConfig.updateConfig(
        filePath,
        (current) => Object.assign(current, filtered),
        null,
        { label: label || `POST ${path.basename(filePath)}`, defaultValue: {} }
      );
      if (afterSave) afterSave(next, filtered);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, config: next }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

/**
 * Recursively scan SONGS_DIR for MP3 files modified in the last 48 h, sorted
 * chronologically. Used by /api/audio-stream for live playback of recent
 * detections.
 */
async function getRecentMp3s(songsDir) {
  const files  = [];
  const cutoff = Date.now() - 48 * 3600 * 1000;
  for (let daysAgo = 0; daysAgo <= 1; daysAgo++) {
    const d = new Date(Date.now() - daysAgo * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    const dayDir  = path.join(songsDir, dateStr);
    let species;
    try { species = await fsp.readdir(dayDir); } catch(e) { continue; }
    for (const sp of species) {
      const spDir = path.join(dayDir, sp);
      let entries;
      try { entries = await fsp.readdir(spDir); } catch(e) { continue; }
      for (const f of entries) {
        if (!f.endsWith('.mp3')) continue;
        const fp = path.join(spDir, f);
        try {
          const { mtimeMs } = await fsp.stat(fp);
          if (mtimeMs >= cutoff) files.push({ path: fp, mtime: mtimeMs });
        } catch(e) {}
      }
    }
  }
  return files.sort((a, b) => a.mtime - b.mtime);
}

// Softvol "Boost" hardware control discovery — parses `amixer sget Boost`
// to find which capture card hosts the control installed by migration
// 001-asoundrc-dsnoop-plug. The min/max dB range mirrors that .asoundrc
// template so the UI doesn't need to parse .asoundrc itself.
const BOOST_MIN_DB = -5;
const BOOST_MAX_DB = 30;
function readBoost() {
  const { execSync } = require('child_process');
  let cards = [];
  try {
    const out = execSync('arecord -l 2>/dev/null || true', { encoding: 'utf8' });
    const re = /card (\d+):/g;
    let m;
    while ((m = re.exec(out)) !== null) cards.push(parseInt(m[1]));
  } catch {}
  for (const c of cards) {
    try {
      const out = execSync(`amixer -c ${c} sget Boost 2>/dev/null`, { encoding: 'utf8' });
      const valM = out.match(/:\s*(\d+)\s*\[\d+%\]\s*\[(-?[\d.]+)dB\]/);
      const limM = out.match(/Limits:\s*(\d+)\s*-\s*(\d+)/);
      if (valM) {
        return {
          available: true,
          card: c,
          raw: parseInt(valM[1]),
          db: parseFloat(valM[2]),
          raw_max: limM ? parseInt(limM[2]) : 255,
          min_db: BOOST_MIN_DB,
          max_db: BOOST_MAX_DB,
        };
      }
    } catch {}
  }
  return { available: false, min_db: BOOST_MIN_DB, max_db: BOOST_MAX_DB };
}

module.exports = {
  PROJECT_ROOT, AUDIO_RATE,
  AUDIO_CONFIG_PATH, AUDIO_PROFILES_PATH, AG_CONFIG_PATH, AUDIO_CFG_EXAMPLE,
  AUDIO_KEYS, AG_KEYS,
  jsonConfigGet, jsonConfigPost, getRecentMp3s, readBoost,
  BOOST_MIN_DB, BOOST_MAX_DB,
};
