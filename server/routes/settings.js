'use strict';
/**
 * Settings routes — birdnet.conf settings, apprise notifications, alert status, logs SSE
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const safeConfig = require('../lib/safe-config');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function handle(req, res, pathname, ctx) {
  const { requireAuth, parseBirdnetConf, writeBirdnetConf, SETTINGS_VALIDATORS, BIRDNET_CONF, _alerts, reloadEbirdFreq } = ctx;

  // Cross-tab safety (Phase 3): GET /api/settings advertises an etag of
  // the on-disk birdnet.conf, POST /api/settings honours an If-Match
  // header and returns 409 Conflict if another tab wrote in between.

  // ── Route : GET /api/settings ───────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/settings') {
    (async () => {
      try {
        const conf = await parseBirdnetConf();
        delete conf.CADDY_PWD;
        delete conf.ICE_PWD;
        delete conf.FLICKR_API_KEY;
        const etag = await safeConfig.etagOfFile(BIRDNET_CONF);
        res.writeHead(200, { 'Content-Type': 'application/json', 'ETag': etag });
        res.end(JSON.stringify(conf));
      } catch(e) {
        console.error('[settings]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/settings ──────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/settings') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const { updates } = JSON.parse(body);
          if (!updates || typeof updates !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'updates object required' }));
            return;
          }
          const ifMatch = req.headers['if-match'];
          if (ifMatch) {
            const currentEtag = await safeConfig.etagOfFile(BIRDNET_CONF);
            if (currentEtag !== ifMatch) {
              console.warn(`[settings] STALE ETAG: client sent ${ifMatch}, server has ${currentEtag}`);
              res.writeHead(409, { 'Content-Type': 'application/json', 'ETag': currentEtag });
              res.end(JSON.stringify({
                error: 'conflict',
                code: 'STALE_ETAG',
                message: 'birdnet.conf was modified by another client since you loaded the form. Please reload and try again.',
                etag: currentEtag,
              }));
              return;
            }
          }
          const validated = {};
          const errors = [];
          for (const [key, val] of Object.entries(updates)) {
            if (!SETTINGS_VALIDATORS[key]) { if (key !== '__v_skip' && !key.startsWith('_')) console.warn('[settings] Unknown key ignored:', key); continue; }
            if (!SETTINGS_VALIDATORS[key](val)) {
              errors.push(`Invalid value for ${key}: ${val}`);
              continue;
            }
            validated[key] = val;
          }
          if (errors.length > 0 && Object.keys(validated).length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errors.join('; ') }));
            return;
          }
          await writeBirdnetConf(validated);
          const newEtag = await safeConfig.etagOfFile(BIRDNET_CONF);
          console.log(`[settings] Updated: ${Object.keys(validated).join(', ')}`);
          // Refresh eBird regional data if GPS or API key changed (affects rare-species detection)
          if (reloadEbirdFreq && (validated.LATITUDE || validated.LONGITUDE || validated.EBIRD_API_KEY !== undefined)) {
            reloadEbirdFreq({ force: true }).catch(e => console.warn('[settings] eBird refresh:', e.message));
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'ETag': newEtag });
          res.end(JSON.stringify({
            ok: true,
            updated: Object.keys(validated),
            etag: newEtag,
            warnings: errors.length ? errors : undefined,
          }));
        } catch(e) {
          console.error('[settings]', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return true;
  }

  // ── Route : GET /api/apprise ────────────────────────────────────────────────
  // Returns the content of apprise.txt (notification service URLs)
  if (req.method === 'GET' && pathname === '/api/apprise') {
    (async () => {
      const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
      try {
        const content = await fsp.readFile(appriseFile, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ urls: content.trim() }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ urls: '' }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/apprise ─────────────────────────────────────────────
  // Saves apprise notification URLs to apprise.txt
  if (req.method === 'POST' && pathname === '/api/apprise') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { urls } = JSON.parse(body);
        if (typeof urls !== 'string') throw new Error('urls must be a string');
        const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
        await safeConfig.writeRaw(appriseFile, urls.trim() + '\n', { label: 'POST /api/apprise' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // ── Route : POST /api/apprise/test ────────────────────────────────────────
  // Sends a test notification via Apprise
  if (req.method === 'POST' && pathname === '/api/apprise/test') {
    (async () => {
      try {
        const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
        const { APPRISE_BIN: appriseBin } = require('../lib/config');
        const { execFile } = require('child_process');
        const testI18n = {
          fr: { title: 'BIRDASH — Test', body: 'Ceci est une notification de test. Si vous voyez ce message, les notifications fonctionnent !' },
          en: { title: 'BIRDASH — Test', body: 'This is a test notification. If you see this, notifications are working!' },
          de: { title: 'BIRDASH — Test', body: 'Dies ist eine Testbenachrichtigung. Wenn Sie diese Nachricht sehen, funktionieren die Benachrichtigungen!' },
          nl: { title: 'BIRDASH — Test', body: 'Dit is een testmelding. Als u dit bericht ziet, werken de meldingen!' },
        };
        let _testLang = 'en';
        try { const m = fs.readFileSync(BIRDNET_CONF, 'utf8').match(/^DATABASE_LANG=(.+)/m); if (m) _testLang = m[1].replace(/"/g, '').trim().slice(0, 2); } catch {}
        const tt = testI18n[_testLang] || testI18n.en;
        const result = await new Promise((resolve, reject) => {
          execFile(appriseBin, [
            '-vv',
            '-t', tt.title,
            '-b', tt.body,
            '--config=' + appriseFile
          ], { timeout: 15000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout + stderr);
          });
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, output: result }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/digest/preview ──────────────────────────────────────
  // Builds the weekly digest WITHOUT sending — for UI preview
  if (req.method === 'POST' && pathname === '/api/digest/preview') {
    (async () => {
      try {
        const _digest = require('../lib/weekly-digest');
        const { db } = ctx;
        let lang = 'en';
        try { const m = fs.readFileSync(BIRDNET_CONF, 'utf8').match(/^DATABASE_LANG=(.+)/m); if (m) lang = m[1].replace(/"/g, '').trim().slice(0, 2); } catch {}
        const result = _digest.buildDigest(db, lang);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/digest/send-now ─────────────────────────────────────
  // Builds + sends the digest immediately via Apprise
  if (req.method === 'POST' && pathname === '/api/digest/send-now') {
    (async () => {
      try {
        const _digest = require('../lib/weekly-digest');
        const { db } = ctx;
        const result = await _digest.sendWeeklyDigest(db, async () => {
          const conf = {};
          try {
            const txt = fs.readFileSync(BIRDNET_CONF, 'utf8');
            for (const line of txt.split('\n')) {
              const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
              if (m) conf[m[1]] = m[2].replace(/^"|"$/g, '').trim();
            }
          } catch {}
          // Force-enable for the manual test
          conf.NOTIFY_DIGEST_ENABLED = '1';
          return conf;
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/alert-thresholds ───────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/alert-thresholds') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(_alerts.getAlertThresholds()));
    return true;
  }

  // ── Route : GET /api/alert-status ─────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/alert-status') {
    const status = {};
    const _as = _alerts.getAlertStatus();
    for (const [type, ts] of Object.entries(_as._alertLastSent)) {
      status[type] = { lastSent: new Date(ts).toISOString(), cooldownRemaining: Math.max(0, _as.ALERT_COOLDOWN - (Date.now() - ts)) };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const _as2 = _alerts.getAlertStatus();
    res.end(JSON.stringify({ alerts: status, interval: _as2.ALERT_CHECK_INTERVAL, cooldown: _as2.ALERT_COOLDOWN }));
    return true;
  }

  // ── Route : GET /api/logs (SSE live stream) ────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/logs') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':\n\n'); // SSE comment to establish connection

    const { spawn } = require('child_process');
    const journal = spawn('journalctl', [
      '-u', 'birdengine', '-u', 'birdash', '-u', 'birdengine-recording',
      '-f', '--no-pager', '-o', 'json', '--since', 'now',
    ]);

    journal.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          const msg = j.MESSAGE || '';
          if (!msg) continue;
          const unit = (j._SYSTEMD_UNIT || '').replace('.service', '');
          const ts = j.__REALTIME_TIMESTAMP
            ? new Date(parseInt(j.__REALTIME_TIMESTAMP) / 1000).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '';
          // Categorize
          let cat = 'system';
          if (/GET |POST |DELETE /i.test(msg)) cat = 'api';
          else if (/BirdWeather|uploaded/i.test(msg)) cat = 'birdweather';
          else if (/detection|detect|inference|\d+\.\d+s$/i.test(msg)) cat = 'detection';
          else if (/error|fail|exception|traceback/i.test(msg)) cat = 'error';
          else if (/purge|cleanup|removed/i.test(msg)) cat = 'cleanup';
          else if (/recording|arecord|wav/i.test(msg)) cat = 'recording';

          const data = JSON.stringify({ ts, unit, cat, msg });
          res.write(`data: ${data}\n\n`);
        } catch(e) {}
      }
    });

    journal.stderr.on('data', () => {});
    journal.on('close', () => { try { res.end(); } catch(e) {} });
    req.on('close', () => { try { journal.kill(); } catch(e) {} });
    return true;
  }










  return false;
}

module.exports = { handle };
