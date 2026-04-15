'use strict';
/**
 * Update routes — /api/update-status, /api/update-snooze, /api/apply-update
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
 * written to config/update-status.json at every step; the UI polls
 * /api/update-status?progress=1 to follow the run.
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
const REPO          = 'ernens/birdash';
const BRANCH        = 'main';

// 60s in-memory cache so git ls-remote / GitHub aren't hit on every page
// load, but new updates are detected within a minute of landing on main.
// Previously 5 minutes, which was too long — the banner didn't appear
// until the cache expired, confusing testers.
let _statusCache = null;
let _statusCacheTs = 0;
const CACHE_TTL = 60 * 1000;

function _git(args) {
  return execSync('git ' + args, { cwd: PROJECT_ROOT, encoding: 'utf8' }).trim();
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

// Parse a conventional-commits message into {type, scope, subject, body}.
//   "feat(audio): bla bla\n\nlonger body" → {type:'feat', scope:'audio', subject:'bla bla', body:'longer body'}
//   "Fix typo"                              → {type:'other', scope:null, subject:'Fix typo', body:''}
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

// Read the version from package.json (single source of truth).
// No dependency on git tags being present locally — avoids the
// chicken-and-egg problem where update.sh needs --tags but the
// old update.sh (without --tags) ran first.
const _pkgVersion = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
})();

function _currentVersion() {
  return _pkgVersion;
}

async function _computeStatus() {
  const currentCommit = _git('rev-parse HEAD');
  const currentShort = currentCommit.slice(0, 7);
  const currentVersion = _currentVersion();

  // Latest remote commit on the tracked branch — single round-trip, no fetch.
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

  // Fetch the commit list between current and latest from GitHub. We could
  // also do a local `git fetch + git log` but that pulls all the objects
  // before the user has even decided to update — wasteful on slow links.
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
    // Non-fatal: we still know there's an update, just no notes.
    console.warn('[updates] GitHub compare failed:', e.message);
  }

  // The remote version isn't known until the update is applied, so we
  // just report commits-behind. The actual version bump will be visible
  // after the pull lands the new package.json.
  const latestVersion = currentVersion;

  return {
    currentCommit, currentShort, currentVersion,
    latestCommit, latestShort, latestVersion,
    hasUpdate: true,
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

function handle(req, res, pathname, ctx) {
  const { requireAuth, JSON_CT } = ctx;

  // ── GET /api/update-status ─────────────────────────────────────────────
  // Returns the cached check + snooze state. ?progress=1 returns the live
  // progress of an ongoing apply (if any) instead.
  if (req.method === 'GET' && pathname === '/api/update-status') {
    (async () => {
      try {
        const url = new URL(req.url, 'http://localhost');
        if (url.searchParams.get('progress') === '1') {
          try {
            const raw = await fsp.readFile(PROGRESS_PATH, 'utf8');
            res.writeHead(200, JSON_CT); res.end(raw); return;
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

  // ── POST /api/update-snooze ───────────────────────────────────────────
  // Body: {action: "defer"|"skip"|"clear", days?: 1}
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
  // Spawns scripts/update.sh in a detached process. The script writes its
  // own progress to PROGRESS_PATH. We return immediately so the response
  // isn't killed by the birdash restart inside the script.
  if (req.method === 'POST' && pathname === '/api/apply-update') {
    if (!requireAuth(req, res)) return true;
    (async () => {
      try {
        // Make sure no other apply is in flight.
        try {
          const raw = await fsp.readFile(PROGRESS_PATH, 'utf8');
          const prog = JSON.parse(raw);
          if (prog.state === 'running') {
            res.writeHead(409, JSON_CT);
            res.end(JSON.stringify({ error: 'update already in progress' }));
            return;
          }
        } catch {}

        // Reset progress file so the UI sees a fresh start.
        await safeConfig.updateConfig(
          PROGRESS_PATH,
          () => ({
            state: 'running',
            startedAt: new Date().toISOString(),
            step: 'starting',
            log: [],
          }),
          null,
          { label: 'POST /api/apply-update (init)', defaultValue: {} }
        );

        // Invalidate the status cache so the next /api/update-status
        // (which the UI calls right after the apply finishes) doesn't
        // serve a stale "update available" snapshot.
        _statusCache = null;
        _statusCacheTs = 0;

        // Spawn update.sh detached so the birdash restart inside doesn't
        // take the response down with it. The script handles the rest.
        const script = path.join(PROJECT_ROOT, 'scripts', 'update.sh');
        const child = spawn('bash', [script, '--write-status', PROGRESS_PATH], {
          detached: true,
          stdio: 'ignore',
          cwd: PROJECT_ROOT,
        });
        child.unref();

        res.writeHead(202, JSON_CT);
        res.end(JSON.stringify({ ok: true, jobStarted: true, pid: child.pid }));
      } catch (e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  return false;
}

module.exports = { handle };
