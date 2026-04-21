'use strict';
/**
 * audio/monitoring — live VU meter (SSE) + filter preview.
 *
 * Routes:
 *   GET  /api/audio/monitor          — SSE stream of per-channel RMS / peak
 *                                       in dBFS, computed in 500 ms windows
 *   POST /api/audio/filter-preview   — record 3 s, run engine/filter_preview.py
 *                                       on it, return before/after spectrograms
 *
 * The monitor route also feeds the adaptive-gain sample buffer so the
 * Settings UI page (with VU meter open) doubles as a "live" gain
 * collector — the background collector defined in adaptive_gain.js skips
 * itself when birdengine-recording is active to avoid device contention.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const adaptiveGain = require('../../lib/adaptive-gain');
const { readJsonFile } = require('../../lib/config');
const { AUDIO_CONFIG_PATH, PROJECT_ROOT } = require('./_helpers');

const agPushSample = adaptiveGain.pushSample;

function handle(req, res, pathname, ctx) {
  // ── Route : GET /api/audio/monitor ──────────────────────────────────────
  // SSE stream of real-time levels via arecord + per-chunk RMS/peak in JS.
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
    const proc = spawn('arecord', [
      '-D', device, '-f', 'S16_LE', '-r', String(sampleRate),
      '-c', String(channels), '-t', 'raw',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    const bytesPerSample = 2;
    const chunkDuration = 0.5;
    const chunkBytes = sampleRate * channels * bytesPerSample * chunkDuration;
    let buffer = Buffer.alloc(0);

    proc.stdout.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= chunkBytes) {
        const chunk = buffer.subarray(0, chunkBytes);
        buffer = buffer.subarray(chunkBytes);
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
    proc.stderr.on('data', () => {});
    proc.on('close', () => { try { res.end(); } catch {} });
    req.on('close', () => { proc.kill(); });
    return true;
  }

  // ── Route : POST /api/audio/filter-preview ──────────────────────────────
  // Record 3 s, send to engine/filter_preview.py with the user's proposed
  // filter config. Returns before/after spectrograms as base64. Used by
  // Settings → Audio "Test filter" to visualize the effect of a tweak
  // without committing to it.
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
          await new Promise((resolve, reject) => {
            const proc = spawn('arecord', [
              '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', String(channels),
              '-d', '3', tmpWav
            ]);
            proc.on('close', code => code === 0 ? resolve() : reject(new Error(`arecord exit ${code}`)));
            proc.on('error', reject);
            setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 8000);
          });
          // Prefer the engine's local venv (provisioned by install.sh),
          // fall back to legacy ~/birdengine/venv, then system python.
          const scriptPath = path.join(PROJECT_ROOT, 'engine', 'filter_preview.py');
          const _engineVenvPy = path.join(PROJECT_ROOT, 'engine', 'venv', 'bin', 'python');
          const _legacyVenvPy = path.join(process.env.HOME || '', 'birdengine', 'venv', 'bin', 'python');
          const pyBin = fs.existsSync(_engineVenvPy) ? _engineVenvPy
                      : fs.existsSync(_legacyVenvPy) ? _legacyVenvPy
                      : 'python3';
          const result = await new Promise((resolve, reject) => {
            const proc = spawn(pyBin, [
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

  return false;
}

module.exports = { handle };
