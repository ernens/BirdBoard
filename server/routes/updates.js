'use strict';
/**
 * Update routes — /api/update-status, /api/update-snooze,
 *                 /api/apply-update, /api/force-update,
 *                 /api/rollback-update, /api/update-log
 *
 * Detection model: compares the locally checked-out commit (git rev-parse
 * HEAD) against the latest commit on origin/main (git ls-remote). When the
 * remote is ahead, fetches the commit metadata via the GitHub compare API
 * so the UI can show categorized release notes.
 *
 * Snooze state lives in config/update-state.json with two fields:
 *   - deferUntil: ISO8601 — banner is hidden until this date passes
 *   - skipCommit: SHA      — banner is hidden as long as the latest commit
 *                            equals this SHA (i.e. "ignore this version
 *                            but show me the next one")
 *
 * Apply: spawns scripts/update.sh in a detached child process so the
 * birdash restart inside the script doesn't kill the parent. Status is
 * written to config/update-progress.json at every step; the UI polls
 * /api/update-status?progress=1 to follow the run.
 *
 * Rollback: spawns scripts/rollback.sh <commit> to revert to a known
 * good state. Only available when previousCommit is known (from the
 * last update's progress file).
 */

const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const { spawn, execSync } = require('child_process');
const https = require('https');
const safeConfig = require('../lib/safe-config');

const PROJECT_ROOT  = path.join(__dirname, '..', '..');
const STATE_PATH    = path.join(PROJECT_ROOT, 'config', 'update-state.json');
const PROGRESS_PATH = path.join(PROJECT_ROOT, 'config', 'update-progress.json');
const LOG_PATH      = path.join(PROJECT_ROOT, 'config', 'update.log');
const REPO          = 'ernens/birdash';
const BRANCH        = 'main';

// Stale progress timeout: if a progress file says "running" for more than
// this many ms, we consider the update dead and allow a new attempt.
const STALE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

// 60s in-memory cache so git ls-remote / GitHub aren't hit on every page
// load, but new updates are detected within a minute of landing on main.
let _statusCache = null;
let _statusCacheTs = 0;
const CACHE_TTL = 60 * 1000;

function _git(args) {
  return execSync('git ' + args, { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 15000 }).trim();
}

// Read version from package.json on every call (not cached at startup)
// so that after an update lands a new package.json the version is correct
// even if the server process wasn't restarted.
function _currentVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

function _fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'birdash-update-check', 'Accept': 'application/vnd.github+json' },
      timeout: 10000,
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('GitHub timeout')));
  });
}

function _parseCommit(msg) {
  const lines = msg.split('\n');
  const header = lines[0];
  const body = lines.slice(1).join('\n').trim();
  const m = header.match(/^(\w+)(?:\(([^)]+)\))?(!?):\s*(.+)$/);
  if (m) {
    return {
      type: m[1].toLowerCase(),
      scope: m[2] || null,
      breaking: m[3] === '!',
      subject: m[4],
      body,
    };
  }
  return { type: 'other', scope: null, breaking: false, subject: header, body };
}

async function _computeStatus() {
  const currentCommit = _git('rev-parse HEAD');
  const currentShort = currentCommit.slice(0, 7);
  const currentVersion = _currentVersion();

  let latestCommit, latestShort;
  try {
    const lsRemote = _git(`ls-remote origin ${BRANCH}`);
    latestCommit = lsRemote.split(/\s+/)[0];
    latestShort = latestCommit.slice(0, 7);
  } catch (e) {
    return { error: 'git ls-remote failed: ' + e.message, currentCommit, currentShort, currentVersion };
  }

  if (currentCommit === latestCommit) {
    return {
      currentCommit, currentShort, currentVersion,
      latestCommit, latestShort, latestVersion: currentVersion,
      hasUpdate: false,
      commitsBehind: 0,
      changes: [],
    };
  }

  // Fetch real version from remote package.json (single source of truth).
  // Uses GitHub Contents API which returns JSON with base64-encoded content.
  let latestVersion = currentVersion;
  try {
    const contentsUrl = `https://api.github.com/repos/${REPO}/contents/package.json?ref=${BRANCH}`;
    const contents = await _fetchJson(contentsUrl);
    if (contents && contents.content) {
      const decoded = Buffer.from(contents.content, 'base64').toString('utf8');
      const remotePkg = JSON.parse(decoded);
      if (remotePkg.version) latestVersion = remotePkg.version;
    }
  } catch (e) {
    console.warn('[updates] remote package.json fetch failed:', e.message);
  }

  let commits = [];
  try {
    const compare = await _fetchJson(`https://api.github.com/repos/${REPO}/compare/${currentCommit}...${latestCommit}`);
    commits = (compare.commits || []).map(c => ({
      hash: c.sha,
      short: c.sha.slice(0, 7),
      author: c.commit.author.name,
      date: c.commit.author.date,
      ...(_parseCommit(c.commit.message)),
    }));
  } catch (e) {
    console.warn('[updates] GitHub compare failed:', e.message);
  }

  // hasUpdate must reflect "we are BEHIND origin", not just "hashes differ".
  // When the local HEAD is AHEAD of origin (unpushed commits, dev workflow),
  // GitHub compare/local...remote returns 0 commits — flagging hasUpdate=true
  // there produces a "new version available · 0 updates · no notes" banner.
  return {
    currentCommit, currentShort, currentVersion,
    latestCommit, latestShort, latestVersion,
    hasUpdate: commits.length > 0,
    commitsBehind: commits.length,
    changes: commits,
  };
}

async function _readState() {
  try { return JSON.parse(await fsp.readFile(STATE_PATH, 'utf8')); }
  catch { return {}; }
}

function _isSnoozed(state, latestCommit) {
  if (state.skipCommit && state.skipCommit === latestCommit) {
    return { snoozed: true, reason: 'skipped' };
  }
  if (state.deferUntil) {
    const until = new Date(state.deferUntil).getTime();
    if (Number.isFinite(until) && until > Date.now()) {
      return { snoozed: true, reason: 'deferred', deferUntil: state.deferUntil };
    }
  }
  return { snoozed: false };
}

// Check if the progress file indicates a stale "running" state.
// Returns true if it's safe to start a new update.
async function _isProgressStale() {
  try {
    const raw = await fsp.readFile(PROGRESS_PATH, 'utf8');
    const prog = JSON.parse(raw);
    if (prog.state !== 'running') return true; // not running = safe
    const updated = new Date(prog.updatedAt).getTime();
    if (!Number.isFinite(updated)) return true;
    return (Date.now() - updated) > STALE_TIMEOUT;
  } catch {
    return true; // no file = safe
  }
}

// Spawn a script detached so it survives birdash restart.
function _spawnDetached(script, args) {
  const child = spawn('bash', [script, ...args], {
    detached: true,
    stdio: 'ignore',
    cwd: PROJECT_ROOT,
  });
  child.unref();
  return child.pid;
}

function handle(req, res, pathname, ctx) {
  const { requireAuth, JSON_CT } = ctx;

  // ── GET /api/update-status ─────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/update-status') {
    (async () => {
      try {
        const url = new URL(req.url, 'http://localhost');

        // ?progress=1 — return live progress of an ongoing apply/rollback
        if (url.searchParams.get('progress') === '1') {
          try {
            const raw = await fsp.readFile(PROGRESS_PATH, 'utf8');
            const prog = JSON.parse(raw);
            // Auto-expire stale "running" states
            if (prog.state === 'running') {
              const updated = new Date(prog.updatedAt).getTime();
              if (Number.isFinite(updated) && (Date.now() - updated) > STALE_TIMEOUT) {
                prog.state = 'failed';
                prog.detail = 'Update timed out (no progress for 10 minutes)';
              }
            }
            res.writeHead(200, JSON_CT); res.end(JSON.stringify(prog)); return;
          } catch {
            res.writeHead(200, JSON_CT); res.end(JSON.stringify({ state: 'idle' })); return;
          }
        }

        const now = Date.now();
        let status;
        if (_statusCache && (now - _statusCacheTs) < CACHE_TTL && !url.searchParams.get('refresh')) {
          status = _statusCache;
        } else {
          status = await _computeStatus();
          _statusCache = status;
          _statusCacheTs = now;
        }

        const state = await _readState();
        const snooze = status.hasUpdate ? _isSnoozed(state, status.latestCommit) : { snoozed: false };

        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({ ...status, ...snooze, state }));
      } catch (e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── GET /api/update-log ───────────────────────────────────────────────
  // Returns the last N lines of config/update.log for debugging.
  if (req.method === 'GET' && pathname === '/api/update-log') {
    (async () => {
      try {
        const raw = await fsp.readFile(LOG_PATH, 'utf8');
        // Return last 200 lines
        const lines = raw.split('\n');
        const tail = lines.slice(Math.max(0, lines.length - 200)).join('\n');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(tail);
      } catch {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('(no update log available)');
      }
    })();
    return true;
  }

  // ── POST /api/update-snooze ───────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/update-snooze') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { action, days } = JSON.parse(body);
        if (!['defer', 'skip', 'clear'].includes(action)) {
          throw new Error('action must be defer|skip|clear');
        }
        const status = _statusCache || await _computeStatus();
        const next = await safeConfig.updateConfig(
          STATE_PATH,
          (s) => {
            if (action === 'defer') {
              const d = (days && days > 0 && days < 365) ? days : 1;
              s.deferUntil = new Date(Date.now() + d * 24 * 3600 * 1000).toISOString();
            } else if (action === 'skip') {
              s.skipCommit = status.latestCommit || null;
              s.deferUntil = null;
            } else if (action === 'clear') {
              delete s.deferUntil;
              delete s.skipCommit;
            }
            return s;
          },
          null,
          { label: 'POST /api/update-snooze', defaultValue: {} }
        );
        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({ ok: true, state: next }));
      } catch (e) {
        res.writeHead(400, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // ── POST /api/apply-update ────────────────────────────────────────────
  // Body: (empty) or {force: true}
  if (req.method === 'POST' && pathname === '/api/apply-update') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        let force = false;
        try { force = JSON.parse(body).force === true; } catch {}

        // Check if another update is already running (with stale timeout)
        if (!(await _isProgressStale())) {
          res.writeHead(409, JSON_CT);
          res.end(JSON.stringify({ error: 'update already in progress' }));
          return;
        }

        await safeConfig.updateConfig(
          PROGRESS_PATH,
          () => ({
            state: 'running',
            startedAt: new Date().toISOString(),
            step: 'starting',
          }),
          null,
          { label: 'POST /api/apply-update (init)', defaultValue: {} }
        );

        _statusCache = null;
        _statusCacheTs = 0;

        const script = path.join(PROJECT_ROOT, 'scripts', 'update.sh');
        const args = ['--write-status', PROGRESS_PATH];
        if (force) args.push('--force');
        const pid = _spawnDetached(script, args);

        res.writeHead(202, JSON_CT);
        res.end(JSON.stringify({ ok: true, jobStarted: true, pid }));
      } catch (e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // ── POST /api/rollback-update ─────────────────────────────────────────
  // Body: {commit: "abc123..."} — the full SHA to roll back to.
  // Only works if the commit exists locally (i.e. was the previous HEAD).
  if (req.method === 'POST' && pathname === '/api/rollback-update') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { commit } = JSON.parse(body);
        if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
          throw new Error('Invalid commit SHA');
        }

        // Verify commit exists locally
        try { _git(`cat-file -e ${commit}`); }
        catch { throw new Error('Commit not found locally — cannot rollback'); }

        if (!(await _isProgressStale())) {
          res.writeHead(409, JSON_CT);
          res.end(JSON.stringify({ error: 'operation already in progress' }));
          return;
        }

        await safeConfig.updateConfig(
          PROGRESS_PATH,
          () => ({
            state: 'running',
            startedAt: new Date().toISOString(),
            step: 'rollback',
          }),
          null,
          { label: 'POST /api/rollback-update (init)', defaultValue: {} }
        );

        _statusCache = null;
        _statusCacheTs = 0;

        const script = path.join(PROJECT_ROOT, 'scripts', 'rollback.sh');
        const pid = _spawnDetached(script, [commit, '--write-status', PROGRESS_PATH]);

        res.writeHead(202, JSON_CT);
        res.end(JSON.stringify({ ok: true, jobStarted: true, pid }));
      } catch (e) {
        const code = e.message.includes('not found') ? 400 : 500;
        res.writeHead(code, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  return false;
}

module.exports = { handle };
