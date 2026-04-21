'use strict';
/**
 * audio/noise_profile — record an ambient-noise sample for spectral
 * subtraction by the engine's preprocess stage.
 *
 * Routes:
 *   POST   /api/audio/noise-profile/record   — record 5 s of ambient noise
 *   GET    /api/audio/noise-profile/status   — file existence, size, mtime
 *   DELETE /api/audio/noise-profile          — remove file + disable in config
 *
 * The noise profile is a 5 s WAV stored at config/noise_profile.wav. The
 * engine reads `noise_profile_path` from audio_config.json, so the user
 * can swap in their own WAV by setting it manually if they prefer.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const safeConfig = require('../../lib/safe-config');
const { readJsonFile } = require('../../lib/config');
const { AUDIO_CONFIG_PATH, PROJECT_ROOT } = require('./_helpers');

function handle(req, res, pathname, ctx) {
  const { JSON_CT } = ctx;

  // ── Route : POST /api/audio/noise-profile/record ────────────────────────
  // The user is responsible for ensuring no birds are singing during the
  // 5 s capture window — the file becomes the noise reference subtracted
  // from every subsequent recording's spectrum.
  if (req.method === 'POST' && pathname === '/api/audio/noise-profile/record') {
    (async () => {
      try {
        const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
        const device = config.device_id || 'default';
        const channels = config.input_channels || 2;
        const profilePath = path.join(PROJECT_ROOT, 'config', 'noise_profile.wav');
        await new Promise((resolve, reject) => {
          const proc = spawn('arecord', [
            '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', String(channels),
            '-d', '5', profilePath
          ]);
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`arecord exit ${code}`)));
          proc.on('error', reject);
          setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 10000);
        });
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

  // ── Route : GET /api/audio/noise-profile/status ─────────────────────────
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

  // ── Route : DELETE /api/audio/noise-profile ─────────────────────────────
  if (req.method === 'DELETE' && pathname === '/api/audio/noise-profile') {
    (async () => {
      try {
        const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
        const profilePath = config.noise_profile_path || path.join(PROJECT_ROOT, 'config', 'noise_profile.wav');
        try { fs.unlinkSync(profilePath); } catch {}
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

  return false;
}

module.exports = { handle };
