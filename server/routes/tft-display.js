/**
 * tft-display.js — External TFT (PiTFT 3.5") HAT kiosk
 *
 * Exposes:
 *   GET  /api/tft-display/status       → { hatDetected, spiEnabled, fbExists, serviceActive, ... }
 *   GET  /api/tft-display/config       → current persisted config
 *   POST /api/tft-display/config       → save config (requires auth)
 *   GET  /api/tft-display/frame-data   → JSON the Python renderer needs each tick
 *   POST /api/tft-display/install      → runs scripts/tft-install.sh with sudo
 *   POST /api/tft-display/service      → systemctl start|stop|restart birdash-tft
 *
 * The Python renderer polls /frame-data (anonymous, local-only via Caddy)
 * every few seconds and writes RGB565 to /dev/fb1. Keeping the heavy SQL
 * on the Node side means the Python service stays tiny (PIL + requests).
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CONFIG_PATH = path.join(PROJECT_ROOT, 'config', 'tft-display.json');
const INSTALL_SCRIPT = path.join(PROJECT_ROOT, 'scripts', 'tft-install.sh');

const DEFAULT_CONFIG = {
  enabled: false,
  rotation: 90,
  refreshSec: 3,
  mode: 'pulse',
};

function _loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

function _saveConfig(cfg) {
  const merged = { ...DEFAULT_CONFIG, ...cfg };
  // Validate
  merged.enabled = !!merged.enabled;
  merged.rotation = [0, 90, 180, 270].includes(+merged.rotation) ? +merged.rotation : 90;
  merged.refreshSec = Math.max(1, Math.min(60, +merged.refreshSec || 3));
  merged.mode = ['pulse', 'headline', 'leaderboard'].includes(merged.mode) ? merged.mode : 'pulse';
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const tmp = CONFIG_PATH + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
  return merged;
}

// Probe the system for each capability we care about. Cheap reads only —
// this is called from the UI on every open of the tab.
function _probeSystem() {
  const out = {
    hatDetected: false, hatProduct: '',
    spiEnabled: false, fbExists: false,
    overlayInConfig: false, overlayLine: '',
    ready: false,
  };
  // HAT EEPROM — PiTFT 3.5" has no EEPROM, so absence is normal. Informational only.
  try { out.hatProduct = fs.readFileSync('/proc/device-tree/hat/product', 'utf8').replace(/\0/g, '').trim(); } catch {}
  out.hatDetected = !!out.hatProduct;

  // SPI: /dev/spidev* is the naive check but the pitft35-resistive overlay
  // claims the bus via the in-kernel fbtft driver and doesn't expose spidev.
  // In that case the SPI bus is absolutely enabled — we just can't see it
  // from userland. Fall back to raspi-config, then to the fbExists proxy.
  try {
    if (fs.existsSync('/dev/spidev0.0') || fs.existsSync('/dev/spidev0.1')) {
      out.spiEnabled = true;
    } else {
      try {
        const r = execFileSync('raspi-config', ['nonint', 'get_spi'], { encoding: 'utf8' }).trim();
        out.spiEnabled = r === '0';  // 0 = enabled, 1 = disabled
      } catch {}
    }
  } catch {}

  try { out.fbExists = fs.existsSync('/dev/fb1'); } catch {}

  // Did someone (our install script or the user) add the overlay line? Tells
  // us whether a reboot alone would be enough to get fb1 back if it ever
  // disappeared.
  for (const p of ['/boot/firmware/config.txt', '/boot/config.txt']) {
    try {
      const txt = fs.readFileSync(p, 'utf8');
      const m = txt.match(/^dtoverlay=pitft.*$/m);
      if (m) { out.overlayInConfig = true; out.overlayLine = m[0]; break; }
    } catch {}
  }

  // If the overlay claimed SPI, spidev is absent but SPI is in fact on — use
  // fbExists as the ground truth for "the overlay is live".
  if (out.fbExists) out.spiEnabled = true;

  // The one boolean the UI really needs.
  out.ready = out.fbExists;
  return out;
}

function _serviceStatus() {
  const out = { active: false, enabled: false, ramMB: null, pid: null };
  try {
    const state = execFileSync('systemctl', ['is-active', 'birdash-tft.service'], { encoding: 'utf8' }).trim();
    out.active = state === 'active';
  } catch { out.active = false; }
  try {
    const state = execFileSync('systemctl', ['is-enabled', 'birdash-tft.service'], { encoding: 'utf8' }).trim();
    out.enabled = state === 'enabled';
  } catch { out.enabled = false; }
  if (out.active) {
    try {
      const pid = execFileSync('systemctl', ['show', '-p', 'MainPID', '--value', 'birdash-tft.service'], { encoding: 'utf8' }).trim();
      out.pid = parseInt(pid, 10) || null;
      if (out.pid) {
        const statm = fs.readFileSync(`/proc/${out.pid}/statm`, 'utf8').split(/\s+/);
        const rssPages = parseInt(statm[1], 10);
        out.ramMB = Math.round(rssPages * 4 / 1024);  // 4K pages on ARM
      }
    } catch {}
  }
  return out;
}

function _sudoAvailable() {
  try { execFileSync('sudo', ['-n', '-l', INSTALL_SCRIPT], { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function _localDateStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Compose all the data the Python renderer needs for one tick.
function _frameData(ctx) {
  const { db, parseBirdnetConf } = ctx;
  const today = _localDateStr();
  const conf = 0.7;
  const out = { time: new Date().toISOString(), stationName: '', pulseRate: 0, river: [], nowFrac: 0, latestDet: null, topToday: [], kpis: { species: 0, total: 0, lastHour: 0 } };

  try {
    const bn = parseBirdnetConf();
    out.stationName = (bn && (bn.SITE_NAME || bn.SITE_BRAND)) || '';
  } catch {}

  const now = new Date();
  out.nowFrac = (now.getHours() * 60 + now.getMinutes()) / 1440;

  try {
    const row = db.prepare(
      "SELECT COUNT(*) as n FROM active_detections WHERE Date=? AND Confidence>=? AND Time>=time('now','-10 minutes','localtime')"
    ).get(today, conf);
    out.pulseRate = row ? Math.round(row.n / 10 * 10) / 10 : 0;
  } catch {}

  try {
    const rows = db.prepare(
      'SELECT Time, Confidence FROM active_detections WHERE Date=? AND Confidence>=? ORDER BY Time ASC'
    ).all(today, conf);
    out.river = rows.map(r => {
      const t = (r.Time || '').split(':');
      const mins = (parseInt(t[0], 10) || 0) * 60 + (parseInt(t[1], 10) || 0);
      const c = Math.max(0.5, Math.min(1, r.Confidence || 0));
      const tier = c >= 0.85 ? 'high' : c >= 0.70 ? 'mid' : 'low';
      return { x: mins / 1440, conf: c, tier };
    });
  } catch {}

  try {
    const td = db.prepare(
      'SELECT COUNT(*) as total, COUNT(DISTINCT Com_Name) as species FROM active_detections WHERE Date=? AND Confidence>=?'
    ).get(today, conf);
    out.kpis.species = td?.species || 0;
    out.kpis.total = td?.total || 0;
    const lh = db.prepare(
      "SELECT COUNT(*) as n FROM active_detections WHERE Date=? AND Confidence>=? AND Time>=time('now','-1 hour','localtime')"
    ).get(today, conf);
    out.kpis.lastHour = lh?.n || 0;
  } catch {}

  try {
    const ld = db.prepare(
      'SELECT Date, Time, Com_Name, Sci_Name, Confidence, Model FROM detections ORDER BY Date DESC, Time DESC LIMIT 1'
    ).get();
    if (ld) {
      out.latestDet = {
        comName: ld.Com_Name,
        sciName: ld.Sci_Name,
        date: ld.Date || '',
        time: (ld.Time || '').substring(0, 5),
        confidence: Math.round((ld.Confidence || 0) * 100),
        model: ld.Model || '',
      };
    }
  } catch {}

  // Top 6 species today, with trend vs. same time yesterday (fair comparison
  // — at 9am today vs 9am yesterday, not vs yesterday's full day).
  try {
    const top = db.prepare(
      'SELECT Com_Name as comName, Sci_Name as sciName, COUNT(*) as count ' +
      'FROM active_detections WHERE Date=? AND Confidence>=? ' +
      'GROUP BY Com_Name ORDER BY count DESC LIMIT 6'
    ).all(today, conf);
    if (top.length) {
      const yd = new Date(now.getTime() - 86400000);
      const pad = n => String(n).padStart(2, '0');
      const yesterday = `${yd.getFullYear()}-${pad(yd.getMonth() + 1)}-${pad(yd.getDate())}`;
      const nowHHMM = `${pad(now.getHours())}:${pad(now.getMinutes())}:59`;
      const placeholders = top.map(() => '?').join(',');
      const yRows = db.prepare(
        'SELECT Com_Name as comName, COUNT(*) as count ' +
        'FROM active_detections WHERE Date=? AND Confidence>=? AND Time<=? ' +
        `AND Com_Name IN (${placeholders}) GROUP BY Com_Name`
      ).all(yesterday, conf, nowHHMM, ...top.map(t => t.comName));
      const yMap = Object.fromEntries(yRows.map(r => [r.comName, r.count]));
      out.topToday = top.map(t => {
        const y = yMap[t.comName] || 0;
        const trend = t.count > y ? 'up' : t.count < y ? 'down' : 'flat';
        return { comName: t.comName, sciName: t.sciName, count: t.count, yesterdayCount: y, trend };
      });
    }
  } catch {}

  return out;
}

function handle(req, res, pathname, ctx) {
  const { requireAuth, JSON_CT, jsonOk, jsonErr } = ctx;

  if (req.method === 'GET' && pathname === '/api/tft-display/status') {
    const sys = _probeSystem();
    const svc = _serviceStatus();
    const cfg = _loadConfig();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ...sys, service: svc, config: cfg, sudoReady: _sudoAvailable() }));
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/tft-display/config') {
    jsonOk(res, _loadConfig());
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/tft-display/config') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req._bodyLimited && req._bodyLimited()) return;
      try {
        const cfg = _saveConfig(JSON.parse(body || '{}'));
        jsonOk(res, cfg);
      } catch (e) { jsonErr(res, 400, e.message); }
    });
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/tft-display/frame-data') {
    try { jsonOk(res, _frameData(ctx)); }
    catch (e) { jsonErr(res, 500, e.message); }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/tft-display/install') {
    if (!requireAuth(req, res)) return true;
    if (!_sudoAvailable()) {
      res.writeHead(501, JSON_CT);
      res.end(JSON.stringify({
        error: 'Passwordless sudo not configured for tft-install.sh',
        hint: 'Add /etc/sudoers.d/birdash-tft: birdash ALL=(root) NOPASSWD: ' + INSTALL_SCRIPT,
        manualCommands: [
          'sudo raspi-config nonint do_spi 0',
          `echo "dtoverlay=pitft35-resistive,rotate=90,speed=32000000,fps=25" | sudo tee -a /boot/firmware/config.txt`,
          'sudo apt-get install -y python3-pil python3-requests',
          `sudo cp ${path.join(PROJECT_ROOT, 'tft-display', 'birdash-tft.service')} /etc/systemd/system/`,
          'sudo systemctl daemon-reload',
          'sudo systemctl enable --now birdash-tft.service',
          'sudo reboot',
        ],
      }));
      return true;
    }
    // 202 immediately; run script detached, write progress to /tmp
    res.writeHead(202, JSON_CT);
    res.end(JSON.stringify({ ok: true, started: true }));
    try {
      const child = spawn('sudo', ['-n', INSTALL_SCRIPT], {
        detached: true,
        stdio: ['ignore', fs.openSync('/tmp/tft-install.log', 'w'), fs.openSync('/tmp/tft-install.log', 'a')],
      });
      child.unref();
    } catch (e) { console.error('[tft-install] spawn failed:', e.message); }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/tft-display/service') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req._bodyLimited && req._bodyLimited()) return;
      let action;
      try { ({ action } = JSON.parse(body || '{}')); }
      catch { return jsonErr(res, 400, 'Invalid JSON'); }
      if (!['start', 'stop', 'restart'].includes(action)) return jsonErr(res, 400, 'Unknown action');
      try {
        execFileSync('sudo', ['-n', '/bin/systemctl', action, 'birdash-tft.service'], { stdio: 'ignore' });
        jsonOk(res, { ok: true, action });
      } catch (e) {
        res.writeHead(501, JSON_CT);
        res.end(JSON.stringify({ error: 'systemctl failed', hint: 'Check sudoers for birdash-tft.service', detail: e.message }));
      }
    });
    return true;
  }

  return false;
}

module.exports = { handle };
