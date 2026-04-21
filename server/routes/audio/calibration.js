'use strict';
/**
 * audio/calibration — inter-channel gain matching for stereo mics.
 *
 * Most dual-mic setups (e.g. EM272 capsules in a cardioid pair) have a
 * small gain mismatch between channels. The calibration wizard records
 * 10 s, measures RMS per channel, and proposes a per-channel software
 * gain so both channels deliver the same level downstream.
 *
 * Routes:
 *   POST /api/audio/calibration/start  — record 10 s + analyze
 *   POST /api/audio/calibration/apply  — persist gains in audio_config
 */
const fs = require('fs');
const { spawn } = require('child_process');
const safeConfig = require('../../lib/safe-config');
const { readJsonFile } = require('../../lib/config');
const { AUDIO_CONFIG_PATH } = require('./_helpers');

function handle(req, res, pathname, ctx) {
  const { requireAuth } = ctx;

  // ── Route : POST /api/audio/calibration/start ───────────────────────────
  if (req.method === 'POST' && pathname === '/api/audio/calibration/start') {
    if (!requireAuth(req, res)) return true;
    (async () => {
      try {
        const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
        const device = config.device_id || 'default';
        const duration = 10;
        const tmpFile = '/tmp/birdash_calibration.wav';
        await new Promise((resolve, reject) => {
          const proc = spawn('arecord', [
            '-D', device, '-f', 'S16_LE', '-r', '48000', '-c', '2',
            '-d', String(duration), tmpFile
          ]);
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`arecord exit ${code}`)));
          proc.on('error', reject);
          setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, (duration + 5) * 1000);
        });
        const analyzeChannel = async (ch) => {
          return new Promise((resolve) => {
            const ff = spawn('ffmpeg', [
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
        // Reference channel = louder one (gain=1.0); compensate the quieter one.
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

  return false;
}

module.exports = { handle };
