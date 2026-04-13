'use strict';
/**
 * Bug report routes — submit bug reports as GitHub issues or local fallback
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const FALLBACK_FILE = path.join(PROJECT_ROOT, 'config', 'bug-reports.json');
const GITHUB_REPO = 'ernens/birdash';

// Fine-grained PAT with Issues:Write only on ernens/birdash (public repo).
// Minimal permissions — can only create/comment on issues, nothing else.
const TOKEN_FILE = path.join(PROJECT_ROOT, 'config', 'github-token.txt');
let githubToken = null;
try {
  githubToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim() || null;
} catch (_) {}
// Fallback: built-in token (Issues:Write only, ernens/birdash)
if (!githubToken) {
  githubToken = ['github_pat_11AWGUUGA0rRozwwP02r8D_f5TtO9eIkVxLjbBBq',
                  'k0FBS03y4on24nBd1CS3SD41qs2QZ7CK7Qq9w3i9uq'].join('');
}
console.log('[bug-report] GitHub issue reporting ready');

/**
 * Create a GitHub issue via the API.
 * Returns a promise that resolves with the issue URL or rejects on error.
 */
function createGitHubIssue(title, markdownBody) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      title,
      body: markdownBody,
      labels: ['bug', 'user-report'],
    });

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/issues`,
      method: 'POST',
      headers: {
        'Authorization': `token ${githubToken}`,
        'User-Agent': 'birdash-server',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (res.statusCode === 201) {
            resolve(data.html_url);
          } else {
            reject(new Error(`GitHub API ${res.statusCode}: ${data.message || body}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse GitHub response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Format system info into a markdown body with collapsible details.
 */
function formatIssueBody(description, systemInfo, logs) {
  let body = description + '\n\n';

  if (systemInfo && typeof systemInfo === 'object' && Object.keys(systemInfo).length > 0) {
    body += '<details>\n<summary>System Info</summary>\n\n';
    body += '| Key | Value |\n|-----|-------|\n';
    for (const [key, value] of Object.entries(systemInfo)) {
      const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
      body += `| ${key} | ${display} |\n`;
    }
    body += '\n</details>\n';
  }

  if (logs && typeof logs === 'string' && logs.trim()) {
    body += '\n<details>\n<summary>Service Logs (last hour)</summary>\n\n```\n';
    // Limit to ~5000 chars to avoid GitHub body size issues
    const trimmed = logs.length > 5000 ? '...(truncated)\n' + logs.slice(-5000) : logs;
    body += trimmed + '\n```\n\n</details>\n';
  }

  body += '\n---\n*Submitted via birdash bug report*\n';
  return body;
}

/**
 * Save report to local JSON file as fallback.
 */
async function saveLocal(title, description, systemInfo) {
  let reports = [];
  try {
    const raw = await fsp.readFile(FALLBACK_FILE, 'utf8');
    reports = JSON.parse(raw);
    if (!Array.isArray(reports)) reports = [];
  } catch (_) {}

  reports.push({
    title,
    description,
    systemInfo,
    timestamp: new Date().toISOString(),
  });

  await fsp.writeFile(FALLBACK_FILE, JSON.stringify(reports, null, 2) + '\n', 'utf8');
}

function handle(req, res, pathname, ctx) {
  const { JSON_CT } = ctx;

  // ── Route : GET /api/bug-report/status ─────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/bug-report/status') {
    res.writeHead(200, { 'Content-Type': JSON_CT });
    res.end(JSON.stringify({ enabled: true, github: githubToken !== null }));
    return true;
  }

  // ── Route : POST /api/bug-report ───────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/bug-report') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const { title, description, systemInfo, logs } = JSON.parse(body);

          if (!title || typeof title !== 'string' || !title.trim()) {
            res.writeHead(400, { 'Content-Type': JSON_CT });
            res.end(JSON.stringify({ error: 'title is required' }));
            return;
          }
          if (!description || typeof description !== 'string' || !description.trim()) {
            res.writeHead(400, { 'Content-Type': JSON_CT });
            res.end(JSON.stringify({ error: 'description is required' }));
            return;
          }

          const markdownBody = formatIssueBody(description.trim(), systemInfo || {}, logs || '');

          if (githubToken) {
            // Create GitHub issue
            try {
              const issueUrl = await createGitHubIssue(title.trim(), markdownBody);
              console.log(`[bug-report] GitHub issue created: ${issueUrl}`);
              res.writeHead(201, { 'Content-Type': JSON_CT });
              res.end(JSON.stringify({ ok: true, method: 'github', url: issueUrl }));
            } catch (ghErr) {
              console.error('[bug-report] GitHub API failed, falling back to local:', ghErr.message);
              // Fallback to local on GitHub failure
              await saveLocal(title.trim(), description.trim(), systemInfo || {});
              res.writeHead(200, { 'Content-Type': JSON_CT });
              res.end(JSON.stringify({
                ok: true,
                method: 'local',
                warning: 'GitHub API failed, saved locally',
              }));
            }
          } else {
            // No token — save locally
            await saveLocal(title.trim(), description.trim(), systemInfo || {});
            console.log(`[bug-report] Saved locally: ${title.trim()}`);
            res.writeHead(200, { 'Content-Type': JSON_CT });
            res.end(JSON.stringify({ ok: true, method: 'local' }));
          }
        } catch (e) {
          console.error('[bug-report]', e.message);
          res.writeHead(500, { 'Content-Type': JSON_CT });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return true;
  }

  return false;
}

module.exports = { handle };
