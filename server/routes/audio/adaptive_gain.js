'use strict';
/**
 * audio/adaptive_gain — software gain that adapts to ambient noise floor.
 *
 * Routes:
 *   GET  /api/audio/adaptive-gain/state    — current gain + history snapshot
 *   GET  /api/audio/adaptive-gain/config   — read config/adaptive_gain.json
 *   POST /api/audio/adaptive-gain/config   — write config (whitelisted keys)
 *
 * Background collector:
 *   When enabled and birdengine-recording is NOT active, a long-lived
 *   arecord process feeds 500 ms RMS/peak samples into the adaptive-gain
 *   sample buffer. Auto-starts/stops every 30 s based on the config
 *   `enabled` flag. Skipped when the recording service is up to avoid
 *   ALSA device contention on mono USB cards.
 *
 *   The same sample stream is fed by the /api/audio/monitor SSE route when
 *   the user has the Settings VU meter open — they're complementary; the
 *   collector here covers "no UI open" gaps.
 */
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const adaptiveGain = require('../../lib/adaptive-gain');
const { readJsonFile } = require('../../lib/config');
const { AG_CONFIG_PATH, AUDIO_CONFIG_PATH, AUDIO_CFG_EXAMPLE,
        AG_KEYS, jsonConfigGet, jsonConfigPost } = require('./_helpers');

const AG_DEFAULTS = adaptiveGain.AG_DEFAULTS;
const _agState = adaptiveGain.getState();
const agPushSample = adaptiveGain.pushSample;
const agUpdate = adaptiveGain.update;

let _agBgProc = null, _agBgInterval = null;

function _agBgStart() {
  if (_agBgProc) return;
  try {
    if (!fs.existsSync(AUDIO_CONFIG_PATH) && fs.existsSync(AUDIO_CFG_EXAMPLE)) {
      fs.copyFileSync(AUDIO_CFG_EXAMPLE, AUDIO_CONFIG_PATH);
      console.log('[adaptive-gain] Created audio_config.json from template');
    }
    if (!fs.existsSync(AUDIO_CONFIG_PATH)) { console.warn('[adaptive-gain] No audio_config.json — skipping'); return; }
    try {
      const active = execSync('systemctl is-active birdengine-recording 2>/dev/null || true', { encoding: 'utf8' }).trim();
      if (active === 'active') { console.log('[adaptive-gain] Recording service active — skipping collector to avoid device conflict'); return; }
    } catch(e) {}
    const audioCfg = JSON.parse(fs.readFileSync(AUDIO_CONFIG_PATH, 'utf8'));
    const device = audioCfg.device_id || 'default';
    const channels = audioCfg.input_channels || 2;
    _agBgProc = spawn('arecord', [
      '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', String(channels), '-t', 'raw',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunkBytes = 48000 * channels * 2 * 0.5; // 500 ms
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
}

// Background supervisor: every 30 s, check whether the collector should be
// running based on current config. Also push the latest config to the
// adaptive-gain runtime so threshold/window changes take effect without a
// service restart.
_agBgInterval = setInterval(() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(AG_CONFIG_PATH, 'utf8'));
    if (cfg.enabled && !_agBgProc) _agBgStart();
    else if (!cfg.enabled && _agBgProc) _agBgStop();
    if (cfg.enabled) agUpdate(cfg);
  } catch {}
}, 30000);

// Initial check after 5 s — let the engine settle before we probe.
setTimeout(() => {
  try {
    const cfg = JSON.parse(fs.readFileSync(AG_CONFIG_PATH, 'utf8'));
    if (cfg.enabled) _agBgStart();
  } catch {}
}, 5000);

function handle(req, res, pathname, ctx) {
  const { requireAuth } = ctx;

  // ── Route : GET /api/audio/adaptive-gain/state ──────────────────────────
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
      // Trigger immediate enable/disable instead of waiting for the 30 s tick.
      if (current.enabled && !_agBgProc) _agBgStart();
      else if (!current.enabled && _agBgProc) _agBgStop();
    });
    return true;
  }

  return false;
}

function shutdown() {
  if (_agBgInterval) { clearInterval(_agBgInterval); _agBgInterval = null; }
  _agBgStop();
}

module.exports = { handle, shutdown };
