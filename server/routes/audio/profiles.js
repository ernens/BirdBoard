'use strict';
/**
 * audio/profiles — preset audio configurations (jardin, forêt, etc.).
 *
 * Routes:
 *   GET    /api/audio/profiles             — list all profiles (built-ins + custom)
 *   POST   /api/audio/profiles             — create or update a custom profile
 *   POST   /api/audio/profiles/:name/activate — copy profile fields into audio_config
 *   DELETE /api/audio/profiles/:name       — remove a custom profile (built-ins protected)
 *
 * Built-in profiles ship with `builtin: true` — they cannot be overwritten
 * or deleted.
 */
const safeConfig = require('../../lib/safe-config');
const { readJsonFile } = require('../../lib/config');
const { AUDIO_CONFIG_PATH, AUDIO_PROFILES_PATH } = require('./_helpers');

// Whitelist of fields that can be stored in a profile + applied on activation.
// Anything else from a POST body is silently dropped (protects against random
// fields being persisted in the JSON file).
const PROFILE_KEYS = ['profile_name','highpass_enabled','highpass_cutoff_hz',
  'lowpass_enabled','lowpass_cutoff_hz','denoise_enabled','denoise_strength',
  'hop_size_s','channel_strategy','rms_normalize','rms_target'];

function handle(req, res, pathname, ctx) {
  const { requireAuth } = ctx;

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

  // ── Route : POST /api/audio/profiles/:name/activate ─────────────────────
  // Copies profile fields into audio_config.json. Only the activatable
  // fields are copied (no profile_name etc. junk).
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

  return false;
}

module.exports = { handle };
