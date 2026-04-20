'use strict';
/**
 * Sound-level endpoint — serves the rolling buffer written by the Python
 * engine (config/sound_level.json) so the UI can render a live indicator
 * and small sparkline.
 *
 * Values are dBFS (0 = full scale, -60ish = quiet room, -120 = silence
 * floor). NOT calibrated SPL — trend-tracking only.
 */

const fs = require('fs');
const path = require('path');

const SOUND_LEVEL_PATH = path.join(
  process.env.HOME || '/home/bjorn',
  'birdash/config/sound_level.json'
);

function _read() {
  try {
    const raw = fs.readFileSync(SOUND_LEVEL_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function handle(req, res, pathname /*, ctx */) {
  if (req.method !== 'GET') return false;
  if (pathname !== '/api/sound-level') return false;

  const state = _read();
  if (!state) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ available: false }));
    return true;
  }

  const current = state.current || null;
  const buffer = Array.isArray(state.buffer) ? state.buffer : [];
  let avg1h = null;
  const cutoff = Date.now() / 1000 - 3600;
  const recent = buffer.filter(e => typeof e.leq === 'number' && typeof e.ts === 'number' && e.ts >= cutoff);
  if (recent.length) {
    const sum = recent.reduce((s, e) => s + Math.pow(10, e.leq / 10), 0);
    avg1h = 10 * Math.log10(sum / recent.length);
  }
  let ageSec = null;
  if (current && typeof current.ts === 'number') {
    ageSec = Math.max(0, Math.floor(Date.now() / 1000 - current.ts));
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    available: true,
    current,
    avg_1h_dbfs: avg1h,
    age_seconds: ageSec,
    buffer,
  }));
  return true;
}

module.exports = { handle };
