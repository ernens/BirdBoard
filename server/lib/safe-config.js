'use strict';

/**
 * BIRDASH — safe-config
 *
 * Single entry point for **all** read-modify-write cycles on configuration
 * files. Combines:
 *
 *   1. Per-file mutex (Promise queue keyed by absolute path) so two
 *      concurrent updaters can't lose each other's writes.
 *   2. Deep clone of the loaded state before handing it to the mutator,
 *      so a careless `delete current.x` in route code can't corrupt the
 *      cached document.
 *   3. Full-document validation after the mutator runs, so partial /
 *      inconsistent states never reach disk.
 *   4. Atomic write via tmp file + rename(2). The tmp filename includes
 *      pid + timestamp + random suffix so racing callers (which the
 *      mutex shouldn't allow, but defense in depth) cannot unlink each
 *      other's temp file.
 *   5. Structured logging: `[safe-config] <label> <basename> <verdict>
 *      in <ms>ms` — file, route, duration, ok/err. Greppable.
 *
 * The lock map is process-global. Multi-process consistency would
 * require a real file lock (flock/lockfile) — out of scope for the
 * current single-node birdash backend.
 *
 * USAGE
 *
 *   const sc = require('./lib/safe-config');
 *
 *   // JSON config (most cases)
 *   const next = await sc.updateConfig(
 *     '/abs/path/audio_config.json',
 *     current => ({ ...current, gain: 1.5 }),
 *     next    => { if (next.gain < 0) throw new Error('gain < 0'); },
 *     { label: 'POST /api/audio/config' }
 *   );
 *
 *   // Custom format (e.g. KEY=VALUE, TOML, YAML) — pass parser/serializer
 *   await sc.updateConfig(BIRDNET_CONF, mutator, validator, {
 *     parser:     parseBirdnetConf,
 *     serializer: serializeBirdnetConf,
 *     label: 'POST /api/settings',
 *   });
 *
 *   // Plain text overwrite (apprise.txt, .asoundrc) — no read-modify cycle
 *   await sc.writeRaw('/abs/path/apprise.txt', urls.join('\n') + '\n', {
 *     label: 'POST /api/apprise',
 *   });
 *
 *   // Bring an existing read-modify-write hand-roll under the same lock
 *   await sc.withLock(BIRDNET_CONF, async () => {
 *     // Custom logic (e.g. needing sudo cp at the end). Whatever happens
 *     // inside this callback is serialized against any other safe-config
 *     // operation on the same path.
 *   });
 */

const fs   = require('fs');
const fsp  = fs.promises;
const path = require('path');
const crypto = require('crypto');

// ── etag helper ─────────────────────────────────────────────────────────────
// Used by GET endpoints to advertise the current revision and by PUT/POST
// endpoints to detect lost updates between two browser tabs editing the
// same file. The etag is short SHA-1 of the on-disk content; it changes
// only when the bytes change, so an idempotent re-save doesn't trigger
// false 409s.

function etagFor(content) {
  return '"' + crypto.createHash('sha1').update(content).digest('hex').slice(0, 16) + '"';
}

async function etagOfFile(absPath) {
  try {
    const buf = await fsp.readFile(absPath);
    return etagFor(buf);
  } catch (e) {
    if (e.code === 'ENOENT') return '"empty"';
    throw e;
  }
}

// ── Per-path mutex ──────────────────────────────────────────────────────────
// Each lock is the *tail* of a Promise chain for that file. Acquiring the
// lock means appending a new task to the chain; releasing happens implicitly
// when that task settles. Lock map entries are kept until the chain idles
// to keep the map small.

const _locks = new Map();   // absolutePath → Promise (tail of chain)

function withLock(absPath, fn) {
  const key = path.resolve(absPath);
  const prev = _locks.get(key) || Promise.resolve();
  // Run regardless of whether prev resolved or rejected; we don't want one
  // failing writer to wedge the queue for that file.
  const next = prev.then(fn, fn);
  _locks.set(key, next.catch(() => {}));
  // Best-effort cleanup so the map doesn't grow forever.
  next.finally(() => {
    if (_locks.get(key) && _locks.get(key) === next.catch(() => {})) {
      // No-op: identity check is unreliable across .catch chains.
      // We accept a small steady-state map size (one entry per known file).
    }
  }).catch(() => {});
  return next;
}

// ── Atomic write helper ─────────────────────────────────────────────────────

async function _atomicWrite(absPath, content) {
  const dir  = path.dirname(absPath);
  const base = path.basename(absPath);
  const tmp  = path.join(
    dir,
    `.${base}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`
  );
  let fd = null;
  try {
    fd = await fsp.open(tmp, 'w', 0o644);
    await fd.writeFile(content);
    // Force the data + metadata to disk before rename, so a power loss
    // between rename and the actual block write can't leave a 0-byte file.
    await fd.sync().catch(() => {});  // datasync may fail on tmpfs etc.
    await fd.close();
    fd = null;
    await fsp.rename(tmp, absPath);
  } catch (err) {
    if (fd) await fd.close().catch(() => {});
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

// ── Deep clone (structuredClone with fallback) ─────────────────────────────

const _deepClone = (typeof structuredClone === 'function')
  ? (v) => structuredClone(v)
  : (v) => JSON.parse(JSON.stringify(v));

// ── Public: updateConfig ────────────────────────────────────────────────────

/**
 * StaleEtagError — thrown by updateConfig when opts.ifMatch is supplied
 * and doesn't match the current on-disk etag. Distinct class so route
 * handlers can map it to HTTP 409 Conflict.
 */
class StaleEtagError extends Error {
  constructor(expected, actual) {
    super(`stale etag: expected ${expected}, got ${actual}`);
    this.code = 'STALE_ETAG';
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Read → deep clone → mutate → validate → atomic write, under per-file lock.
 *
 * @param {string} filePath
 * @param {(current: any) => any | Promise<any>} mutator
 * @param {((next: any) => void | Promise<void>) | null} [validator]
 * @param {object} [opts]
 * @param {(raw: string) => any} [opts.parser=JSON.parse]
 * @param {(value: any) => string} [opts.serializer]
 * @param {*} [opts.defaultValue={}] - used when the file is missing
 * @param {string} [opts.label='updateConfig'] - log label, e.g. the route name
 * @param {string} [opts.ifMatch] - etag from a previous GET; if it doesn't
 *   match the current file etag, throws StaleEtagError without writing.
 * @returns {Promise<{value:any, etag:string}>} persisted state + new etag
 */
async function updateConfig(filePath, mutator, validator = null, opts = {}) {
  const abs = path.resolve(filePath);
  const parser     = opts.parser     || JSON.parse;
  const serializer = opts.serializer || ((v) => JSON.stringify(v, null, 2));
  const defaultValue = (opts.defaultValue !== undefined) ? opts.defaultValue : {};
  const label = opts.label || 'updateConfig';
  const base  = path.basename(abs);

  return withLock(abs, async () => {
    const t0 = Date.now();
    let current;
    let rawContent;
    try {
      rawContent = await fsp.readFile(abs, 'utf8');
      try {
        current = parser(rawContent);
      } catch (parseErr) {
        console.error(`[safe-config] ${label} ${base} PARSE FAILED in ${Date.now()-t0}ms: ${parseErr.message}`);
        throw parseErr;
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        current = _deepClone(defaultValue);
        rawContent = '';
      } else if (e.message && /JSON|parser|parse/i.test(e.message)) {
        throw e;
      } else {
        console.error(`[safe-config] ${label} ${base} READ FAILED in ${Date.now()-t0}ms: ${e.message}`);
        throw e;
      }
    }

    // Optimistic concurrency: if the caller passed ifMatch, fail fast
    // before running the mutator (so we don't waste work and the user
    // doesn't see a half-applied state).
    if (opts.ifMatch) {
      const currentEtag = etagFor(rawContent);
      if (currentEtag !== opts.ifMatch) {
        console.warn(`[safe-config] ${label} ${base} STALE ETAG in ${Date.now()-t0}ms: expected ${opts.ifMatch}, got ${currentEtag}`);
        throw new StaleEtagError(opts.ifMatch, currentEtag);
      }
    }

    let next;
    try {
      const clone = _deepClone(current);
      next = await mutator(clone);
      if (next === undefined) next = clone;  // mutator that mutates in place
      if (validator) await validator(next);
    } catch (err) {
      console.warn(`[safe-config] ${label} ${base} REJECTED in ${Date.now()-t0}ms: ${err.message}`);
      throw err;
    }

    let serialized;
    try {
      serialized = serializer(next);
      await _atomicWrite(abs, serialized);
    } catch (err) {
      console.error(`[safe-config] ${label} ${base} WRITE FAILED in ${Date.now()-t0}ms: ${err.message}`);
      throw err;
    }

    const etag = etagFor(serialized);
    console.log(`[safe-config] ${label} ${base} OK in ${Date.now()-t0}ms etag=${etag}`);
    // Backwards-compatible return: callers that read .value or .etag can
    // do so, but the value is also still iterable / spread-friendly. We
    // return a wrapped object only when ifMatch is used; otherwise return
    // the bare value to avoid breaking existing callers.
    return opts.ifMatch ? { value: next, etag } : next;
  });
}

// ── Public: writeRaw ────────────────────────────────────────────────────────

/**
 * Atomically overwrite a file with new content. Use this when there's no
 * read-modify cycle (the new content is computed elsewhere — e.g. apprise
 * URL list rendered from form fields, or a generated .asoundrc).
 *
 * @param {string} filePath
 * @param {string|Buffer} content
 * @param {object} [opts]
 * @param {string} [opts.label='writeRaw']
 * @returns {Promise<void>}
 */
async function writeRaw(filePath, content, opts = {}) {
  const abs   = path.resolve(filePath);
  const label = opts.label || 'writeRaw';
  const base  = path.basename(abs);
  return withLock(abs, async () => {
    const t0 = Date.now();
    try {
      await _atomicWrite(abs, content);
      console.log(`[safe-config] ${label} ${base} OK in ${Date.now()-t0}ms`);
    } catch (err) {
      console.error(`[safe-config] ${label} ${base} WRITE FAILED in ${Date.now()-t0}ms: ${err.message}`);
      throw err;
    }
  });
}

module.exports = { updateConfig, writeRaw, withLock, etagOfFile, etagFor, StaleEtagError };
