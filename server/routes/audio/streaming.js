'use strict';
/**
 * audio/streaming — playback + live mic streams.
 *
 * Routes:
 *   GET /api/audio-info?file=…   — metadata about an MP3 (duration, channels, sample rate)
 *   GET /api/audio-stream         — chained PCM stream of recent MP3 detections
 *   GET /api/live-stream          — live MP3 from mic (libmp3lame)
 *   GET /api/live-pcm             — live raw PCM from mic
 *
 * The two live-* routes spawn ffmpeg directly against the ALSA device; the
 * audio-stream route reads on-disk MP3s (no mic conflict with the recording
 * service).
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');
const { AUDIO_RATE, AUDIO_CONFIG_PATH, getRecentMp3s } = require('./_helpers');
const { readJsonFile } = require('../../lib/config');

function handle(req, res, pathname, ctx) {
  const { SONGS_DIR } = ctx;

  // ── Route : GET /api/audio-info?file=FileName.mp3 ───────────────────────
  // Returns metadata about an audio file (size, type, duration, channels, sample rate).
  if (req.method === 'GET' && pathname === '/api/audio-info') {
    const fileName = new URL(req.url, 'http://localhost').searchParams.get('file');
    if (!fileName) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"missing file param"}'); return true;
    }
    const m = fileName.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
    if (!m) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"invalid filename format"}'); return true;
    }
    const species = m[1], date = m[2];
    const filePath = path.join(SONGS_DIR, date, species, fileName);
    if (!filePath.startsWith(SONGS_DIR)) {
      res.writeHead(400, { 'Content-Type': 'application/json' }); res.end('{"error":"invalid path"}'); return true;
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
  // Chains recent MP3 BirdNET detections decoded to PCM S16LE. Reads files
  // off disk — zero conflict with the recording service.
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

    (async () => {
      const streamed = new Set();
      const startCutoff = Date.now() - 3 * 60 * 1000;
      const allFiles = await getRecentMp3s(SONGS_DIR);
      for (const f of allFiles) {
        if (f.mtime < startCutoff) streamed.add(f.path);
      }
      console.log(`[audio-stream] démarrage — ${streamed.size} fichiers anciens ignorés`);
      while (!aborted) {
        const pending = (await getRecentMp3s(SONGS_DIR)).filter(f => !streamed.has(f.path));
        if (pending.length === 0) {
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        const file = pending[0];
        streamed.add(file.path);
        console.log(`[audio-stream] → ${path.basename(file.path)}`);
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
        });
      }
      if (!res.writableEnded) res.end();
      console.log('[audio-stream] connexion fermée');
    })();
    return true;
  }

  // ── Route : GET /api/live-stream ─────────────────────────────────────────
  // Continuous MP3 stream from mic for live spectrogram (libmp3lame, 128 kbps).
  if (req.method === 'GET' && pathname === '/api/live-stream') {
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    const device = config.device_id || 'default';
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked',
    });
    const proc = spawn('ffmpeg', [
      '-f', 'alsa', '-ac', '2', '-ar', '48000', '-i', device,
      '-acodec', 'libmp3lame', '-b:a', '128k', '-ac', '1', '-ar', '48000', '-af', 'volume=3',
      '-f', 'mp3', '-fflags', '+nobuffer', '-flush_packets', '1',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdout.on('data', (chunk) => { try { res.write(chunk); } catch {} });
    proc.stderr.on('data', () => {});
    proc.on('close', () => { try { res.end(); } catch {} });
    req.on('close', () => { proc.kill(); });
    return true;
  }

  // ── Route : GET /api/live-pcm ────────────────────────────────────────────
  // Raw PCM stream (16-bit LE, mono, 48kHz) for live spectrogram client-side processing.
  if (req.method === 'GET' && pathname === '/api/live-pcm') {
    const config = readJsonFile(AUDIO_CONFIG_PATH) || {};
    const device = config.device_id || 'default';
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked',
    });
    const proc = spawn('ffmpeg', [
      '-f', 'alsa', '-ac', '2', '-ar', '48000', '-i', device,
      '-ac', '1', '-ar', '48000', '-af', 'volume=3', '-f', 's16le',
      '-fflags', '+nobuffer', '-flush_packets', '1',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdout.on('data', (chunk) => { try { res.write(chunk); } catch {} });
    proc.stderr.on('data', () => {});
    proc.on('close', () => { try { res.end(); } catch {} });
    req.on('close', () => { proc.kill(); });
    return true;
  }

  return false;
}

module.exports = { handle };
