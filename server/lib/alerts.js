'use strict';
/**
 * Alert system — background monitoring for system health & bird events
 * Extracted from server.js for modularity.
 */
const path = require('path');

/**
 * Start the alert monitoring system.
 * @param {object} ctx - { db, execCmd, parseBirdnetConf, ALLOWED_SERVICES }
 */
function startAlerts(ctx) {
  const { db, execCmd, parseBirdnetConf, ALLOWED_SERVICES } = ctx;

//  SYSTEM ALERTS — background monitoring loop
// ══════════════════════════════════════════════════════════════════════════════
const ALERT_CHECK_INTERVAL = 60000; // 60 seconds
const ALERT_COOLDOWN = 600000;      // 10 minutes between same alert type
const ALERT_BIRD_COOLDOWN = 86400000; // 24 hours for bird-specific alerts (engine handles per-detection)
const _alertLastSent = {};          // { alertType: timestamp }

// ── Alert message translations ──────────────────────────────────────────────
const ALERT_I18N = require('./alert-i18n');

// Helper: get translated alert messages for the user's configured language
function getAlertLang() {
  try {
    const confRaw = fs.readFileSync(BIRDNET_CONF, 'utf8');
    const m = confRaw.match(/^DATABASE_LANG=(.+)/m);
    const lang = m ? m[1].replace(/"/g, '').trim().slice(0, 2) : 'en';
    return ALERT_I18N[lang] || ALERT_I18N.en;
  } catch(e) {
    return ALERT_I18N.en;
  }
}

// Default thresholds (can be overridden in birdnet.conf via BIRDASH_ALERT_*)
const ALERT_DEFAULTS = {
  temp_warn: 70, temp_crit: 80,     // °C
  disk_warn: 85, disk_crit: 95,     // %
  ram_warn: 90,                      // %
  backlog_warn: 50,                  // files
  no_detection_hours: 4,             // hours
  service_down: 1,                   // 1=enabled
  // Per-alert enable/disable (1=on, 0=off)
  alert_temp: 1, alert_temp_crit: 1, alert_disk: 1,
  alert_ram: 1, alert_backlog: 1, alert_no_det: 1,
  // Bird smart alerts (1=on, 0=off)
  alert_influx: 0, alert_missing: 0, alert_rare_visitor: 0,
};

function getAlertThresholds() {
  const t = { ...ALERT_DEFAULTS };
  try {
    const confRaw = fs.readFileSync(BIRDNET_CONF, 'utf8');
    const match = (key) => { const m = confRaw.match(new RegExp(`^${key}=(.+)`, 'm')); return m ? m[1].replace(/"/g, '').trim() : null; };
    if (match('BIRDASH_ALERT_TEMP_WARN')) t.temp_warn = parseFloat(match('BIRDASH_ALERT_TEMP_WARN'));
    if (match('BIRDASH_ALERT_TEMP_CRIT')) t.temp_crit = parseFloat(match('BIRDASH_ALERT_TEMP_CRIT'));
    if (match('BIRDASH_ALERT_DISK_WARN')) t.disk_warn = parseFloat(match('BIRDASH_ALERT_DISK_WARN'));
    if (match('BIRDASH_ALERT_DISK_CRIT')) t.disk_crit = parseFloat(match('BIRDASH_ALERT_DISK_CRIT'));
    if (match('BIRDASH_ALERT_RAM_WARN'))  t.ram_warn = parseFloat(match('BIRDASH_ALERT_RAM_WARN'));
    if (match('BIRDASH_ALERT_BACKLOG'))   t.backlog_warn = parseInt(match('BIRDASH_ALERT_BACKLOG'));
    if (match('BIRDASH_ALERT_NO_DET_H'))  t.no_detection_hours = parseInt(match('BIRDASH_ALERT_NO_DET_H'));
    // Per-alert toggles
    if (match('BIRDASH_ALERT_ON_TEMP'))      t.alert_temp = parseInt(match('BIRDASH_ALERT_ON_TEMP'));
    if (match('BIRDASH_ALERT_ON_TEMP_CRIT')) t.alert_temp_crit = parseInt(match('BIRDASH_ALERT_ON_TEMP_CRIT'));
    if (match('BIRDASH_ALERT_ON_DISK'))      t.alert_disk = parseInt(match('BIRDASH_ALERT_ON_DISK'));
    if (match('BIRDASH_ALERT_ON_RAM'))       t.alert_ram = parseInt(match('BIRDASH_ALERT_ON_RAM'));
    if (match('BIRDASH_ALERT_ON_BACKLOG'))   t.alert_backlog = parseInt(match('BIRDASH_ALERT_ON_BACKLOG'));
    if (match('BIRDASH_ALERT_ON_NO_DET'))    t.alert_no_det = parseInt(match('BIRDASH_ALERT_ON_NO_DET'));
    // Bird smart alerts
    if (match('BIRDASH_ALERT_ON_INFLUX'))       t.alert_influx = parseInt(match('BIRDASH_ALERT_ON_INFLUX'));
    if (match('BIRDASH_ALERT_ON_MISSING'))      t.alert_missing = parseInt(match('BIRDASH_ALERT_ON_MISSING'));
    if (match('BIRDASH_ALERT_ON_RARE_VISITOR')) t.alert_rare_visitor = parseInt(match('BIRDASH_ALERT_ON_RARE_VISITOR'));
    if (match('BIRDASH_ALERT_ON_SVC_DOWN'))    t.service_down = parseInt(match('BIRDASH_ALERT_ON_SVC_DOWN'));
  } catch(e) {}
  return t;
}

// Expose to module level
  _getAlertThresholds = getAlertThresholds;
  _getAlertStatus = () => ({ _alertLastSent, ALERT_COOLDOWN, ALERT_CHECK_INTERVAL });

  async function sendAlert(type, title, body) {
  const now = Date.now();
  const cooldown = type.startsWith('bird_') ? ALERT_BIRD_COOLDOWN : ALERT_COOLDOWN;
  if (_alertLastSent[type] && (now - _alertLastSent[type]) < cooldown) return;

  const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
  const { APPRISE_BIN } = require('./config');
  const appriseBin = APPRISE_BIN;

  // Check apprise.txt exists and has content
  try {
    const content = await fsp.readFile(appriseFile, 'utf8');
    if (!content.trim()) return;
  } catch(e) { return; }

  try {
    const { execFile } = require('child_process');
    await new Promise((resolve, reject) => {
      execFile(appriseBin, ['-t', title, '-b', body, '--config=' + appriseFile],
        { timeout: 15000 }, (err) => { if (err) reject(err); else resolve(); });
    });
    _alertLastSent[type] = now;
    console.log(`[ALERT] ${type}: ${title}`);
  } catch(e) {
    console.error(`[ALERT] Failed to send ${type}:`, e.message);
  }
}

async function checkSystemAlerts() {
  const th = getAlertThresholds();
  const t = getAlertLang();

  try {
    // ── Temperature ──
    if (th.alert_temp_crit || th.alert_temp) {
      try {
        const tempRaw = await fsp.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
        const temp = parseFloat(tempRaw) / 1000;
        if (th.alert_temp_crit && temp >= th.temp_crit) {
          await sendAlert('temp_crit', t.temp_crit_title, t.temp_crit_body(temp.toFixed(1), th.temp_crit));
        } else if (th.alert_temp && temp >= th.temp_warn) {
          await sendAlert('temp_warn', t.temp_warn_title, t.temp_warn_body(temp.toFixed(1), th.temp_warn));
        }
      } catch(e) {}
    }

    // ── Disk ──
    if (th.alert_disk) {
      try {
        const dfOut = await execCmd('df', ['-B1', '/']).then(o => o.split('\n')[1] || '');
        const parts = dfOut.trim().split(/\s+/);
        const diskPct = parseInt(parts[4]);
        if (diskPct >= th.disk_crit) {
          await sendAlert('disk_crit', t.disk_crit_title, t.disk_crit_body(diskPct, th.disk_crit));
        } else if (diskPct >= th.disk_warn) {
          await sendAlert('disk_warn', t.disk_warn_title, t.disk_warn_body(diskPct, th.disk_warn));
        }
      } catch(e) {}
    }

    // ── RAM ──
    if (th.alert_ram) {
      try {
        const meminfo = await fsp.readFile('/proc/meminfo', 'utf8');
        const total = parseInt(meminfo.match(/MemTotal:\s+(\d+)/)?.[1] || '0');
        const avail = parseInt(meminfo.match(/MemAvailable:\s+(\d+)/)?.[1] || '0');
        const ramPct = total ? Math.round((total - avail) / total * 100) : 0;
        if (ramPct >= th.ram_warn) {
          await sendAlert('ram_warn', t.ram_warn_title, t.ram_warn_body(ramPct, th.ram_warn));
        }
      } catch(e) {}
    }

    // ── Service down ──
    if (th.service_down) {
      const criticalServices = ['birdengine', 'birdengine-recording'];
      for (const svc of criticalServices) {
        try {
          const state = (await execCmd('systemctl', ['is-active', svc])).trim();
          if (state === 'failed' || state === 'inactive') {
            await sendAlert('svc_' + svc, t.svc_state_title(svc, state), t.svc_state_body(svc, state));
          }
        } catch(e) {
          // execSync throws if exit code != 0 (service not active)
          await sendAlert('svc_' + svc, t.svc_down_title(svc), t.svc_down_body(svc));
        }
      }
    }

    // ── Analysis backlog ──
    if (th.alert_backlog) {
      try {
        const streamDir = path.join(process.env.HOME, 'BirdSongs', 'StreamData');
        const files = (await fsp.readdir(streamDir)).filter(f => f.endsWith('.wav'));
        if (files.length >= th.backlog_warn) {
          await sendAlert('backlog', t.backlog_title, t.backlog_body(files.length, th.backlog_warn));
        }
      } catch(e) {}
    }

    // ── No detection for X hours ──
    if (th.alert_no_det) {
      try {
        if (db) {
          const row = db.prepare('SELECT MAX(Date || " " || Time) as last FROM active_detections').get();
          if (row && row.last) {
            const lastDet = new Date(row.last);
            const hoursSince = (Date.now() - lastDet.getTime()) / 3600000;
            if (hoursSince >= th.no_detection_hours) {
              await sendAlert('no_detection', t.no_det_title, t.no_det_body(Math.round(hoursSince), th.no_detection_hours));
            }
          }
        }
      } catch(e) {}
    }

  } catch(e) {
    console.error('[ALERT] checkSystemAlerts error:', e.message);
  }
}

const BIRD_ALERT_INTERVAL = 900000; // 15 minutes

async function checkBirdAlerts() {
  const th = getAlertThresholds();
  const t = getAlertLang();
  if (!db) return;
  if (!th.alert_influx && !th.alert_missing && !th.alert_rare_visitor) return;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    // ── Unusual influx: today's count > 3x 30-day daily average ──
    if (th.alert_influx) {
      try {
        const rows = db.prepare(`
          SELECT t.Com_Name, t.cnt AS today_count, COALESCE(h.avg_count, 0) AS avg_count
          FROM (
            SELECT Com_Name, COUNT(*) AS cnt
            FROM active_detections WHERE Date = ?
            GROUP BY Com_Name
          ) t
          LEFT JOIN (
            SELECT Com_Name, CAST(COUNT(*) AS REAL) / 30.0 AS avg_count
            FROM active_detections WHERE Date >= ? AND Date < ?
            GROUP BY Com_Name
          ) h ON t.Com_Name = h.Com_Name
          WHERE t.cnt > 3 * MAX(h.avg_count, 1)
        `).all(today, thirtyDaysAgo, today);
        for (const r of rows) {
          await sendAlert('bird_influx_' + r.Com_Name, t.bird_influx_title,
            t.bird_influx_body(r.Com_Name, r.today_count, r.avg_count.toFixed(1)));
        }
      } catch(e) { console.error('[ALERT] bird influx error:', e.message); }
    }

    // ── Missing common species (only after noon) ──
    if (th.alert_missing && new Date().getHours() >= 12) {
      try {
        const rows = db.prepare(`
          SELECT top5.Com_Name, top5.avg_count
          FROM (
            SELECT Com_Name, CAST(COUNT(*) AS REAL) / 30.0 AS avg_count
            FROM active_detections WHERE Date >= ? AND Date < ?
            GROUP BY Com_Name ORDER BY COUNT(*) DESC LIMIT 5
          ) top5
          LEFT JOIN (
            SELECT DISTINCT Com_Name FROM active_detections WHERE Date = ?
          ) today ON top5.Com_Name = today.Com_Name
          WHERE today.Com_Name IS NULL
        `).all(thirtyDaysAgo, today, today);
        for (const r of rows) {
          await sendAlert('bird_missing_' + r.Com_Name, t.bird_missing_title,
            t.bird_missing_body(r.Com_Name, r.avg_count.toFixed(1)));
        }
      } catch(e) { console.error('[ALERT] bird missing error:', e.message); }
    }

    // ── Rare visitor: species with <= 3 total historical detections ──
    if (th.alert_rare_visitor) {
      try {
        const rows = db.prepare(`
          SELECT d.Com_Name, h.total, d.max_conf
          FROM (SELECT Com_Name, MAX(Confidence) as max_conf FROM active_detections WHERE Date = ? GROUP BY Com_Name) d
          JOIN (
            SELECT Com_Name, COUNT(*) AS total
            FROM active_detections GROUP BY Com_Name HAVING COUNT(*) <= 3
          ) h ON d.Com_Name = h.Com_Name
        `).all(today);
        for (const r of rows) {
          await sendAlert('bird_rare_' + r.Com_Name, t.bird_rare_title,
            t.bird_rare_body(r.Com_Name, r.total, Math.round(r.max_conf * 100)));
        }
      } catch(e) { console.error('[ALERT] bird rare visitor error:', e.message); }
    }

  } catch(e) {
    console.error('[ALERT] checkBirdAlerts error:', e.message);
  }
}

// Start monitoring loop after 30s (let services stabilize)
let _birdAlertTick = 0;

setTimeout(() => {
  console.log('[BIRDASH] System alerts monitoring started (every 60s, bird alerts every 15min)');
  _alertIntervalId = setInterval(() => {
    checkSystemAlerts();
    _birdAlertTick++;
    if (_birdAlertTick % Math.round(BIRD_ALERT_INTERVAL / ALERT_CHECK_INTERVAL) === 0) {
      checkBirdAlerts();
    }
  }, ALERT_CHECK_INTERVAL);
  checkSystemAlerts(); // Initial check
  checkBirdAlerts();   // Initial bird check
}, 30000);

}

let _alertIntervalId = null;

// Bridge: exposed after startAlerts() is called
let _getAlertThresholds = () => ({});
let _getAlertStatus = () => ({ _alertLastSent: {}, ALERT_COOLDOWN: 600000, ALERT_CHECK_INTERVAL: 60000 });

function stopAlerts() {
  if (_alertIntervalId) { clearInterval(_alertIntervalId); _alertIntervalId = null; }
}

module.exports = {
  startAlerts, stopAlerts,
  getAlertThresholds: () => _getAlertThresholds(),
  getAlertStatus: () => _getAlertStatus(),
};
