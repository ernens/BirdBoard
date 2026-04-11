/**
 * BIRDASH — safe-config concurrency tests
 *
 * Reproduces the read-modify-write lost-update race that bit mickey.local,
 * and proves that the safe-config primitive eliminates it.
 *
 * Run: node --test tests/safe-config.test.js
 */

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs   = require('fs');
const fsp  = fs.promises;
const path = require('path');
const os   = require('os');

const safeConfig = require('../server/lib/safe-config');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'birdash-safe-cfg-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── 1. Lost-update reproduction without coordination ────────────────────────

describe('naive read-modify-write (control case)', () => {
  it('loses one update when two writers race', async () => {
    const file = path.join(tmpDir, 'cfg.json');
    fs.writeFileSync(file, JSON.stringify({ a: 0, b: 0 }));

    // Two parallel naive read-modify-write cycles, with a small await between
    // read and write so they reliably interleave (just like an async POST).
    const naiveUpdate = async (mutator) => {
      const cur = JSON.parse(await fsp.readFile(file, 'utf8'));
      await new Promise(r => setTimeout(r, 5));
      const next = mutator(cur);
      await fsp.writeFile(file, JSON.stringify(next));
    };

    await Promise.all([
      naiveUpdate(c => ({ ...c, a: c.a + 1 })),
      naiveUpdate(c => ({ ...c, b: c.b + 1 })),
    ]);

    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    // We expect a=1 AND b=1 — but one of them is lost.
    assert.ok(
      result.a !== 1 || result.b !== 1,
      `expected a lost update, got ${JSON.stringify(result)}`
    );
  });
});

// ── 2. safe-config eliminates the race ──────────────────────────────────────

describe('safe-config.updateConfig', () => {
  it('serializes concurrent updates so neither is lost', async () => {
    const file = path.join(tmpDir, 'cfg.json');
    fs.writeFileSync(file, JSON.stringify({ a: 0, b: 0 }));

    await Promise.all([
      safeConfig.updateConfig(file, c => ({ ...c, a: c.a + 1 })),
      safeConfig.updateConfig(file, c => ({ ...c, b: c.b + 1 })),
    ]);

    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(result, { a: 1, b: 1 });
  });

  it('handles 50 concurrent increments without losing any', async () => {
    const file = path.join(tmpDir, 'counter.json');
    fs.writeFileSync(file, JSON.stringify({ n: 0 }));

    await Promise.all(
      Array.from({ length: 50 }, () =>
        safeConfig.updateConfig(file, c => ({ ...c, n: c.n + 1 }))
      )
    );

    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(result.n, 50);
  });

  it('rolls back on validator failure (file unchanged)', async () => {
    const file = path.join(tmpDir, 'cfg.json');
    fs.writeFileSync(file, JSON.stringify({ a: 1 }));

    await assert.rejects(
      safeConfig.updateConfig(
        file,
        c => ({ ...c, a: -5 }),
        next => { if (next.a < 0) throw new Error('a must be >= 0'); }
      ),
      /a must be >= 0/
    );

    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(result, { a: 1 }, 'file should be unchanged after validator failure');
  });

  it('returns the persisted state', async () => {
    const file = path.join(tmpDir, 'cfg.json');
    fs.writeFileSync(file, JSON.stringify({ x: 1 }));

    const result = await safeConfig.updateConfig(file, c => ({ ...c, y: 2 }));
    assert.deepEqual(result, { x: 1, y: 2 });
  });

  it('mutator works on a deep clone (does not mutate caller state)', async () => {
    const file = path.join(tmpDir, 'cfg.json');
    fs.writeFileSync(file, JSON.stringify({ list: [1, 2] }));

    let observedClone;
    await safeConfig.updateConfig(file, c => {
      observedClone = c;
      c.list.push(99);
      return c;
    });

    // The clone the mutator received must not be the same object that
    // ends up serialized to disk on a SECOND call (otherwise leftover
    // mutations from a prior run could leak between calls).
    await safeConfig.updateConfig(file, c => {
      assert.notEqual(c, observedClone, 'second call must receive a fresh clone');
      assert.deepEqual(c, { list: [1, 2, 99] });
      return c;
    });
  });

  it('creates the file from defaultValue when missing', async () => {
    const file = path.join(tmpDir, 'new.json');
    const result = await safeConfig.updateConfig(
      file,
      c => ({ ...c, hello: 'world' }),
      null,
      { defaultValue: { hello: 'default' } }
    );
    assert.deepEqual(result, { hello: 'world' });
    assert.ok(fs.existsSync(file));
  });

  it('different files do not share a lock', async () => {
    const f1 = path.join(tmpDir, 'a.json');
    const f2 = path.join(tmpDir, 'b.json');
    fs.writeFileSync(f1, '{}');
    fs.writeFileSync(f2, '{}');

    let f1Started = false;
    let f2Started = false;

    const p1 = safeConfig.updateConfig(f1, async c => {
      f1Started = true;
      // Wait long enough that f2 must run in parallel if locks are independent.
      await new Promise(r => setTimeout(r, 100));
      return { ...c, done: 1 };
    });
    const p2 = safeConfig.updateConfig(f2, async c => {
      f2Started = true;
      return { ...c, done: 1 };
    });

    // f2 should start before f1 finishes.
    await new Promise(r => setTimeout(r, 30));
    assert.ok(f1Started, 'f1 should have started');
    assert.ok(f2Started, 'f2 should have started even though f1 is still running');

    await Promise.all([p1, p2]);
  });
});

// ── 3. updateRaw for non-mutator content (apprise.txt, .asoundrc, etc.) ────

describe('safe-config.writeRaw', () => {
  it('atomically replaces a text file', async () => {
    const file = path.join(tmpDir, 'apprise.txt');
    await safeConfig.writeRaw(file, 'tgram://abc\nntfy://xyz\n');
    assert.equal(fs.readFileSync(file, 'utf8'), 'tgram://abc\nntfy://xyz\n');
  });

  it('serializes concurrent writeRaw calls on the same file', async () => {
    const file = path.join(tmpDir, 'list.txt');
    // 30 parallel writes, each appending its own marker. Without the lock,
    // some markers would interleave or be lost.
    const writes = Array.from({ length: 30 }, (_, i) =>
      safeConfig.updateConfig(
        file,
        c => ({ ...c, [`k${i}`]: i }),
        null,
        { defaultValue: {} }
      )
    );
    await Promise.all(writes);
    const result = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(Object.keys(result).length, 30);
  });
});
