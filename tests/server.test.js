/**
 * BIRDASH — Tests du backend (bird-server.js)
 * Exécuter : npm test
 * Requiert : Node 20+ (test runner natif)
 * Le serveur est démarré automatiquement avant les tests.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 17474; // Port dédié aux tests (évite conflit avec prod)
let serverProc = null;

// ── Démarrage/arrêt du serveur ────────────────────────────────────────────

before(async () => {
  serverProc = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, BIRDASH_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Attendre que le serveur soit prêt (max 5s)
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 5000);
    let stderr = '';
    serverProc.stderr.on('data', c => { stderr += c; });
    serverProc.stdout.on('data', (data) => {
      if (data.toString().includes('API démarrée')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    serverProc.on('error', (err) => { clearTimeout(timeout); reject(err); });
    serverProc.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}: ${stderr}`));
      }
    });
  });
});

after(() => {
  if (serverProc) serverProc.kill('SIGTERM');
});

// ── Helpers ────────────────────────────────────────────────────────────────

function request(reqPath, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: PORT,
      path: reqPath,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch(e) {}
        resolve({ status: res.statusCode, headers: res.headers, data, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('API Health', () => {
  it('GET /api/health retourne status ok', async () => {
    const res = await request('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'ok');
    assert.equal(typeof res.json.total_detections, 'number');
  });
});

describe('Security headers', () => {
  it('inclut X-Content-Type-Options, X-Frame-Options, Referrer-Policy', async () => {
    const res = await request('/api/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  });

  it('CORS non autorisé sans origin', async () => {
    const res = await request('/api/health');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});

describe('POST /api/query — Validation SQL', () => {
  it('SELECT simple fonctionne', async () => {
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: 'SELECT COUNT(*) as n FROM detections', params: [] },
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.columns.includes('n'));
    assert.ok(res.json.rows.length > 0);
  });

  it('SELECT avec paramètres fonctionne', async () => {
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: 'SELECT COUNT(*) as n FROM detections WHERE Confidence >= ?', params: [0.8] },
    });
    assert.equal(res.status, 200);
  });

  it('WITH (CTE) est autorisé', async () => {
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: 'WITH t AS (SELECT 1 as v) SELECT * FROM t', params: [] },
    });
    assert.equal(res.status, 200);
  });

  it('PRAGMA est autorisé', async () => {
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: 'PRAGMA table_info(detections)', params: [] },
    });
    assert.equal(res.status, 200);
  });

  it('rejette DELETE', async () => {
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: 'DELETE FROM detections', params: [] },
    });
    assert.equal(res.status, 400);
  });

  it('rejette DROP TABLE', async () => {
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: 'DROP TABLE detections', params: [] },
    });
    assert.equal(res.status, 400);
  });

  it('rejette INSERT', async () => {
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: "INSERT INTO detections VALUES ('x','x','x',0,'x')", params: [] },
    });
    assert.equal(res.status, 400);
  });

  it('rejette les points-virgules (multi-requête)', async () => {
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: 'SELECT 1; DROP TABLE detections', params: [] },
    });
    assert.equal(res.status, 400);
  });

  it('rejette les requêtes trop longues (>4000 chars)', async () => {
    const longSql = 'SELECT ' + 'x'.repeat(4000);
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: longSql, params: [] },
    });
    assert.equal(res.status, 400);
  });

  it('rejette un body vide', async () => {
    const res = await request('/api/query', {
      method: 'POST',
      body: {},
    });
    assert.equal(res.status, 400);
  });

  it('ne divulgue pas les détails d\'erreur SQL', async () => {
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: 'SELECT * FROM table_inexistante', params: [] },
    });
    assert.equal(res.status, 500);
    assert.ok(!res.data.includes('table_inexistante'), 'Le message d\'erreur ne doit pas exposer les détails SQL');
  });
});

describe('Routes inconnues', () => {
  it('retourne 404 pour les routes inconnues', async () => {
    const res = await request('/api/unknown');
    assert.equal(res.status, 404);
  });
});

describe('GET /api/photo — Validation', () => {
  it('rejette sans paramètre sci', async () => {
    const res = await request('/api/photo');
    assert.equal(res.status, 400);
  });

  it('rejette un sci avec caractères spéciaux', async () => {
    const res = await request('/api/photo?sci=Pica%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    assert.equal(res.status, 400);
  });

  it('accepte un nom scientifique valide', async () => {
    const res = await request('/api/photo?sci=Pica%20pica');
    // 200 (cache), 404 (pas trouvé), 500/502 (API externe en erreur) sont tous valides
    assert.ok([200, 404, 500, 502].includes(res.status), `Status inattendu: ${res.status}`);
  });
});

describe('GET /api/birdweather — Validation paramètres', () => {
  it('refuse les endpoints invalides (utilise le défaut)', async () => {
    const res = await request('/api/birdweather?endpoint=evil');
    // Soit 200 (réponse valide) soit 200 avec erreur no_station
    assert.equal(res.status, 200);
  });
});
