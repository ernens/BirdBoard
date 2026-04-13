'use strict';
/**
 * Audio routes — audio info, streaming, devices, config, profiles,
 * calibration, monitoring, adaptive gain, live-stream, filter-preview.
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const AUDIO_RATE = 48000;

// ── Adaptive gain system ──────────────────────────────────────────────────
const AG_DEFAULTS = {
  enabled: false, mode: 'balanced', observer_only: true,
  min_db: -6, max_db: 9, step_up_db: 0.5, step_down_db: 1.5,
  update_interval_s: 10, history_s: 30, noise_percentile: 20,
  target_floor_dbfs: -42, clip_guard_dbfs: -3, activity_hold_s: 15,
};
const _agState = {
  current_gain_db: 0, recommended_gain_db: 0, last_update_ts: 0, hold_until_ts: 0,
  noise_floor_dbfs: null, activity_dbfs: null, peak_dbfs: null,
  reason: 'init', history: [],
};
function _agPercentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a,b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p / 100 * s.length)))];
}
function _agClamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function agPushSample(rms_dbfs, peak_dbfs) {
  _agState.history.push({ ts: Date.now(), rms_dbfs, peak_dbfs });
  if (_agState.history.length > 2000) _agState.history.splice(0, _agState.history.length - 1500);
}
function agUpdate(cfg) {
  const c = { ...AG_DEFAULTS, ...cfg };
  const now = Date.now();
  if (!c.enabled) { _agState.reason = 'disabled'; return _agState; }
  const windowMs = c.history_s * 1000;
  _agState.history = _agState.history.filter(x => now - x.ts <= windowMs);
  if (_agState.history.length < 5) { _agState.reason = 'not_enough_data'; return _agState; }
  const rms = _agState.history.map(x => x.rms_dbfs).filter(Number.isFinite);
  const peaks = _agState.history.map(x => x.peak_dbfs).filter(Number.isFinite);
  if (!rms.length || !peaks.length) { _agState.reason = 'invalid'; return _agState; }
  const nf = _agPercentile(rms, c.noise_percentile);
  const act = _agPercentile(rms, 80);
  const pk = Math.max(...peaks);
  _agState.noise_floor_dbfs = Math.round(nf * 10) / 10;
  _agState.activity_dbfs = Math.round(act * 10) / 10;
  _agState.peak_dbfs = Math.round(pk * 10) / 10;
  if (pk >= c.clip_guard_dbfs) {
    _agState.recommended_gain_db = _agClamp(_agState.recommended_gain_db - c.step_down_db, c.min_db, c.max_db);
    _agState.reason = 'clip_guard';
  } else if ((act - nf) >= 10) {
    _agState.hold_until_ts = now + c.activity_hold_s * 1000;
    _agState.reason = 'activity_hold';
  } else if (now < _agState.hold_until_ts) {
    _agState.reason = 'activity_hold';
  } else {
    const desired = _agClamp(c.target_floor_dbfs - nf, c.min_db, c.max_db);
    if (desired > _agState.recommended_gain_db) {
      _agState.recommended_gain_db = Math.min(_agState.recommended_gain_db + c.step_up_db, desired);
      _agState.reason = 'step_up';
    } else if (desired < _agState.recommended_gain_db) {
      _agState.recommended_gain_db = Math.max(_agState.recommended_gain_db - c.step_down_db, desired);
      _agState.reason = 'step_down';
    } else { _agState.reason = 'stable'; }
  }
  _agState.recommended_gain_db = Math.round(_agClamp(_agState.recommended_gain_db, c.min_db, c.max_db) * 10) / 10;
  if (!c.observer_only) _agState.current_gain_db = _agState.recommended_gain_db;
  else _agState.reason = 'observer';
  _agState.last_update_ts = now;
  return _agState;
}

// --- Shared JSON helpers
//
// Reads use a synchronous helper. Writes go through safe-config (per-file
// mutex + atomic rename + validation). Never call fs.writeFile directly
// from this module — that defeats the lock and re-introduces lost-update
// races (see mickey.local 2026-04-11 corruption of engine/config.toml).
const safeConfig = require('../lib/safe-config');
function readJsonFile(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }

/**
 * Generic JSON config GET handler.
 * @param {object} res - HTTP response
 * @param {string} filePath - path to JSON config file
 * @param {object} [defaults] - default values to merge (returned even if file missing)
 */
function jsonConfigGet(res, filePath, defaults) {
  const cfg = readJsonFile(filePath);
  const merged = defaults ? { ...defaults, ...(cfg || {}) } : (cfg || {});
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(merged));
}

/**
 * Generic JSON config POST handler.
 * Reads body, filters against whitelist, merges with existing file, writes
 * via safe-config (per-file mutex + atomic write).
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response
 * @param {string} filePath - path to JSON config file
 * @param {string[]} whitelist - allowed keys
 * @param {function} [afterSave] - optional callback(current, filtered) called after write
 * @param {string} [label] - log label (e.g. route name)
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

// --- Config key whitelists (shared between routes)
const AUDIO_KEYS = ['device_id','device_name','input_channels','capture_sample_rate','bit_depth',
  'output_sample_rate','channel_strategy','hop_size_s','highpass_enabled','highpass_cutoff_hz',
  'lowpass_enabled','lowpass_cutoff_hz','denoise_enabled','denoise_strength',
  'noise_profile_enabled','noise_profile_path',
  'rms_normalize','rms_target','cal_gain_ch0','cal_gain_ch1','cal_date','profile_name'];
const AG_KEYS = ['enabled','mode','observer_only','min_db','max_db','step_up_db','step_down_db',
  'update_interval_s','history_s','noise_percentile','target_floor_dbfs','clip_guard_dbfs','activity_hold_s'];


// ── Recent MP3 scanner ────────────────────────────────────────────────────
// (needs SONGS_DIR from ctx, so we wrap it)
let _SONGS_DIR = null; // set on first handle() call

async function getRecentMp3s() {
  const files  = [];
  const cutoff = Date.now() - 48 * 3600 * 1000;

  for (let daysAgo = 0; daysAgo <= 1; daysAgo++) {
    const d = new Date(Date.now() - daysAgo * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    const dayDir  = path.join(_SONGS_DIR, dateStr);
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
  // Tri chronologique
  return files.sort((a, b) => a.mtime - b.mtime);
}

function handle(req, res, pathname, ctx) {
  const { requireAuth, readJsonFile, JSON_CT, SONGS_DIR } = ctx;
  if (!_SONGS_DIR) _SONGS_DIR = SONGS_DIR;


  // ── Route : GET /api/audio-info?file=FileName.mp3 ───────────────────────
  // Returns metadata about an audio file (size, type, duration, channels, sample rate)
  if (req.method === 'GET' && pathname === '/api/audio-info') {
    const fileName = new URL(req.url, 'http://localhost').searchParams.get('file');
    if (!fileName) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"missing file param"}'); return;
    }
    const m = fileName.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
    if (!m) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"invalid filename format"}'); return;
    }
    const species = m[1], date = m[2];
    const filePath = path.join(SONGS_DIR, date, species, fileName);
    // Path traversal guard
    if (!filePath.startsWith(SONGS_DIR)) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"invalid path"}'); return;
    }

    (async () => {
      try {
        const stat = await fsp.stat(filePath);
        const ext = path.extname(fileName).replace('.', '').toUpperCase();
        const info = {
          size: stat.size,
          type: ext || 'UNKNOWN',
          path: `BirdSongs/Extracted/By_Date/${date}/${species}/${fileName}`,
        };
        // Use ffprobe if available
        try {
          const probeData = await new Promise((resolve, reject) => {
            const ff = spawn('ffprobe', [
              '-v', 'quiet', '-print_format', 'json',
              '-show_format', '-show_streams', filePath
            ]);
            let out = '', done = false;
            ff.stdout.on('data', d => out += d);
            ff.on('close', code => { if (!done) { done = true; clearTimeout(timer); code === 0 ? resolve(JSON.parse(out)) : reject(new Error('ffprobe ' + code)); } });
            ff.on('error', e => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
            const timer = setTimeout(() => { if (!done) { done = true; try { ff.kill(); } catch{} reject(new Error('timeout')); } }, 5000);
          });
          const stream = probeData.streams && probeData.streams.find(s => s.codec_type === 'audio');
          if (stream) {
            info.sample_rate = parseInt(stream.sample_rate) || null;
            info.channels = parseInt(stream.channels) || null;
          }
          if (probeData.format && probeData.format.duration) {
            info.duration = parseFloat(probeData.format.duration);
          }
        } catch (e) { /* ffprobe not available */ }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(info));
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'file not found' }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/audio-stream ────────────────────────────────────────
  // Décode les MP3 BirdNET récents en PCM S16LE et les chaîne en continu.
  // Zéro conflit avec BirdNET — on lit des fichiers, pas le micro.
  if (req.method === 'GET' && pathname === '/api/audio-stream') {

    res.setHeader('Content-Type',       'application/octet-stream');
    res.setHeader('X-Audio-Encoding',   'pcm_s16le');
    res.setHeader('X-Audio-SampleRate', String(AUDIO_RATE));
    res.setHeader('X-Audio-Channels',   '1');
    res.setHeader('Cache-Control',      'no-cache, no-store');
    res.setHeader('Transfer-Encoding',  'chunked');
    res.writeHead(200);

    let aborted  = false;
    let currentFf = null;
    req.on('close', () => {
      aborted = true;
      if (currentFf) try { currentFf.kill(); } catch(e) {}
    });

    // Boucle async : enchaîne les fichiers MP3 en PCM
    (async () => {
      const streamed = new Set();

      // Trouver le point de départ : commencer 3 minutes en arrière
      // pour avoir immédiatement du signal à l'affichage
      const startCutoff = Date.now() - 3 * 60 * 1000;

      // Marquer les fichiers trop anciens comme déjà "streamés"
      const allFiles = await getRecentMp3s();
      for (const f of allFiles) {
        if (f.mtime < startCutoff) streamed.add(f.path);
      }
      console.log(`[audio-stream] démarrage — ${streamed.size} fichiers anciens ignorés`);

      while (!aborted) {
        const pending = (await getRecentMp3s()).filter(f => !streamed.has(f.path));

        if (pending.length === 0) {
          // Aucun fichier nouveau — attendre 2s
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const file = pending[0];
        streamed.add(file.path);
        console.log(`[audio-stream] → ${path.basename(file.path)}`);

        // Décoder MP3 → PCM S16LE via ffmpeg
        await new Promise((resolve) => {
          const ff = spawn('ffmpeg', [
            '-loglevel', 'quiet',
            '-i', file.path,
            '-f', 's16le',
            '-ar', String(AUDIO_RATE),
            '-ac', '1',
            'pipe:1',
          ]);
          currentFf = ff;

          ff.stdout.pipe(res, { end: false });
          ff.stdout.on('end', () => { currentFf = null; resolve(); });
          ff.on('error', err => {
            console.error('[ffmpeg]', err.message);
            currentFf = null;
            resolve();
          });
          // Outer req.on('close') at line 1549 handles cleanup via aborted flag
        });
      }

      if (!res.writableEnded) res.end();
      console.log('[audio-stream] connexion fermée');
    })();

    return true;
  }


  const AUDIO_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'audio_config.json');
  const AUDIO_PROFILES_PATH = path.join(PROJECT_ROOT, 'config', 'audio_profiles.json');
  const AG_CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'adaptive_gain.json');

  // ── Route : GET /api/audio/adaptive-gain/state ───────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/adaptive-gain/state') {
    const cfg = readJsonFile(AG_CONFIG_PATH) || AG_DEFAULTS;
    agUpdate(cfg);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, state: { ..._agState, history_count: _agState.history.length }, config: { ...AG_DEFAULTS, ...cfg } }));
    return true;
  }

  // ── Route : GET /api/audio/adaptive-gain/config ─────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/adaptive-gain/config') {
    jsonConfigGet(res, AG_CONFIG_PATH, AG_DEFAULTS);
    return true;
  }

  // ── Route : POST /api/audio/adaptive-gain/config ────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/adaptive-gain/config') {
    if (!requireAuth(req, res)) return true;
    jsonConfigPost(req, res, AG_CONFIG_PATH, AG_KEYS, (current) => {
      // Background interval (_agBgInterval) auto-starts/stops collector every 30s
      // For immediate effect, trigger now
      if (current.enabled && !_agBgProc) _agBgStart();
      else if (!current.enabled && _agBgProc) _agBgStop();
    });
    return true;
  }

  // ── Route : GET /api/audio/config ───────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/config') {
    jsonConfigGet(res, AUDIO_CONFIG_PATH);
    return true;
  }

  // ── Route : POST /api/audio/config ──────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/config') {
    if (!requireAuth(req, res)) return true;
    const oldDevice = (readJsonFile(AUDIO_CONFIG_PATH) || {}).device_id;
    jsonConfigPost(req, res, AUDIO_CONFIG_PATH, AUDIO_KEYS, async (current, filtered) => {
      // When device changes, generate ALSA dsnoop config for shared access
      if (filtered.device_id && filtered.device_id !== oldDevice) {
        try {
          const devId = filtered.device_id;
          let cardName = '';
          const hwMatch = devId.match(/CARD=(\w+)/);
          if (hwMatch) cardName = hwMatch[1];
          else {
            const { execSync } = require('child_process');
            const arecordOut = execSync('arecord -l 2>/dev/null', { encoding: 'utf8' });
            const cardMatch = arecordOut.match(/card \d+: (\w+) \[/);
            if (cardMatch) cardName = cardMatch[1];
          }
          if (cardName) {
            const channels = current.input_channels || 2;
            const rate = current.capture_sample_rate || 48000;
            const asoundrc = `# Auto-generated by Birdash for ${current.device_name || cardName}\n` +
              `pcm.birdash {\n    type dsnoop\n    ipc_key 2048\n    slave {\n` +
              `        pcm "hw:CARD=${cardName},DEV=0"\n        channels ${channels}\n` +
              `        rate ${rate}\n    }\n}\n`;
            await safeConfig.writeRaw(path.join(process.env.HOME, '.asoundrc'), asoundrc, { label: 'POST /api/audio/config (asoundrc)' });
            await safeConfig.updateConfig(
              AUDIO_CONFIG_PATH,
              (cfg) => { cfg.device_id = 'birdash'; return cfg; },
              null,
              { label: 'POST /api/audio/config (device→birdash)', defaultValue: {} }
            );
            console.log(`[audio] ALSA dsnoop config generated for ${cardName}`);
            try { require('child_process').exec('sudo systemctl restart birdengine-recording'); } catch {}
          }
        } catch (e) {
          console.warn('[audio] ALSA config generation failed:', e.message);
        }
      }
    }, 'POST /api/audio/config');
    return true;
  }

  // ── Route : GET /api/audio/profiles ─────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/profiles') {
    const profiles = readJsonFile(AUDIO_PROFILES_PATH) || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ profiles }));
    return true;
  }

  // ── Route : POST /api/audio/profiles ────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/profiles') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const raw = JSON.parse(body);
        if (!raw.profile_name) throw new Error('profile_name required');
        const PROFILE_KEYS = ['profile_name','highpass_enabled','highpass_cutoff_hz',
          'lowpass_enabled','lowpass_cutoff_hz','denoise_enabled','denoise_strength',
          'hop_size_s','channel_strategy','rms_normalize','rms_target'];
        const profile = { profile_name: raw.profile_name };
        for (const k of PROFILE_KEYS) { if (k in raw) profile[k] = raw[k]; }
        await safeConfig.updateConfig(
          AUDIO_PROFILES_PATH,
          (profiles) => {
            if (profiles[profile.profile_name]?.builtin) throw new Error('Cannot overwrite builtin profile');
            profiles[profile.profile_name] = { ...profile, builtin: false };
            return profiles;
          },
          null,
          { label: 'POST /api/audio/profiles', defaultValue: {} }
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // ── Route : POST /api/audio/profiles/activate ───────────────────────────
  if (req.method === 'POST' && pathname.match(/^\/api\/audio\/profiles\/(.+)\/activate$/)) {
    if (!requireAuth(req, res)) return true;
    const name = decodeURIComponent(pathname.match(/^\/api\/audio\/profiles\/(.+)\/activate$/)[1]);
    (async () => {
      try {
        const profiles = readJsonFile(AUDIO_PROFILES_PATH) || {};
        if (!profiles[name]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Profile '${name}' not found` }));
          return;
        }
        const p = profiles[name];
        const patch = { profile_name: name };
        for (const k of ['channel_strategy','hop_size_s','highpass_enabled','highpass_cutoff_hz',
          'lowpass_enabled','lowpass_cutoff_hz','denoise_enabled','denoise_strength',
          'rms_normalize','rms_target']) {
          if (p[k] !== undefined) patch[k] = p[k];
        }
        const next = await safeConfig.updateConfig(
          AUDIO_CONFIG_PATH,
          (config) => Object.assign(config, patch),
          null,
          { label: 'POST /api/audio/profiles/activate', defaultValue: {} }
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, config: next }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : DELETE /api/audio/profiles/:name ────────────────────────────
  if (req.method === 'DELETE' && pathname.startsWith('/api/audio/profiles/')) {
    if (!requireAuth(req, res)) return true;
    const name = decodeURIComponent(pathname.replace('/api/audio/profiles/', ''));
    (async () => {
      try {
        await safeConfig.updateConfig(
          AUDIO_PROFILES_PATH,
          (profiles) => {
            if (profiles[name]?.builtin) throw new Error('Cannot delete builtin profile');
            delete profiles[name];
            return profiles;
          },
          null,
          { label: 'DELETE /api/audio/profiles', defaultValue: {} }
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        const status = /builtin/.test(e.message) ? 400 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/audio/calibration/start ───────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/calibration/start') {
    if (!requireAuth(req, res)) return true;
    (async () => {
      try {
        const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
        const device = config.device_id || 'default';
        const duration = 10;
        // Record 10s stereo WAV for calibration
        const tmpFile = '/tmp/birdash_calibration.wav';
        await new Promise((resolve, reject) => {
          const proc = require('child_process').spawn('arecord', [
            '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', '2',
            '-d', String(duration), tmpFile
          ]);
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`arecord exit ${code}`)));
          proc.on('error', reject);
          setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, (duration + 5) * 1000);
        });
        // Analyze RMS per channel using ffmpeg
        const analyzeChannel = async (ch) => {
          return new Promise((resolve) => {
            const ff = require('child_process').spawn('ffmpeg', [
              '-i', tmpFile, '-af', `pan=mono|c0=c${ch},astats=metadata=1:reset=0`, '-f', 'null', '-'
            ], { stdio: ['pipe', 'pipe', 'pipe'] });
            let output = '';
            ff.stderr.on('data', d => output += d);
            ff.on('close', () => {
              const m = output.match(/RMS level dB:\s*([-\d.]+)/);
              resolve(m ? parseFloat(m[1]) : -60);
            });
          });
        };
        const rms0 = await analyzeChannel(0);
        const rms1 = await analyzeChannel(1);
        const diffDb = Math.abs(rms0 - rms1);
        // Calculate gain compensation (reference = louder channel)
        let gain0 = 1.0, gain1 = 1.0;
        if (rms0 < rms1) {
          gain0 = Math.pow(10, (rms1 - rms0) / 20);
        } else {
          gain1 = Math.pow(10, (rms0 - rms1) / 20);
        }
        const result = {
          rms_ch0_db: Math.round(rms0 * 10) / 10,
          rms_ch1_db: Math.round(rms1 * 10) / 10,
          diff_db: Math.round(diffDb * 10) / 10,
          gain_ch0: Math.round(gain0 * 1000) / 1000,
          gain_ch1: Math.round(gain1 * 1000) / 1000,
          status: diffDb < 1 ? 'excellent' : diffDb < 3 ? 'normal' : 'warning',
          message: diffDb < 1
            ? 'Excellente correspondance. Calibration non nécessaire.'
            : diffDb < 3
            ? 'Écart normal entre capsules. Calibration appliquée.'
            : 'Écart important détecté. Vérifiez le câblage et le placement.',
        };
        // Clean up
        try { fs.unlinkSync(tmpFile); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/audio/calibration/apply ───────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/calibration/apply') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { gain_ch0, gain_ch1 } = JSON.parse(body);
        const next = await safeConfig.updateConfig(
          AUDIO_CONFIG_PATH,
          (config) => {
            config.cal_gain_ch0 = gain_ch0;
            config.cal_gain_ch1 = gain_ch1;
            config.cal_date = new Date().toISOString();
            return config;
          },
          null,
          { label: 'POST /api/audio/calibration/apply', defaultValue: {} }
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, config: next }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // ── Route : GET /api/audio/monitor ──────────────────────────────────────
  // SSE stream for real-time audio levels using arecord + raw PCM analysis
  if (req.method === 'GET' && pathname === '/api/audio/monitor') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    const device = config.device_id || 'default';
    const channels = config.input_channels || 2;
    const sampleRate = 48000;
    // Stream raw PCM from arecord and compute RMS in Node.js
    const proc = require('child_process').spawn('arecord', [
      '-D', device, '-f', 'S16_LE', '-r', String(sampleRate),
      '-c', String(channels), '-t', 'raw',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const bytesPerSample = 2; // S16_LE
    const chunkDuration = 0.5; // 500ms
    const chunkBytes = sampleRate * channels * bytesPerSample * chunkDuration;
    let buffer = Buffer.alloc(0);

    proc.stdout.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= chunkBytes) {
        const chunk = buffer.subarray(0, chunkBytes);
        buffer = buffer.subarray(chunkBytes);
        // Compute RMS per channel
        const samplesPerChannel = (chunkBytes / bytesPerSample) / channels;
        const rms = [0, 0];
        let peak = [0, 0];
        for (let i = 0; i < chunkBytes; i += bytesPerSample * channels) {
          for (let ch = 0; ch < channels; ch++) {
            const offset = i + ch * bytesPerSample;
            if (offset + 1 < chunk.length) {
              const sample = chunk.readInt16LE(offset) / 32768.0;
              rms[ch] += sample * sample;
              const abs = Math.abs(sample);
              if (abs > peak[ch]) peak[ch] = abs;
            }
          }
        }
        const rms0db = rms[0] > 0 ? Math.round(10 * Math.log10(rms[0] / samplesPerChannel) * 10) / 10 : -60;
        const peak0db = peak[0] > 0 ? Math.round(20 * Math.log10(peak[0]) * 10) / 10 : -60;
        // Feed adaptive gain system
        agPushSample(rms0db, peak0db);
        const event = {
          ch0_rms_db: rms0db,
          ch1_rms_db: channels > 1 && rms[1] > 0 ? Math.round(10 * Math.log10(rms[1] / samplesPerChannel) * 10) / 10 : -60,
          clipping_ch0: peak[0] > 0.99,
          clipping_ch1: peak[1] > 0.99,
          timestamp: Date.now(),
        };
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });
    proc.stderr.on('data', () => {}); // ignore arecord stderr
    proc.on('close', () => { try { res.end(); } catch {} });
    req.on('close', () => { proc.kill(); });
    return true;
  }

  // ── Route : GET /api/audio/live-stream ───────────────────────────────────
  // Continuous MP3 stream from mic for live spectrogram
  if (req.method === 'GET' && pathname === '/api/live-stream') {
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    const device = config.device_id || 'default';

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked',
    });
    // CORS already set globally via getCorsOrigin()

    // arecord → ffmpeg (mp3 encode) → HTTP response
    const proc = require('child_process').spawn('ffmpeg', [
      '-f', 'alsa', '-ac', '2', '-ar', '48000', '-i', device,
      '-acodec', 'libmp3lame', '-b:a', '128k', '-ac', '1', '-ar', '48000', '-af', 'volume=3',
      '-f', 'mp3', '-fflags', '+nobuffer', '-flush_packets', '1',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stdout.on('data', (chunk) => {
      try { res.write(chunk); } catch {}
    });
    proc.stderr.on('data', () => {}); // ignore ffmpeg logs
    proc.on('close', () => { try { res.end(); } catch {} });
    req.on('close', () => { proc.kill(); });
    return true;
  }

  // ── Route : GET /api/live-pcm ────────────────────────────────────────────
  // Raw PCM stream (16-bit LE, mono, 24kHz) for live spectrogram
  if (req.method === 'GET' && pathname === '/api/live-pcm') {
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    const device = config.device_id || 'default';

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked',
    });

    // ffmpeg: capture from ALSA → mono 48kHz → raw PCM out
    const proc = require('child_process').spawn('ffmpeg', [
      '-f', 'alsa', '-ac', '2', '-ar', '48000', '-i', device,
      '-ac', '1', '-ar', '48000', '-af', 'volume=3', '-f', 's16le',
      '-fflags', '+nobuffer', '-flush_packets', '1',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    proc.stdout.on('data', (chunk) => {
      try { res.write(chunk); } catch {}
    });
    proc.stderr.on('data', () => {});
    proc.on('close', () => { try { res.end(); } catch {} });
    req.on('close', () => { proc.kill(); });
    return true;
  }

  // ── Route : POST /api/audio/noise-profile/record ─────────────────────────
  // Record 5s of ambient noise and save as WAV for spectral subtraction.
  // The user should ensure no birds are singing during recording.
  if (req.method === 'POST' && pathname === '/api/audio/noise-profile/record') {
    (async () => {
      try {
        const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
        const device = config.device_id || 'default';
        const channels = config.input_channels || 2;
        const profilePath = path.join(PROJECT_ROOT, 'config', 'noise_profile.wav');

        // Record 5 seconds of ambient noise
        await new Promise((resolve, reject) => {
          const proc = require('child_process').spawn('arecord', [
            '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', String(channels),
            '-d', '5', profilePath
          ]);
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`arecord exit ${code}`)));
          proc.on('error', reject);
          setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 10000);
        });

        // Update audio config to enable noise profile
        const safeConfig = require('../lib/safe-config');
        await safeConfig.updateConfig(AUDIO_CONFIG_PATH, cfg => {
          cfg.noise_profile_enabled = true;
          cfg.noise_profile_path = profilePath;
          return cfg;
        });

        const stat = fs.statSync(profilePath);
        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({
          ok: true,
          path: profilePath,
          size: stat.size,
          date: new Date().toISOString(),
        }));
      } catch (e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/audio/noise-profile/status ───────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/noise-profile/status') {
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    const profilePath = config.noise_profile_path || path.join(PROJECT_ROOT, 'config', 'noise_profile.wav');
    const exists = fs.existsSync(profilePath);
    let stat = null;
    if (exists) try { stat = fs.statSync(profilePath); } catch {}
    res.writeHead(200, JSON_CT);
    res.end(JSON.stringify({
      enabled: !!config.noise_profile_enabled && exists,
      exists,
      path: profilePath,
      size: stat ? stat.size : 0,
      date: stat ? stat.mtime.toISOString() : null,
    }));
    return true;
  }

  // ── Route : DELETE /api/audio/noise-profile ────────────────────────────────
  if (req.method === 'DELETE' && pathname === '/api/audio/noise-profile') {
    (async () => {
      try {
        const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
        const profilePath = config.noise_profile_path || path.join(PROJECT_ROOT, 'config', 'noise_profile.wav');
        try { fs.unlinkSync(profilePath); } catch {}

        const safeConfig = require('../lib/safe-config');
        await safeConfig.updateConfig(AUDIO_CONFIG_PATH, cfg => {
          cfg.noise_profile_enabled = false;
          cfg.noise_profile_path = '';
          return cfg;
        });

        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/audio/filter-preview ───────────────────────────────
  // Record 3s, apply filters via Python, return before/after spectrograms
  if (req.method === 'POST' && pathname === '/api/audio/filter-preview') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const filterConf = JSON.parse(body);
          const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
          const device = config.device_id || 'default';
          const channels = config.input_channels || 2;
          const tmpWav = '/tmp/birdash_filter_preview.wav';

          // Record 3 seconds
          await new Promise((resolve, reject) => {
            const proc = require('child_process').spawn('arecord', [
              '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', String(channels),
              '-d', '3', tmpWav
            ]);
            proc.on('close', code => code === 0 ? resolve() : reject(new Error(`arecord exit ${code}`)));
            proc.on('error', reject);
            setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 8000);
          });

          // Run Python filter preview script — prefer the engine venv that
          // install.sh provisions alongside the repo, fall back to legacy path,
          // and finally to the system python.
          const scriptPath = path.join(PROJECT_ROOT, 'engine', 'filter_preview.py');
          const _engineVenvPy = path.join(PROJECT_ROOT, 'engine', 'venv', 'bin', 'python');
          const _legacyVenvPy = path.join(process.env.HOME || '', 'birdengine', 'venv', 'bin', 'python');
          const pyBin = fs.existsSync(_engineVenvPy) ? _engineVenvPy
                      : fs.existsSync(_legacyVenvPy) ? _legacyVenvPy
                      : 'python3';
          const result = await new Promise((resolve, reject) => {
            const proc = require('child_process').spawn(pyBin, [
              scriptPath, tmpWav, JSON.stringify(filterConf)
            ], { stdio: ['pipe', 'pipe', 'pipe'] });
            let stdout = '', stderr = '';
            proc.stdout.on('data', d => { stdout += d; });
            proc.stderr.on('data', d => { stderr += d; });
            proc.on('close', code => {
              if (code === 0) resolve(stdout);
              else reject(new Error(stderr || `python exit ${code}`));
            });
            proc.on('error', reject);
            setTimeout(() => { proc.kill(); reject(new Error('python timeout')); }, 90000);
          });

          try { fs.unlinkSync(tmpWav); } catch {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(result);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return true;
  }

  // ── Route : GET /api/audio/test ─────────────────────────────────────────
  // Capture 5s and return spectrogram as base64 PNG
  if (req.method === 'GET' && pathname === '/api/audio/test') {
    (async () => {
      try {
        const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
        const device = config.device_id || 'default';
        const tmpWav = '/tmp/birdash_audio_test.wav';
        const tmpPng = '/tmp/birdash_audio_test.png';
        // Record 5s
        await new Promise((resolve, reject) => {
          const proc = require('child_process').spawn('arecord', [
            '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', '2',
            '-d', '5', tmpWav
          ]);
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`arecord exit ${code}`)));
          proc.on('error', reject);
          setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 10000);
        });
        // Generate spectrogram
        await new Promise((resolve, reject) => {
          const ff = require('child_process').spawn('ffmpeg', [
            '-y', '-i', tmpWav, '-lavfi', 'showspectrumpic=s=800x400:legend=0:color=intensity',
            '-frames:v', '1', tmpPng
          ]);
          ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg ' + code)));
          ff.on('error', reject
          );
        });
        const png = fs.readFileSync(tmpPng);
        try { fs.unlinkSync(tmpWav); fs.unlinkSync(tmpPng); } catch {}
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(png);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }


  // ── Route : GET /api/audio/devices ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/devices') {
    (async () => {
      try {
        const { stdout } = await new Promise((resolve, reject) => {
          require('child_process').exec('arecord -l 2>/dev/null', (err, stdout, stderr) => {
            resolve({ stdout: stdout || '', stderr });
          });
        });
        const devices = [];
        const lines = stdout.split('\n');
        for (const line of lines) {
          const m = line.match(/^card (\d+): (\w+) \[(.+?)\], device (\d+): (.+)/);
          if (m) {
            const id = `hw:${m[1]},${m[3 + 1]}`;
            const name = m[3];
            const isUsb = /usb|rode|ai.?micro|scarlett|behringer|zoom|tascam|presonus/i.test(name);
            let channels = 2, rates = [];
            try {
              const { stdout: info } = await new Promise((resolve, reject) => {
                require('child_process').exec(
                  `arecord -D ${id} --dump-hw-params -d 0 2>&1 || true`,
                  { timeout: 3000 },
                  (err, stdout) => resolve({ stdout: stdout || '' })
                );
              });
              const chMatch = info.match(/CHANNELS\s*:.*?(\d+)/s);
              if (chMatch) channels = parseInt(chMatch[1]);
              const rateMatch = info.match(/RATE\s*:\s*(\d+)/);
              if (rateMatch) rates.push(parseInt(rateMatch[1]));
            } catch {}
            const cardName = m[2];
            const dsnoop_id = `dsnoop:CARD=${cardName},DEV=${m[4]}`;
            devices.push({
              id: dsnoop_id,
              hw_id: id,
              name,
              alsa_card: parseInt(m[1]),
              alsa_device: parseInt(m[4]),
              channels,
              sample_rates: rates.length ? rates : [48000],
              usb_audio: isUsb,
            });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ devices }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  return false;
}

// ── Background adaptive gain collector ────────────────────────────────────
// ── Module-level adaptive gain collector ──────────────────────────────────
const _AG_CFG_PATH = path.join(PROJECT_ROOT, 'config', 'adaptive_gain.json');
const _AG_AUDIO_CFG_PATH = path.join(PROJECT_ROOT, 'config', 'audio_config.json');
const _AG_AUDIO_CFG_EXAMPLE = path.join(PROJECT_ROOT, 'config', 'audio_config.example.json');
let _agBgProc = null, _agBgInterval = null;
function _agBgStart() {
  if (_agBgProc) return;
  try {
    // Create config from template if missing
    if (!fs.existsSync(_AG_AUDIO_CFG_PATH) && fs.existsSync(_AG_AUDIO_CFG_EXAMPLE)) {
      fs.copyFileSync(_AG_AUDIO_CFG_EXAMPLE, _AG_AUDIO_CFG_PATH);
      console.log('[adaptive-gain] Created audio_config.json from template');
    }
    if (!fs.existsSync(_AG_AUDIO_CFG_PATH)) { console.warn('[adaptive-gain] No audio_config.json — skipping'); return; }
    // Skip if recording service is running (would lock the device on mono USB cards)
    try {
      const { execSync } = require('child_process');
      const active = execSync('systemctl is-active birdengine-recording 2>/dev/null || true', { encoding: 'utf8' }).trim();
      if (active === 'active') { console.log('[adaptive-gain] Recording service active — skipping collector to avoid device conflict'); return; }
    } catch(e) {}
    const audioCfg = JSON.parse(fs.readFileSync(_AG_AUDIO_CFG_PATH, 'utf8'));
    const device = audioCfg.device_id || 'default';
    const channels = audioCfg.input_channels || 2;
    _agBgProc = require('child_process').spawn('arecord', [
      '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', String(channels), '-t', 'raw',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunkBytes = 48000 * channels * 2 * 0.5; // 500ms
    let buf = Buffer.alloc(0);
    _agBgProc.stdout.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= chunkBytes) {
        const chunk = buf.subarray(0, chunkBytes);
        buf = buf.subarray(chunkBytes);
        const samplesPerCh = chunkBytes / 2 / channels;
        let rmsSum = 0, pk = 0;
        for (let i = 0; i < chunkBytes; i += 2 * channels) {
          const s = chunk.readInt16LE(i) / 32768.0;
          rmsSum += s * s;
          if (Math.abs(s) > pk) pk = Math.abs(s);
        }
        const rmsDb = rmsSum > 0 ? Math.round(10 * Math.log10(rmsSum / samplesPerCh) * 10) / 10 : -60;
        const peakDb = pk > 0 ? Math.round(20 * Math.log10(pk) * 10) / 10 : -60;
        // Push via the request-scoped function won't work — we need a global reference
        // Use the _agState directly (it's closure-accessible from the createServer scope)
        // Actually _agState is also in request scope. We'll use a global bridge.
        agPushSample(rmsDb, peakDb);
      }
    });
    _agBgProc.stderr.on('data', () => {});
    _agBgProc.on('close', () => { _agBgProc = null; });
    console.log('[adaptive-gain] Background collector started (device: ' + device + ')');
  } catch (e) {
    console.warn('[adaptive-gain] Failed to start collector:', e.message);
  }
}
function _agBgStop() {
  if (_agBgProc) { try { _agBgProc.kill(); } catch{} _agBgProc = null; }
  if (_agBgInterval) { clearInterval(_agBgInterval); _agBgInterval = null; }
}
// Check config and auto-start/stop every 30s
_agBgInterval = setInterval(() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(_AG_CFG_PATH, 'utf8'));
    if (cfg.enabled && !_agBgProc) _agBgStart();
    else if (!cfg.enabled && _agBgProc) _agBgStop();
    if (cfg.enabled) agUpdate(cfg);
  } catch {}
}, 30000);
// Initial check after 5s
setTimeout(() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(_AG_CFG_PATH, 'utf8'));
    if (cfg.enabled) _agBgStart();
  } catch {}
}, 5000);


function shutdown() {
  _agBgStop();
}

module.exports = { handle, shutdown };
