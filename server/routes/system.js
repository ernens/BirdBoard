'use strict';
/**
 * System & infrastructure routes
 * Services, system-health, hardware, network, models, languages, species-lists, etc.
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const safeConfig = require('../lib/safe-config');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

function handle(req, res, pathname, ctx) {
  const { requireAuth, execCmd, readJsonFile, writeJsonFileAtomic, JSON_CT, parseBirdnetConf, ALLOWED_SERVICES, BIRDNET_DIR } = ctx;

  // ── Route : GET /api/services ───────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/services') {
    (async () => {
      try {
        const services = [];
        for (const name of ALLOWED_SERVICES) {
          // Skip units that aren't installed on this Pi (e.g. birdash-tft on
          // a host without the PiTFT HAT) so they don't appear as "inactive".
          const unitExists = fs.existsSync(`/etc/systemd/system/${name}.service`) ||
                             fs.existsSync(`/lib/systemd/system/${name}.service`) ||
                             fs.existsSync(`/usr/lib/systemd/system/${name}.service`);
          if (!unitExists) continue;
          try {
            const state = await execCmd('systemctl', ['is-active', name]);
            let pid = null, memory = 0, uptime = 0;
            if (state === 'active') {
              try {
                const show = await execCmd('systemctl', ['show', name, '--property=MainPID,ActiveEnterTimestamp', '--no-pager']);
                const props = {};
                show.split('\n').forEach(l => { const eq = l.indexOf('='); if (eq > 0) props[l.slice(0, eq)] = l.slice(eq + 1); });
                pid = parseInt(props.MainPID) || null;
                // Uptime from ActiveEnterTimestamp
                const ts = props.ActiveEnterTimestamp || '';
                if (ts) {
                  const cleaned = ts.replace(/^\w+\s+/, '').replace(/\s+\w+$/, '');
                  const startMs = new Date(cleaned).getTime();
                  if (!isNaN(startMs)) uptime = Math.floor((Date.now() - startMs) / 1000);
                }
                // RAM from /proc
                if (pid) {
                  try {
                    const st = await fsp.readFile(`/proc/${pid}/status`, 'utf8');
                    const m = st.match(/VmRSS:\s*(\d+)\s*kB/);
                    if (m) memory = parseInt(m[1]) * 1024;
                  } catch(_) {}
                }
              } catch(_) {}
            }
            services.push({ name, state, pid, memory, uptime });
          } catch(e) {
            services.push({ name, state: 'inactive', pid: null, memory: 0, uptime: 0 });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ services }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/services/restart ──────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/services/restart') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const { service } = JSON.parse(body);
          if (!ALLOWED_SERVICES.includes(service)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Service not allowed: ${service}` }));
            return;
          }
          await execCmd('sudo', ['systemctl', 'restart', service]);
          console.log(`[services] Restarted: ${service}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, service, action: 'restart' }));
        } catch(e) {
          console.error('[services]', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ── SYSTEM HEALTH ENDPOINTS ────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Route : GET /api/system-health ────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/system-health') {
    (async () => {
      try {
        // Memory
        const memRaw = await fsp.readFile('/proc/meminfo', 'utf8');
        const memParse = k => parseInt((memRaw.match(new RegExp(k + ':\\s+(\\d+)')) || [0,0])[1]) * 1024;
        const memTotal = memParse('MemTotal'), memAvail = memParse('MemAvailable');
        const memUsed = memTotal - memAvail;

        // Load average
        const loadRaw = await fsp.readFile('/proc/loadavg', 'utf8');
        const loadParts = loadRaw.trim().split(/\s+/);
        const loadAvg = [parseFloat(loadParts[0]), parseFloat(loadParts[1]), parseFloat(loadParts[2])];

        // CPU cores
        const cpuRaw = await fsp.readFile('/proc/cpuinfo', 'utf8');
        const cores = (cpuRaw.match(/^processor/gm) || []).length;

        // Uptime
        const uptimeRaw = await fsp.readFile('/proc/uptime', 'utf8');
        const uptimeSecs = parseFloat(uptimeRaw.split(/\s+/)[0]);

        // Temperature
        let temperature = null;
        try {
          const tempRaw = await fsp.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
          temperature = parseInt(tempRaw.trim()) / 1000;
        } catch(e) {}

        // Disk
        const dfOut = await execCmd('df', ['-B1', '/']);
        const dfLine = dfOut.split('\n')[1];
        const dfParts = dfLine.trim().split(/\s+/);
        const disk = { total: parseInt(dfParts[1]), used: parseInt(dfParts[2]), free: parseInt(dfParts[3]), percent: parseInt(dfParts[4]) };

        // Fan (hwmon number can change across reboots, so we glob)
        let fan = null;
        try {
          const fanDir = fs.readdirSync('/sys/devices/platform/cooling_fan/hwmon/')[0];
          const base = `/sys/devices/platform/cooling_fan/hwmon/${fanDir}`;
          const fanRpm = parseInt((await fsp.readFile(`${base}/fan1_input`, 'utf8')).trim());
          const fanPwm = parseInt((await fsp.readFile(`${base}/pwm1`, 'utf8')).trim());
          fan = { rpm: fanRpm, percent: Math.round(fanPwm / 255 * 100) };
        } catch(e) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          cpu: { cores, usage: Math.round(loadAvg[0] / cores * 100) },
          memory: { total: memTotal, used: memUsed, free: memAvail, percent: Math.round(memUsed / memTotal * 100) },
          disk,
          temperature,
          fan,
          uptime: Math.floor(uptimeSecs),
          loadAvg
        }));
      } catch(e) {
        console.error('[system-health]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════════

  // ── Route : GET /api/services/:name/status ────────────────────────────────────
  const svcStatusMatch = pathname.match(/^\/api\/services\/([^/]+)\/status$/);
  if (req.method === 'GET' && svcStatusMatch) {
    const svcName = svcStatusMatch[1];
    if (!ALLOWED_SERVICES.includes(svcName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Service not allowed: ${svcName}` }));
      return;
    }
    (async () => {
      try {
        const props = await execCmd('systemctl', ['show', svcName,
          '--property=ActiveState,SubState,MainPID,MemoryCurrent,ActiveEnterTimestamp,ExecMainStartTimestamp,Description']);
        const info = {};
        for (const line of props.split('\n')) {
          const eq = line.indexOf('=');
          if (eq > 0) info[line.slice(0, eq)] = line.slice(eq + 1);
        }
        let logs = [];
        try {
          const logRaw = await execCmd('journalctl', ['-u', svcName, '-n', '25', '--no-pager', '-o', 'short-iso']);
          logs = logRaw.split('\n').filter(l => l.trim() && !l.startsWith('--'));
        } catch(e) {}

        // Memory: try MemoryCurrent, fallback to /proc/PID/status VmRSS
        let memBytes = 0;
        if (info.MemoryCurrent && info.MemoryCurrent !== '[not set]') {
          memBytes = parseInt(info.MemoryCurrent) || 0;
        }
        const pid = parseInt(info.MainPID || '0');
        if (memBytes === 0 && pid > 0) {
          try {
            const procStatus = await fsp.readFile(`/proc/${pid}/status`, 'utf8');
            const rssMatch = procStatus.match(/VmRSS:\s*(\d+)\s*kB/);
            if (rssMatch) memBytes = parseInt(rssMatch[1]) * 1024;
          } catch(_) {}
        }

        // Uptime: try ActiveEnterTimestamp (more reliable than ExecMainStartTimestamp)
        let uptimeSecs = 0;
        const tsField = info.ActiveEnterTimestamp || info.ExecMainStartTimestamp || '';
        if (tsField) {
          // systemd format: "Mon 2026-03-21 22:09:51 CET" — remove day-of-week and timezone
          const cleaned = tsField.replace(/^\w+\s+/, '').replace(/\s+\w+$/, '');
          const startMs = new Date(cleaned).getTime();
          if (!isNaN(startMs)) uptimeSecs = Math.floor((Date.now() - startMs) / 1000);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          name: svcName,
          state: info.ActiveState || 'unknown',
          subState: info.SubState || 'unknown',
          pid: parseInt(info.MainPID || '0'),
          memory: memBytes,
          uptime: uptimeSecs,
          description: info.Description || '',
          logs
        }));
      } catch(e) {
        console.error('[service-status]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/services/:name/:action (start|stop) ────────────────────
  const svcActionMatch = pathname.match(/^\/api\/services\/([^/]+)\/(start|stop)$/);
  if (req.method === 'POST' && svcActionMatch) {
    if (!requireAuth(req, res)) return true;
    const svcName = svcActionMatch[1];
    const action = svcActionMatch[2];
    if (!ALLOWED_SERVICES.includes(svcName)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Service not allowed: ${svcName}` }));
      return;
    }
    (async () => {
      try {
        await execCmd('sudo', ['systemctl', action, svcName]);
        console.log(`[services] ${action}: ${svcName}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, service: svcName, action }));
      } catch(e) {
        console.error(`[services] ${action} ${svcName}:`, e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/analysis-status ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/analysis-status') {
    (async () => {
      try {
        const conf = await parseBirdnetConf();

        // Backlog: count WAV files in BirdEngine incoming dir
        const incomingDir = path.join(process.env.HOME, 'birdengine', 'audio', 'incoming');
        let backlog = 0, lagSecs = 0;
        try {
          const files = (await fsp.readdir(incomingDir)).filter(f => f.endsWith('.wav')).sort();
          backlog = files.length;
          if (files.length > 0) {
            const stat = await fsp.stat(path.join(incomingDir, files[files.length - 1]));
            lagSecs = Math.floor((Date.now() - stat.mtimeMs) / 1000);
          }
        } catch(e) {
          // No incoming dir = local recording, check last detection time instead
          try {
            const row = db.prepare('SELECT MAX(Date || " " || Time) as last FROM detections').get();
            if (row && row.last) {
              const lastMs = new Date(row.last.replace(' ', 'T')).getTime();
              if (!isNaN(lastMs)) lagSecs = Math.floor((Date.now() - lastMs) / 1000);
            }
          } catch(e2) {}
        }

        // Parse inference times from birdengine logs
        let inferenceTime = null;
        let secondaryModel = conf.DUAL_MODEL_ENABLED === '1' ? (conf.SECONDARY_MODEL || null) : null;
        let secondaryInferenceTime = null;
        try {
          const logOut = await execCmd('journalctl', ['-u', 'birdengine', '-n', '200', '--no-pager']);
          // Primary model timing
          const primaryMatch = logOut.match(/\[BirdNET[^\]]*\] Done: \d+ detections in ([\d.]+)s/g);
          if (primaryMatch && primaryMatch.length > 0) {
            inferenceTime = parseFloat(primaryMatch[primaryMatch.length - 1].match(/in ([\d.]+)s/)[1]);
          }
          // Secondary model timing (match any Perch variant)
          const secMatch = logOut.match(/\[perch_v2[^\]]*\] .+\.wav: \d+ detections in ([\d.]+)s/gi);
          if (secMatch && secMatch.length > 0) {
            secondaryInferenceTime = parseFloat(secMatch[secMatch.length - 1].match(/in ([\d.]+)s/)[1]);
          }
        } catch(e) { console.warn('[system] model log parse:', e.message); }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          model: conf.MODEL || 'unknown',
          secondaryModel,
          sfThresh: parseFloat(conf.SF_THRESH || '0.03'),
          sensitivity: parseFloat(conf.SENSITIVITY || '1.0'),
          confidence: parseFloat(conf.CONFIDENCE || '0.7'),
          backlog,
          lagSecs, lag: lagSecs,
          inferenceTime,
          secondaryInferenceTime,
          recordingLength: parseInt(conf.RECORDING_LENGTH || '45')
        }));
      } catch(e) {
        console.error('[analysis-status]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/audio-device ─────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio-device') {
    (async () => {
      try {
        const conf = await parseBirdnetConf();
        let devices = '';
        try { devices = await execCmd('arecord', ['-l']); } catch(e) { devices = e.message; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          recCard: conf.REC_CARD || 'default',
          channels: parseInt(conf.CHANNELS || '1'),
          audioFmt: conf.AUDIOFMT || 'mp3',
          devices
        }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/backup-status ────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/backup-status') {
    (async () => {
      try {
        const bkpCfg = readJsonFile(path.join(PROJECT_ROOT, 'config', 'backup.json')) || {};
        const dest = bkpCfg.destination || 'local';
        const schedule = bkpCfg.schedule || 'manual';
        const lastRun = bkpCfg.lastRun || null;
        const lastStatus = bkpCfg.lastStatus || null;

        // Check mount for NFS/SMB destinations
        let mounted = null;
        if (dest === 'nfs' || dest === 'smb') {
          const mountPath = (dest === 'nfs' && bkpCfg.nfs && bkpCfg.nfs.mountPoint) || '/mnt/backup';
          try { await execCmd('mountpoint', ['-q', mountPath]); mounted = true; } catch { mounted = false; }
        }

        // Use cached backup size (du on NFS can take 30s+)
        const backupSize = bkpCfg.lastBackupSize || null;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ destination: dest, schedule, lastRun, lastStatus, mounted, backupSize }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/network-info ─────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/network-info') {
    (async () => {
      try {
        const hostname = (await fsp.readFile('/etc/hostname', 'utf8')).trim();
        let ip = '';
        try { ip = (await execCmd('hostname', ['-I'])).trim().split(/\s+/)[0]; } catch {}

        // Gateway
        let gateway = null;
        try {
          const routeOut = await execCmd('ip', ['route', 'show', 'default']);
          const gw = routeOut.match(/default via ([\d.]+)/);
          if (gw) gateway = gw[1];
        } catch {}

        // Internet connectivity
        let internet = false;
        try { await execCmd('ping', ['-c', '1', '-W', '2', '1.1.1.1']); internet = true; } catch {}

        // NAS ping — derive IP from backup config if NFS/SMB/SFTP
        const bkpCfg = readJsonFile(path.join(PROJECT_ROOT, 'config', 'backup.json')) || {};
        let nasHost = null;
        if (bkpCfg.destination === 'nfs' && bkpCfg.nfs) nasHost = bkpCfg.nfs.host;
        else if (bkpCfg.destination === 'smb' && bkpCfg.smb) nasHost = bkpCfg.smb.host;
        else if (bkpCfg.destination === 'sftp' && bkpCfg.sftp) nasHost = bkpCfg.sftp.host;

        let nasPing = null;
        if (nasHost) {
          try {
            const pingOut = await execCmd('ping', ['-c', '1', '-W', '2', nasHost]);
            const latMatch = pingOut.match(/time=([\d.]+)/);
            nasPing = { reachable: true, latency: latMatch ? parseFloat(latMatch[1]) : 0 };
          } catch {
            nasPing = { reachable: false, latency: 0 };
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ hostname, ip, gateway, internet, nasHost, nasPing }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/hardware ───────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/hardware') {
    (async () => {
      try {
        // Pi model
        let piModel = '';
        try { piModel = (await fsp.readFile('/proc/device-tree/model', 'utf8')).replace(/\0/g, '').trim(); } catch(_) {}

        // CPU info
        let cpuModel = '', cpuFreq = 0;
        try {
          const cpuinfo = await fsp.readFile('/proc/cpuinfo', 'utf8');
          const mm = cpuinfo.match(/model name\s*:\s*(.+)/i) || cpuinfo.match(/Model\s*:\s*(.+)/i);
          if (mm) cpuModel = mm[1].trim();
          const fm = cpuinfo.match(/cpu MHz\s*:\s*([\d.]+)/i);
          if (fm) cpuFreq = Math.round(parseFloat(fm[1]));
        } catch(_) {}
        // On Pi, freq from scaling_cur_freq
        if (!cpuFreq) {
          try { cpuFreq = Math.round(parseInt(await fsp.readFile('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq', 'utf8')) / 1000); } catch(_) {}
        }

        // Total RAM
        let ramTotal = 0;
        try {
          const meminfo = await fsp.readFile('/proc/meminfo', 'utf8');
          const m = meminfo.match(/MemTotal:\s*(\d+)/);
          if (m) ramTotal = parseInt(m[1]) * 1024; // kB → bytes
        } catch(_) {}

        // Block devices (disks)
        const disks = [];
        try {
          const lsblk = await execCmd('lsblk', ['-J', '-b', '-o', 'NAME,SIZE,TYPE,TRAN,MODEL,MOUNTPOINT,FSTYPE']);
          const data = JSON.parse(lsblk);
          (data.blockdevices || []).forEach(d => {
            if (d.type === 'disk') {
              const mounts = (d.children || []).filter(c => c.mountpoint).map(c => c.mountpoint);
              disks.push({
                name: d.name,
                size: parseInt(d.size) || 0,
                transport: d.tran || '',
                model: (d.model || '').trim(),
                mounts,
                fstype: (d.children && d.children[0] && d.children[0].fstype) || ''
              });
            }
          });
        } catch(_) {}

        // Sound cards
        const soundCards = [];
        try {
          const cards = await fsp.readFile('/proc/asound/cards', 'utf8');
          cards.split('\n').forEach(line => {
            const m = line.match(/^\s*(\d+)\s+\[(\w+)\s*\]:\s*(.+)/);
            if (m) soundCards.push({ id: parseInt(m[1]), shortName: m[2], name: m[3].trim() });
          });
        } catch(_) {}

        // USB devices
        const usbDevices = [];
        try {
          const lsusb = await execCmd('lsusb', []);
          lsusb.split('\n').forEach(line => {
            const m = line.match(/Bus\s+(\d+)\s+Device\s+(\d+):\s+ID\s+(\S+)\s+(.*)/);
            if (m && !m[4].match(/hub/i)) usbDevices.push({ bus: m[1], device: m[2], id: m[3], name: m[4].trim() });
          });
        } catch(_) {}

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ piModel, cpuModel, cpuFreq, ramTotal, disks, soundCards, usbDevices }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/models ─────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/models') {
    (async () => {
      try {
        const modelDir = path.join(BIRDNET_DIR, 'models');
        const files = await fsp.readdir(modelDir);
        const models = [];
        // Some .tflite files in models/ are NOT bird-detection models —
        // they're auxiliary classifiers (YAMNet for privacy/dog filters)
        // or BirdNET's own geographic-probability companion (MData).
        // Excluded so they don't appear in the primary/secondary model
        // picker.
        const NON_DETECTION = /^(yamnet|.*_MData_Model)/i;
        for (const f of files) {
          if (!f.endsWith('.tflite')) continue;
          // Skip symlinks (e.g. FP16 → FP32 compatibility link)
          const fullPath = path.join(modelDir, f);
          try {
            const stat = await fsp.lstat(fullPath);
            if (stat.isSymbolicLink()) continue;
          } catch(e) {}
          const name = f.replace('.tflite', '');
          if (NON_DETECTION.test(name)) continue;
          models.push(name);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ models }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/languages ──────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/languages') {
    (async () => {
      try {
        const labelDir = path.join(BIRDNET_DIR, 'models', 'l18n');
        const files = await fsp.readdir(labelDir);
        const languages = files
          .filter(f => f.startsWith('labels_') && f.endsWith('.json'))
          .map(f => f.replace('labels_', '').replace('.json', ''))
          .sort();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ languages }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/species-lists ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/species-lists') {
    (async () => {
      try {
        const readList = async (name) => {
          const fp = path.join(BIRDNET_DIR, name);
          try {
            const raw = await fsp.readFile(fp, 'utf8');
            return raw.split('\n').map(l => l.trim()).filter(Boolean);
          } catch(e) { return []; }
        };
        const include = await readList('include_species_list.txt');
        const exclude = await readList('exclude_species_list.txt');
        const whitelist = await readList('whitelist_species_list.txt');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ include, exclude, whitelist }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : POST /api/species-lists ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/species-lists') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const { list, species } = JSON.parse(body);
          const validLists = { include: 'include_species_list.txt', exclude: 'exclude_species_list.txt', whitelist: 'whitelist_species_list.txt' };
          if (!validLists[list]) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: `Invalid list: ${list}` }));
            return;
          }
          if (!Array.isArray(species)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'species must be an array' }));
            return;
          }
          const fp = path.join(BIRDNET_DIR, validLists[list]);
          await safeConfig.writeRaw(fp, species.join('\n') + '\n', { label: `POST /api/species-lists/${list}` });
          console.log(`[species-lists] Updated ${list}: ${species.length} species`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, list, count: species.length }));
        } catch(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return true;
  }


  // ── Route : POST /api/download-birdnet ──────────────────────────────────
  // Downloads BirdNET models from birdnetlib pip package (user-initiated, CC-NC-SA)
  if (req.method === 'POST' && pathname === '/api/download-birdnet') {
    if (!requireAuth(req, res)) return true;
    (async () => {
      try {
        const modelsDir = path.join(PROJECT_ROOT, 'engine', 'models');
        // Check if already present
        const fp32 = path.join(modelsDir, 'BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite');
        const l18nEn = path.join(modelsDir, 'l18n', 'labels_en.json');
        if (fs.existsSync(fp32) && fs.statSync(fp32).size > 1000000 && fs.existsSync(l18nEn)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, message: 'BirdNET models already installed' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, message: 'Download started — this may take several minutes on slower hardware' }));

        // Delegate to the standalone download script (same logic as install.sh uses).
        const scriptPath = path.join(PROJECT_ROOT, 'engine', 'download_birdnet.sh');
        const { spawn } = require('child_process');
        const proc = spawn('bash', [scriptPath, modelsDir], { stdio: 'pipe' });
        proc.stdout.on('data', d => process.stdout.write('[download-birdnet] ' + d));
        proc.stderr.on('data', d => process.stderr.write('[download-birdnet] ' + d));
        proc.on('close', code => {
          if (code === 0) console.log('[BIRDASH] BirdNET models downloaded');
          else console.error('[download-birdnet] Process exited with code', code);
        });
      } catch(e) {
        console.error('[download-birdnet]', e.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      }
    })();
    return true;
  }

  // ── Route : GET /api/system/logs-export ────────────────────────────────────
  // Returns recent logs from all birdash services for copy-to-clipboard
  if (req.method === 'GET' && pathname === '/api/system/logs-export') {
    (async () => {
      try {
        const services = ['birdash', 'birdengine', 'birdengine-recording'];
        const blocks = [];
        for (const svc of services) {
          try {
            const logs = await execCmd('journalctl', ['-u', svc, '-n', '50', '--no-pager', '-o', 'short-iso', '--since', '1 hour ago']);
            if (logs.trim()) blocks.push(`══ ${svc} ══\n${logs.trim()}`);
          } catch {}
        }
        let _ver = 'unknown'; try { _ver = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version; } catch {}
        const header = `BirdStation logs — ${new Date().toISOString()}\nVersion: ${_ver}\n`;
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(header + '\n' + blocks.join('\n\n'));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  return false;
}

module.exports = { handle };
