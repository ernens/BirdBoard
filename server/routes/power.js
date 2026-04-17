/**
 * power.js — Power management (service restart, reboot, shutdown)
 *
 * Exposes:
 *   GET  /api/power           → capability probe (sudoReady flag + action list)
 *   POST /api/power           → { action: 'restart-service' | 'reboot' | 'shutdown' }
 *
 * Liveness poll uses the existing /api/health in detections.js.
 *
 * The actual commands need passwordless sudo. The expected sudoers drop-in
 * is `/etc/sudoers.d/birdash`:
 *   birdash ALL=(root) NOPASSWD: /sbin/shutdown, /bin/systemctl restart birdash
 *
 * If sudo isn't configured, POST /api/power returns 501 with a hint so the
 * user knows exactly what to add instead of a silent failure.
 */

const { spawn, execFileSync } = require('child_process');

const ACTIONS = {
  'restart-service': { cmd: '/bin/systemctl', args: ['restart', 'birdash'],     delayMs: 400 },
  'reboot':          { cmd: '/sbin/shutdown', args: ['-r', 'now'],              delayMs: 800 },
  'shutdown':        { cmd: '/sbin/shutdown', args: ['-h', 'now'],              delayMs: 800 },
};

// One-shot sudo capability probe — checks both binaries. Cached for the process
// lifetime so we don't pay for it on every request.
let _sudoReady = null;
function _checkSudo() {
  if (_sudoReady !== null) return _sudoReady;
  try {
    execFileSync('sudo', ['-n', '-l', '/sbin/shutdown'],         { stdio: 'ignore' });
    execFileSync('sudo', ['-n', '-l', '/bin/systemctl', 'restart', 'birdash'], { stdio: 'ignore' });
    _sudoReady = true;
  } catch { _sudoReady = false; }
  return _sudoReady;
}

function handle(req, res, pathname, ctx) {
  const { requireAuth, JSON_CT, jsonOk, jsonErr } = ctx;

  // GET /api/power — capability check so the UI can hide the Pi buttons when
  // sudo isn't wired up yet (restart-service works without sudo on dev).
  if (req.method === 'GET' && pathname === '/api/power') {
    jsonOk(res, { sudoReady: _checkSudo(), actions: Object.keys(ACTIONS) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/power') {
    if (!requireAuth(req, res)) return true;

    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      if (req._bodyLimited && req._bodyLimited()) return;
      let action;
      try { ({ action } = JSON.parse(body || '{}')); }
      catch { return jsonErr(res, 400, 'Invalid JSON'); }

      const spec = ACTIONS[action];
      if (!spec) return jsonErr(res, 400, 'Unknown action: ' + action);

      if (action !== 'restart-service' && !_checkSudo()) {
        res.writeHead(501, JSON_CT);
        res.end(JSON.stringify({
          error: 'Passwordless sudo not configured',
          hint: 'Add /etc/sudoers.d/birdash with: birdash ALL=(root) NOPASSWD: /sbin/shutdown, /bin/systemctl restart birdash',
        }));
        return;
      }

      // 202 Accepted — we respond immediately, then fire the command a beat
      // later so the response actually makes it back to the client before the
      // process gets reaped by the shutdown.
      res.writeHead(202, JSON_CT);
      res.end(JSON.stringify({ ok: true, action, scheduled: true }));

      setTimeout(() => {
        try {
          const child = spawn('sudo', ['-n', spec.cmd, ...spec.args], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
        } catch (e) {
          console.error('[power] spawn failed:', e.message);
        }
      }, spec.delayMs);
    });
    return true;
  }

  return false;
}

module.exports = { handle };
