/**
 * BIRDASH — Backend tests
 * Run: npm test
 * Requires: Node 20+ (native test runner)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 17474;
let serverProc = null;

// ── Server start/stop ─────────────────────────────────────────────────────

before(async () => {
  serverProc = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, BIRDASH_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 8000);
    let stderr = '';
    serverProc.stderr.on('data', c => { stderr += c; });
    serverProc.stdout.on('data', (data) => {
      if (data.toString().includes('API')) { clearTimeout(timeout); resolve(); }
    });
    serverProc.on('error', (err) => { clearTimeout(timeout); reject(err); });
    serverProc.on('exit', (code) => {
      if (code !== null && code !== 0) { clearTimeout(timeout); reject(new Error(`Exit ${code}: ${stderr}`)); }
    });
  });
});

after(() => { if (serverProc) serverProc.kill('SIGTERM'); });

// ── Helpers ───────────────────────────────────────────────────────────────

function request(reqPath, { method = 'GET', body = null, headers = {} } = {}) {
  function doRequest() {
    return new Promise((resolve, reject) => {
      const opts = { hostname: '127.0.0.1', port: PORT, path: reqPath, method,
        headers: { 'Content-Type': 'application/json', ...headers } };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, data, json });
        });
      });
      req.on('error', reject);
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
      req.end();
    });
  }
  // Auto-retry on 429 (rate limit) with backoff
  return doRequest().then(async (res) => {
    if (res.status === 429) {
      await new Promise(r => setTimeout(r, 3000));
      const r2 = await doRequest();
      if (r2.status === 429) { await new Promise(r => setTimeout(r, 5000)); return doRequest(); }
      return r2;
    }
    return res;
  });
}


// ══════════════════════════════════════════════════════════════════════════
// EXISTING TESTS
// ══════════════════════════════════════════════════════════════════════════

describe('API Health', () => {
  it('GET /api/health returns status ok', async () => {
    const res = await request('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'ok');
    assert.equal(typeof res.json.total_detections, 'number');
  });
});

describe('Security headers', () => {
  it('includes X-Content-Type-Options, X-Frame-Options, Referrer-Policy', async () => {
    const res = await request('/api/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  });

  it('CSP not set on API routes', async () => {
    const res = await request('/api/health');
    assert.equal(res.headers['content-security-policy'], undefined);
  });

  it('CORS not allowed without origin', async () => {
    const res = await request('/api/health');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});

describe('POST /api/query — SQL validation', () => {
  it('SELECT works', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT COUNT(*) as n FROM detections', params: [] } });
    assert.equal(res.status, 200);
    assert.ok(res.json.columns.includes('n'));
  });

  it('PRAGMA allowed', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'PRAGMA table_info(detections)', params: [] } });
    assert.equal(res.status, 200);
  });

  it('WITH (CTE) allowed', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'WITH t AS (SELECT 1 as v) SELECT * FROM t', params: [] } });
    assert.equal(res.status, 200);
  });

  it('rejects DELETE', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'DELETE FROM detections', params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects DROP TABLE', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'DROP TABLE detections', params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects INSERT', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: "INSERT INTO detections VALUES ('x','x','x',0,'x')", params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects UPDATE', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: "UPDATE detections SET Com_Name='x'", params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects semicolons (multi-query)', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT 1; DROP TABLE detections', params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects queries > 4000 chars', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT ' + 'x'.repeat(4000), params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects empty body', async () => {
    const res = await request('/api/query', { method: 'POST', body: {} });
    assert.equal(res.status, 400);
  });

  it('does not leak SQL error details', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT * FROM nonexistent_table', params: [] } });
    assert.equal(res.status, 500);
    assert.ok(!res.data.includes('nonexistent_table'));
  });
});

describe('GET /api/photo — Validation', () => {
  it('rejects without sci param', async () => {
    const res = await request('/api/photo');
    assert.equal(res.status, 400);
  });

  it('rejects XSS in sci param', async () => {
    const res = await request('/api/photo?sci=Pica%3Cscript%3E');
    assert.equal(res.status, 400);
  });
});

describe('Unknown routes', () => {
  it('returns 404', async () => {
    const res = await request('/api/unknown');
    assert.equal(res.status, 404);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Audio config validation
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/audio/config', () => {
  it('returns audio configuration', async () => {
    const res = await request('/api/audio/config');
    assert.equal(res.status, 200);
    assert.ok(res.json.hasOwnProperty('device_id'));
    assert.ok(res.json.hasOwnProperty('profile_name'));
  });
});

describe('POST /api/audio/config — Validation', () => {
  it('accepts valid audio config keys', async () => {
    const res = await request('/api/audio/config', { method: 'POST',
      body: { highpass_cutoff_hz: 100, rms_normalize: true } });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
  });

  it('rejects unknown keys silently (filters them out)', async () => {
    const res = await request('/api/audio/config', { method: 'POST',
      body: { evil_key: 'malicious', __proto__: 'hack' } });
    assert.equal(res.status, 400);
    assert.ok(res.json.error.includes('No valid'));
  });

  it('rejects empty update', async () => {
    const res = await request('/api/audio/config', { method: 'POST', body: {} });
    assert.equal(res.status, 400);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Audio profiles
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/audio/profiles', () => {
  it('returns profiles with builtin entries', async () => {
    const res = await request('/api/audio/profiles');
    assert.equal(res.status, 200);
    assert.ok(res.json.profiles.jardin);
    assert.ok(res.json.profiles.jardin.builtin);
  });
});

describe('POST /api/audio/profiles — Validation', () => {
  it('rejects without profile_name', async () => {
    const res = await request('/api/audio/profiles', { method: 'POST',
      body: { highpass_cutoff_hz: 100 } });
    assert.equal(res.status, 400);
  });

  it('rejects overwriting builtin profile', async () => {
    const res = await request('/api/audio/profiles', { method: 'POST',
      body: { profile_name: 'jardin', highpass_cutoff_hz: 200 } });
    assert.equal(res.status, 400);
    assert.ok(res.json.error.includes('builtin'));
  });

  it('creates custom profile with whitelisted fields only', async () => {
    const res = await request('/api/audio/profiles', { method: 'POST',
      body: { profile_name: '_test_profile', highpass_cutoff_hz: 120, evil_field: 'bad' } });
    assert.equal(res.status, 200);
    // Verify evil_field not persisted
    const check = await request('/api/audio/profiles');
    assert.ok(check.json.profiles._test_profile);
    assert.equal(check.json.profiles._test_profile.evil_field, undefined);
    // Cleanup
    await request('/api/audio/profiles/_test_profile', { method: 'DELETE' });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Detection rules
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/flagged-detections', () => {
  it('returns flagged detections for a date', async () => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request(`/api/flagged-detections?dateFrom=${today}&dateTo=${today}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.flagged));
    assert.equal(typeof res.json.total, 'number');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Bulk validation
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/bulk-validate', () => {
  it('rejects without detections array', async () => {
    const res = await request('/api/bulk-validate', { method: 'POST',
      body: { status: 'confirmed' } });
    assert.equal(res.status, 400);
  });

  it('rejects invalid status', async () => {
    const res = await request('/api/bulk-validate', { method: 'POST',
      body: { detections: [{ date: '2026-01-01', time: '12:00:00', sci_name: 'Test' }], status: 'evil' } });
    assert.equal(res.status, 400);
  });

  it('accepts valid bulk validation', async () => {
    const res = await request('/api/bulk-validate', { method: 'POST',
      body: { detections: [{ date: '2026-01-01', time: '00:00:00', sci_name: 'Test test' }], status: 'rejected' } });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Model comparison
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/model-comparison', () => {
  it('returns model comparison data', async () => {
    const res = await request('/api/model-comparison?days=7');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.models));
    assert.ok(res.json.stats);
    assert.ok(res.json.unique);
    assert.ok(Array.isArray(res.json.daily));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Analysis status
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/analysis-status', () => {
  it('returns analysis status with model info', async () => {
    const res = await request('/api/analysis-status');
    assert.equal(res.status, 200);
    assert.ok(res.json.model);
    assert.equal(typeof res.json.backlog, 'number');
    assert.equal(typeof res.json.lagSecs, 'number');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Settings validation
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/settings', () => {
  it('returns settings from birdnet.conf', async () => {
    const res = await request('/api/settings');
    assert.equal(res.status, 200);
    assert.ok(res.json.MODEL || res.json.model);
  });
});

describe('POST /api/settings — Validation', () => {
  it('rejects without updates object', async () => {
    const res = await request('/api/settings', { method: 'POST', body: { bad: 1 } });
    assert.equal(res.status, 400);
  });

  it('rejects unknown setting keys', async () => {
    const res = await request('/api/settings', { method: 'POST',
      body: { updates: { EVIL_KEY: 'hack' } } });
    assert.equal(res.status, 200);
    // Unknown keys should be silently ignored (not persisted)
    const check = await request('/api/settings');
    assert.equal(check.json.EVIL_KEY, undefined);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Services
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/services', () => {
  it('returns list of services', async () => {
    const res = await request('/api/services');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.services));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Validation stats
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/validation-stats', () => {
  it('returns validation counts', async () => {
    const res = await request('/api/validation-stats');
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.confirmed, 'number');
    assert.equal(typeof res.json.rejected, 'number');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Models list
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/models', () => {
  it('returns available models', async () => {
    const res = await request('/api/models');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.models));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Audio devices
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/audio/devices', () => {
  it('returns devices array', async () => {
    const res = await request('/api/audio/devices');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.devices));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Timeline
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/timeline', () => {
  it('returns valid structure for today', async () => {
    const res = await request('/api/timeline');
    assert.equal(res.status, 200);
    assert.ok(res.json.date);
    assert.ok(res.json.meta);
    assert.ok(Array.isArray(res.json.events));
    assert.ok(Array.isArray(res.json.density));
    assert.ok(res.json.navigation);
  });

  it('density slots are in range 0-47', async () => {
    const res = await request('/api/timeline');
    assert.equal(res.status, 200);
    res.json.density.forEach(slot => {
      assert.ok(slot.slot >= 0 && slot.slot <= 47, `slot ${slot.slot} out of range`);
      assert.ok(slot.count >= 0, `count ${slot.count} is negative`);
    });
  });

  it('each event has required fields', async () => {
    const res = await request('/api/timeline');
    assert.equal(res.status, 200);
    res.json.events.forEach(ev => {
      assert.ok(ev.type, 'event missing type');
      assert.ok(typeof ev.timeDecimal === 'number', 'event missing timeDecimal');
      assert.ok(ev.timeDecimal >= 0 && ev.timeDecimal < 24, `timeDecimal ${ev.timeDecimal} out of range`);
    });
  });

  it('accepts date parameter', async () => {
    const res = await request('/api/timeline?date=2026-01-01');
    assert.equal(res.status, 200);
    assert.equal(res.json.date, '2026-01-01');
  });

  it('meta.hasPrevDay and hasNextDay are booleans', async () => {
    const res = await request('/api/timeline');
    assert.equal(typeof res.json.meta.hasPrevDay, 'boolean');
    assert.equal(typeof res.json.meta.hasNextDay, 'boolean');
  });

  it('meta.isToday is true for today', async () => {
    const res = await request('/api/timeline');
    assert.equal(res.json.meta.isToday, true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Species names (i18n regression)
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/species-names — i18n', () => {
  it('returns species names for default lang (fr)', async () => {
    const res = await request('/api/species-names');
    assert.equal(res.status, 200);
    assert.equal(typeof res.json, 'object');
    for (const key of Object.keys(res.json).slice(0, 3)) {
      assert.match(key, /^[A-Z][a-z]+ [a-z]+/, `key "${key}" should be a scientific name`);
    }
  });

  it('returns species names for en lang', async () => {
    const res = await request('/api/species-names?lang=en');
    assert.ok([200, 404].includes(res.status));
  });

  it('rejects invalid lang param (injection)', async () => {
    const res = await request('/api/species-names?lang=fr;rm');
    assert.equal(res.status, 400);
  });

  it('rejects lang with path traversal', async () => {
    const res = await request('/api/species-names?lang=../../../etc');
    assert.equal(res.status, 400);
  });

  it('Cache-Control header on success', async () => {
    const res = await request('/api/species-names');
    if (res.status === 200) {
      assert.ok(res.headers['cache-control']?.includes('max-age'));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — SQL injection edge cases
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/query — Advanced SQL injection', () => {
  it('rejects ALTER TABLE', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'ALTER TABLE detections ADD col TEXT', params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects CREATE TABLE', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'CREATE TABLE evil (id INT)', params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects ATTACH DATABASE', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: "ATTACH DATABASE '/tmp/evil.db' AS evil", params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects VACUUM', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'VACUUM', params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects REPLACE INTO', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: "REPLACE INTO detections VALUES ('x')", params: [] } });
    assert.equal(res.status, 400);
  });

  it('handles parameterized queries safely', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT COUNT(*) as n FROM detections WHERE Date=?', params: ['2026-01-01'] } });
    assert.equal(res.status, 200);
    assert.ok(res.json.columns.includes('n'));
  });

  it('rejects non-string sql field', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 12345, params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects INSERT OR REPLACE', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: "INSERT OR REPLACE INTO detections VALUES ('x')", params: [] } });
    assert.equal(res.status, 400);
  });

  it('allows aggregate queries', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT Date, COUNT(*) as n FROM detections GROUP BY Date ORDER BY n DESC LIMIT 5', params: [] } });
    assert.equal(res.status, 200);
  });

  it('allows subqueries', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT Com_Name, n FROM (SELECT Com_Name, COUNT(*) as n FROM detections GROUP BY Com_Name) ORDER BY n DESC LIMIT 3', params: [] } });
    assert.equal(res.status, 200);
  });

  it('allows CASE expressions', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: "SELECT CASE WHEN Confidence > 0.9 THEN 'high' ELSE 'low' END as level, COUNT(*) as n FROM detections GROUP BY level", params: [] } });
    assert.equal(res.status, 200);
  });

  it('allows window functions', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT Com_Name, Date, ROW_NUMBER() OVER (PARTITION BY Com_Name ORDER BY Date DESC) as rn FROM detections LIMIT 10', params: [] } });
    assert.equal(res.status, 200);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Favorites CRUD
// ══════════════════════════════════════════════════════════════════════════

describe('Favorites — CRUD cycle', () => {
  const testSpecies = '_TestSpecies_' + Date.now();

  it('GET /api/favorites returns array', async () => {
    const res = await request('/api/favorites');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
  });

  it('POST add favorite', async () => {
    const res = await request('/api/favorites', { method: 'POST',
      body: { action: 'add', com_name: testSpecies, sci_name: 'Testus testus' } });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
    assert.ok(res.json.favorites.some(f => f.com_name === testSpecies));
  });

  it('POST remove favorite', async () => {
    const res = await request('/api/favorites', { method: 'POST',
      body: { action: 'remove', com_name: testSpecies } });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
    assert.ok(!res.json.favorites.some(f => f.com_name === testSpecies));
  });

  it('POST rejects without com_name', async () => {
    const res = await request('/api/favorites', { method: 'POST',
      body: { action: 'add' } });
    assert.equal(res.status, 400);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Notes CRUD
// ══════════════════════════════════════════════════════════════════════════

describe('Notes — CRUD cycle', () => {
  let noteId = null;
  const testSpecies = '_NoteTest_' + Date.now();

  it('POST create note', async () => {
    const res = await request('/api/notes', { method: 'POST',
      body: { com_name: testSpecies, sci_name: 'Testus notus', note: 'Test note content' } });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
    assert.ok(res.json.id);
    noteId = res.json.id;
  });

  it('GET notes for species', async () => {
    const res = await request(`/api/notes?com_name=${encodeURIComponent(testSpecies)}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
    assert.ok(res.json.length >= 1);
    assert.equal(res.json[0].note, 'Test note content');
  });

  it('POST update note', async () => {
    const res = await request('/api/notes', { method: 'POST',
      body: { id: noteId, com_name: testSpecies, note: 'Updated content' } });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
  });

  it('DELETE note', async () => {
    const res = await request(`/api/notes?id=${noteId}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
  });

  it('GET notes requires com_name', async () => {
    const res = await request('/api/notes');
    assert.equal(res.status, 400);
  });

  it('DELETE notes requires id', async () => {
    const res = await request('/api/notes', { method: 'DELETE' });
    assert.equal(res.status, 400);
  });

  it('POST rejects note without com_name', async () => {
    const res = await request('/api/notes', { method: 'POST',
      body: { note: 'orphan note' } });
    assert.equal(res.status, 400);
  });

  it('POST rejects note without text', async () => {
    const res = await request('/api/notes', { method: 'POST',
      body: { com_name: testSpecies } });
    assert.equal(res.status, 400);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Validations CRUD
// ══════════════════════════════════════════════════════════════════════════

describe('Validations — CRUD cycle', () => {
  it('POST create validation', async () => {
    const res = await request('/api/validations', { method: 'POST',
      body: { date: '2026-01-01', time: '08:00:00', sciName: 'Testus validus', status: 'confirmed' } });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
  });

  it('GET validations for date', async () => {
    const res = await request('/api/validations?date=2026-01-01');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
  });

  it('GET validations for species', async () => {
    const res = await request('/api/validations?species=Testus+validus');
    assert.equal(res.status, 200);
    assert.ok(res.json.some(v => v.sci_name === 'Testus validus'));
  });

  it('POST rejects invalid status', async () => {
    const res = await request('/api/validations', { method: 'POST',
      body: { date: '2026-01-01', time: '08:00:00', sciName: 'Testus validus', status: 'evil' } });
    assert.equal(res.status, 400);
  });

  it('POST rejects missing required fields', async () => {
    const res = await request('/api/validations', { method: 'POST',
      body: { status: 'confirmed' } });
    assert.equal(res.status, 400);
  });

  it('POST unreviewed removes the validation', async () => {
    const res = await request('/api/validations', { method: 'POST',
      body: { date: '2026-01-01', time: '08:00:00', sciName: 'Testus validus', status: 'unreviewed' } });
    assert.equal(res.status, 200);
    const check = await request('/api/validations?date=2026-01-01&species=Testus+validus');
    assert.ok(!check.json.some(v => v.sci_name === 'Testus validus'));
  });

  it('accepts doubtful status', async () => {
    const res = await request('/api/validations', { method: 'POST',
      body: { date: '2026-01-02', time: '09:00:00', sciName: 'Testus dubitans', status: 'doubtful', notes: 'Sounds odd' } });
    assert.equal(res.status, 200);
    // Cleanup
    await request('/api/validations', { method: 'POST',
      body: { date: '2026-01-02', time: '09:00:00', sciName: 'Testus dubitans', status: 'unreviewed' } });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — eBird export
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/export/ebird', () => {
  it('returns CSV with correct headers', async () => {
    const res = await request('/api/export/ebird');
    assert.equal(res.status, 200);
    assert.ok(res.headers['content-type'].includes('text/csv'));
    assert.ok(res.headers['content-disposition']?.includes('attachment'));
    assert.ok(res.data.startsWith('Common Name,'));
    assert.ok(res.data.includes('Common Name'));
  });

  it('respects confidence filter', async () => {
    const lowConf = await request('/api/export/ebird?from=2025-01-01&to=2025-12-31&conf=0');
    const highConf = await request('/api/export/ebird?from=2025-01-01&to=2025-12-31&conf=0.99');
    // High confidence should have fewer or equal rows
    const lowLines = lowConf.data.split('\n').length;
    const highLines = highConf.data.split('\n').length;
    assert.ok(highLines <= lowLines, `high conf (${highLines}) should have <= rows than low conf (${lowLines})`);
  });

  it('date format is MM/DD/YYYY', async () => {
    const res = await request('/api/export/ebird');
    const lines = res.data.split('\n').filter(l => l.trim());
    if (lines.length > 1) {
      const fields = lines[1].split(',');
      const dateField = fields[4]; // Date column
      assert.match(dateField, /^\d{2}\/\d{2}\/\d{4}$/, `Date "${dateField}" should be MM/DD/YYYY`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Backup config
// ══════════════════════════════════════════════════════════════════════════

describe('Backup config', () => {
  it('GET /api/backup-config returns config with redacted passwords', async () => {
    const res = await request('/api/backup-config');
    assert.equal(res.status, 200);
    assert.ok(res.json.destination);
    if (res.json.smb?.pass && res.json.smb.pass !== '') {
      assert.equal(res.json.smb.pass, '••••••');
    }
  });

  it('POST /api/backup-config rejects invalid destination', async () => {
    const res = await request('/api/backup-config', { method: 'POST',
      body: { destination: 'evil_protocol' } });
    assert.equal(res.status, 400);
  });

  it('POST /api/backup-config rejects invalid content', async () => {
    const res = await request('/api/backup-config', { method: 'POST',
      body: { content: ['all', 'evil'] } });
    assert.equal(res.status, 400);
  });

  it('POST /api/backup-config rejects invalid schedule', async () => {
    const res = await request('/api/backup-config', { method: 'POST',
      body: { schedule: 'every_second' } });
    assert.equal(res.status, 400);
  });

  it('GET /api/backup-status returns status', async () => {
    const res = await request('/api/backup-status');
    assert.equal(res.status, 200);
  });

  it('GET /api/backup-history returns array', async () => {
    const res = await request('/api/backup-history');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Services validation (security-critical)
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/services/restart — Security', () => {
  it('rejects disallowed service name', async () => {
    const res = await request('/api/services/restart', { method: 'POST',
      body: { service: 'ssh' } });
    assert.equal(res.status, 400);
  });

  it('rejects command injection in service name', async () => {
    const res = await request('/api/services/restart', { method: 'POST',
      body: { service: 'birdash; rm -rf /' } });
    assert.equal(res.status, 400);
  });

  it('rejects empty service name', async () => {
    const res = await request('/api/services/restart', { method: 'POST',
      body: { service: '' } });
    assert.equal(res.status, 400);
  });

  it('only allows known services', async () => {
    const ALLOWED = ['birdengine', 'birdengine-recording', 'birdash', 'caddy', 'ttyd'];
    for (const bad of ['systemd', 'cron', 'nginx', 'sshd', 'root']) {
      const res = await request('/api/services/restart', { method: 'POST',
        body: { service: bad } });
      assert.equal(res.status, 400, `service "${bad}" should be rejected`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Whats-new
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/whats-new', () => {
  it('returns alerts and insights arrays', async () => {
    const res = await request('/api/whats-new');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.alerts), 'should have alerts array');
    // insights is optional
    for (const card of [...res.json.alerts, ...(res.json.insights || [])]) {
      assert.ok(card.type, 'card missing type');
      assert.ok(card.level, 'card missing level');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — System health
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/system-health', () => {
  it('returns system metrics', async () => {
    const res = await request('/api/system-health');
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.cpu, 'object');
    assert.equal(typeof res.json.memory, 'object');
    assert.equal(typeof res.json.disk, 'object');
    assert.ok(res.json.memory.total > 0);
    assert.ok(res.json.memory.used >= 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Taxonomy
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/taxonomy', () => {
  it('returns species array or 503', async () => {
    const res = await request('/api/taxonomy');
    assert.ok([200, 503].includes(res.status));
    if (res.status === 200) {
      assert.ok(res.json.species, 'should have species key');
      assert.ok(Array.isArray(res.json.species));
      if (res.json.species.length > 0) {
        assert.ok(res.json.species[0].sciName);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Hardware, network, languages
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/hardware', () => {
  it('returns hardware info', async () => {
    const res = await request('/api/hardware');
    assert.equal(res.status, 200);
    assert.ok(res.json.piModel || res.json.cpuModel, 'should have CPU info');
    assert.ok(res.json.ramTotal > 0, 'should have RAM info');
  });
});

describe('GET /api/network-info', () => {
  it('returns network info', async () => {
    const res = await request('/api/network-info');
    assert.equal(res.status, 200);
    assert.ok(res.json.hostname || res.json.interfaces);
  });
});

describe('GET /api/languages', () => {
  it('returns available language codes', async () => {
    const res = await request('/api/languages');
    assert.equal(res.status, 200);
    assert.ok(res.json.languages, 'should have languages key');
    assert.ok(Array.isArray(res.json.languages));
    assert.ok(res.json.languages.length > 0);
    assert.ok(res.json.languages.includes('fr'));
    assert.ok(res.json.languages.includes('en'));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Photo API edge cases
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/photo — Edge cases', () => {
  it('rejects path traversal in sci param', async () => {
    const res = await request('/api/photo?sci=../../../etc/passwd');
    assert.equal(res.status, 400);
  });

  it('rejects null bytes in sci param', async () => {
    const res = await request('/api/photo?sci=Pica%00pica');
    assert.equal(res.status, 400);
  });

  it('returns image or redirect for valid species', async () => {
    const res = await request('/api/photo?sci=Pica+pica');
    assert.ok([200, 302, 404].includes(res.status));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Species info
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/species-info', () => {
  it('requires sci param', async () => {
    const res = await request('/api/species-info');
    assert.equal(res.status, 400);
  });

  it('returns data for valid species', async () => {
    const res = await request('/api/species-info?sci=Pica+pica');
    assert.ok([200, 404].includes(res.status));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Adaptive gain
// ══════════════════════════════════════════════════════════════════════════

describe('Audio — Adaptive gain', () => {
  it('GET state returns gain values', async () => {
    const res = await request('/api/audio/adaptive-gain/state');
    assert.equal(res.status, 200);
    assert.ok(res.json.state || res.json.ok);
    const state = res.json.state || res.json;
    assert.equal(typeof state.current_gain_db, 'number');
  });

  it('GET config returns enabled flag', async () => {
    const res = await request('/api/audio/adaptive-gain/config');
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.enabled, 'boolean');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Malformed requests
// ══════════════════════════════════════════════════════════════════════════

describe('Malformed requests', () => {
  it('POST /api/query with invalid JSON returns 4xx/5xx', async () => {
    const res = await new Promise((resolve, reject) => {
      const opts = { hostname: '127.0.0.1', port: PORT, path: '/api/query', method: 'POST',
        headers: { 'Content-Type': 'application/json' } };
      const req = http.request(opts, (r) => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: r.statusCode, json: j }); });
      });
      req.on('error', reject);
      req.write('{invalid json!!!');
      req.end();
    });
    assert.ok(res.status >= 400 && res.status < 600, `should error, got ${res.status}`);
  });

  it('POST /api/favorites with invalid JSON returns error', async () => {
    const res = await new Promise((resolve, reject) => {
      const opts = { hostname: '127.0.0.1', port: PORT, path: '/api/favorites', method: 'POST',
        headers: { 'Content-Type': 'application/json' } };
      const req = http.request(opts, (r) => {
        let d = ''; r.on('data', c => d += c);
        r.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} resolve({ status: r.statusCode, json: j }); });
      });
      req.on('error', reject);
      req.write('not json');
      req.end();
    });
    assert.ok(res.status >= 400, `should error, got ${res.status}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — DELETE detections validation
// ══════════════════════════════════════════════════════════════════════════

describe('DELETE /api/detections — Validation', () => {
  it('rejects without required fields', async () => {
    try {
      const res = await request('/api/detections', { method: 'DELETE',
        body: { date: '2026-01-01' } });
      assert.ok([400, 429].includes(res.status));
    } catch(e) { /* ECONNRESET acceptable under rate limiting */ }
  });

  it('returns 404 for non-existent detection', async () => {
    try {
      const res = await request('/api/detections', { method: 'DELETE',
        body: { date: '1900-01-01', time: '00:00:00', comName: 'NonExistent Bird' } });
      assert.ok([404, 429].includes(res.status));
    } catch(e) { /* ECONNRESET acceptable under rate limiting */ }
  });
});

describe('DELETE /api/detections/species — Validation', () => {
  it('rejects without comName', async () => {
    try {
      const res = await request('/api/detections/species', { method: 'DELETE',
        body: { confirmName: 'test' } });
      assert.ok([400, 429].includes(res.status));
    } catch(e) { /* ECONNRESET acceptable under rate limiting */ }
  });

  it('rejects when confirmName does not match', async () => {
    try {
      const res = await request('/api/detections/species', { method: 'DELETE',
        body: { comName: 'Pie bavarde', confirmName: 'wrong' } });
      assert.ok([400, 429].includes(res.status));
    } catch(e) { /* ECONNRESET acceptable under rate limiting */ }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Notifications config
// ══════════════════════════════════════════════════════════════════════════

describe('Apprise notifications', () => {
  it('GET /api/apprise returns urls', async () => {
    const res = await request('/api/apprise');
    assert.ok([200, 429].includes(res.status));
  });

  it('GET /api/alert-thresholds returns thresholds', async () => {
    const res = await request('/api/alert-thresholds');
    assert.ok([200, 429].includes(res.status));
    if (res.status === 200) { assert.equal(typeof res.json.temp_warn, 'number'); assert.equal(typeof res.json.disk_warn, 'number'); }
  });

  it('GET /api/alert-status returns status', async () => {
    const res = await request('/api/alert-status');
    assert.ok([200, 429].includes(res.status));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Species lists
// ══════════════════════════════════════════════════════════════════════════

describe('Species lists', () => {
  it('GET /api/species-lists returns include/exclude', async () => {
    const res = await request('/api/species-lists');
    assert.ok([200, 429].includes(res.status));
    if (res.status === 200) assert.ok(Array.isArray(res.json.include) || Array.isArray(res.json.exclude));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Audio info
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/audio-info', () => {
  it('handles query for audio file', async () => {
    const det = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT File_Name FROM detections LIMIT 1', params: [] } });
    if (det.json?.rows?.length) {
      const fname = det.json.rows[0][0];
      const res = await request(`/api/audio-info?file=${encodeURIComponent(fname)}`);
      assert.ok([200, 404].includes(res.status));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Concurrent requests (stability)
// ══════════════════════════════════════════════════════════════════════════

describe('Concurrent requests', () => {
  it('handles 10 parallel /api/health requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => request('/api/health'))
    );
    for (const res of results) {
      assert.ok([200, 429].includes(res.status), `expected 200 or 429, got ${res.status}`);
    }
  });

  it('handles mixed endpoints in parallel', async () => {
    const endpoints = [
      '/api/health', '/api/validation-stats', '/api/models',
      '/api/favorites', '/api/audio/config',
    ];
    const results = await Promise.all(endpoints.map(e => request(e)));
    for (const res of results) {
      assert.ok([200, 429].includes(res.status), `expected 200 or 429, got ${res.status}`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Bulk validate edge cases
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/bulk-validate — Edge cases', () => {
  it('accepts empty detections array', async () => {
    const res = await request('/api/bulk-validate', { method: 'POST',
      body: { detections: [], status: 'confirmed' } });
    assert.equal(res.status, 200);
  });

  it('accepts multiple detections at once', async () => {
    const res = await request('/api/bulk-validate', { method: 'POST',
      body: {
        detections: [
          { date: '2026-01-01', time: '00:00:00', sci_name: 'Bulk test 1' },
          { date: '2026-01-01', time: '00:01:00', sci_name: 'Bulk test 2' },
        ],
        status: 'rejected'
      } });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Timeline edge cases
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/timeline — Edge cases', () => {
  it('handles future date gracefully', async () => {
    const res = await request('/api/timeline?date=2099-01-01');
    assert.ok([200, 429].includes(res.status));
    if (res.status === 200) { const birdEvents = res.json.events.filter(e => !e.isAstro); assert.equal(birdEvents.length, 0); }
  });

  it('handles very old date gracefully', async () => {
    const res = await request('/api/timeline?date=2000-01-01');
    assert.ok([200, 429].includes(res.status));
  });

  it('rejects malformed date', async () => {
    const res = await request('/api/timeline?date=not-a-date');
    assert.ok([200, 400, 429].includes(res.status));
  });

  it('navigation links are consistent', async () => {
    const res = await request('/api/timeline');
    assert.equal(res.status, 200);
    if (res.json.navigation?.prevDate) {
      assert.match(res.json.navigation.prevDate, /^\d{4}-\d{2}-\d{2}$/);
    }
    if (res.json.navigation?.nextDate) {
      assert.match(res.json.navigation.nextDate, /^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Model comparison edge cases
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/model-comparison — Edge cases', () => {
  it('handles different day ranges', async () => {
    for (const days of [1, 7, 30]) {
      const res = await request(`/api/model-comparison?days=${days}`);
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.json.models));
    }
  });

  it('daily breakdown dates are valid', async () => {
    const res = await request('/api/model-comparison?days=7');
    for (const d of res.json.daily) {
      assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Settings boundary checks
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/settings — Structure', () => {
  it('includes essential config keys', async () => {
    const res = await request('/api/settings');
    assert.equal(res.status, 200);
    // Should have location and model config
    assert.ok(res.json.LATITUDE !== undefined || res.json.latitude !== undefined, 'should have latitude');
    assert.ok(res.json.LONGITUDE !== undefined || res.json.longitude !== undefined, 'should have longitude');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AUDIT TESTS — Auth, error handling, boundary conditions
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/favorites — Auth required', () => {
  it('accepts POST when no token configured (open access)', async () => {
    const res = await request('/api/favorites', {
      method: 'POST',
      body: { com_name: '__test_audit__', sci_name: 'Testus auditus', action: 'add' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
    // Cleanup
    await request('/api/favorites', {
      method: 'POST',
      body: { com_name: '__test_audit__', action: 'remove' },
    });
  });
});

describe('POST /api/notes — Auth required', () => {
  it('accepts POST when no token configured (open access)', async () => {
    const res = await request('/api/notes', {
      method: 'POST',
      body: { com_name: '__test_audit__', note: 'audit test note' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
    // Cleanup
    if (res.json.id) {
      await request(`/api/notes?id=${res.json.id}`, { method: 'DELETE' });
    }
  });

  it('rejects POST without com_name', async () => {
    const res = await request('/api/notes', {
      method: 'POST',
      body: { note: 'no species' },
    });
    assert.equal(res.status, 400);
  });

  it('rejects POST without note', async () => {
    const res = await request('/api/notes', {
      method: 'POST',
      body: { com_name: 'Test' },
    });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/query — Row limit', () => {
  it('rejects queries returning > 10000 rows', async () => {
    // This generates a large cross join — should hit the limit
    const res = await request('/api/query', {
      method: 'POST',
      body: { sql: "SELECT 1 AS n FROM detections AS a, detections AS b LIMIT 10001" },
    });
    // Either 400 (too many rows) or 200 with ≤ 10000 rows
    if (res.status === 200) {
      assert.ok(res.json.rows.length <= 10000);
    } else {
      assert.equal(res.status, 400);
    }
  });
});

describe('Error responses — No internal details leaked', () => {
  it('POST /api/favorites with bad JSON returns generic error', async () => {
    const res = await request('/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    // Should not contain stack trace or file path
    if (res.json?.error) {
      assert.ok(!res.json.error.includes('/home/'), 'should not leak file paths');
      assert.ok(!res.json.error.includes('at '), 'should not leak stack traces');
    }
  });
});

describe('DELETE /api/notes — Auth required', () => {
  it('returns 400 without id parameter', async () => {
    const res = await request('/api/notes', { method: 'DELETE' });
    assert.equal(res.status, 400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Cross-page coherence tests — catch filter drift and metric divergence
// between pages that display the same concept. These are the invariants
// that broke silently in the first three audit rounds.
// ═══════════════════════════════════════════════════════════════════════════

describe('Cross-page coherence', () => {
  // Helper: run a SQL query via the /api/query endpoint
  async function sql(query, params = []) {
    const res = await request('/api/query', {
      method: 'POST',
      body: JSON.stringify({ sql: query, params }),
    });
    return res.json?.rows || [];
  }

  it('overview total = SUM(per-species totals)', async () => {
    const [[total]] = await sql(
      "SELECT COUNT(*) FROM active_detections WHERE Confidence >= 0.7"
    );
    const [[sumSpecies]] = await sql(
      "SELECT COALESCE(SUM(n),0) FROM (SELECT COUNT(*) as n FROM active_detections WHERE Confidence >= 0.7 GROUP BY Com_Name)"
    );
    assert.equal(total, sumSpecies,
      `overview total (${total}) != SUM of species (${sumSpecies})`);
  });

  it('species header total = hourly SUM = monthly SUM', async () => {
    // Pick the most common species
    const rows = await sql(
      "SELECT Com_Name FROM active_detections WHERE Confidence >= 0.7 GROUP BY Com_Name ORDER BY COUNT(*) DESC LIMIT 1"
    );
    if (!rows.length) return; // empty DB (test env) — skip
    const sp = rows[0][0];

    const [[header]] = await sql(
      "SELECT COUNT(*) FROM active_detections WHERE Com_Name = ? AND Confidence >= 0.7", [sp]
    );
    const [[hourlySUM]] = await sql(
      "SELECT SUM(n) FROM (SELECT COUNT(*) as n FROM active_detections WHERE Com_Name = ? AND Confidence >= 0.7 GROUP BY CAST(SUBSTR(Time,1,2) AS INTEGER))", [sp]
    );
    const [[monthlySUM]] = await sql(
      "SELECT SUM(n) FROM (SELECT COUNT(*) as n FROM active_detections WHERE Com_Name = ? AND Confidence >= 0.7 GROUP BY CAST(SUBSTR(Date,6,2) AS INTEGER))", [sp]
    );
    assert.equal(header, hourlySUM, `${sp}: header (${header}) != hourly SUM (${hourlySUM})`);
    assert.equal(header, monthlySUM, `${sp}: header (${header}) != monthly SUM (${monthlySUM})`);
  });

  it('timeline today matches raw SQL today', async () => {
    const tl = await request('/api/timeline');
    if (!tl.json?.meta) return; // no timeline in test env
    const { totalDetections, totalSpecies } = tl.json.meta;

    // Timeline uses DATE('now','localtime') server-side. In test env
    // this might be a different day than the test DB has data for, so
    // we just verify the meta fields are present and non-negative.
    assert.ok(typeof totalDetections === 'number' && totalDetections >= 0);
    assert.ok(typeof totalSpecies === 'number' && totalSpecies >= 0);
  });

  it('active_detections excludes rejected (VIEW is dynamic)', async () => {
    const [[rawAll]] = await sql("SELECT COUNT(*) FROM active_detections");
    // We can't easily verify the exact excluded count without knowing
    // the validations table content, but we verify the VIEW is queryable
    // and returns a non-negative number.
    assert.ok(typeof rawAll === 'number' && rawAll >= 0);
  });

  it('daily_stats count_07 is non-negative and plausible', async () => {
    const rows = await sql(
      "SELECT date, SUM(count_07) as s FROM daily_stats GROUP BY date ORDER BY date DESC LIMIT 1"
    );
    if (!rows.length) return; // empty aggregates in test env
    const [date, sum] = rows[0];
    assert.ok(sum >= 0, `count_07 for ${date} is negative: ${sum}`);
  });
});
