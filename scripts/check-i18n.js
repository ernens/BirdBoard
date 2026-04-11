#!/usr/bin/env node
/**
 * check-i18n — verify that public/i18n/{fr,en,de,nl}.json all have the
 * same set of keys, and that no t('foo') call in HTML/JS templates
 * references a key missing from any of them.
 *
 * Run manually after editing translations:
 *
 *     node scripts/check-i18n.js
 *
 * Exits non-zero on failure so it can also be wired into a pre-commit
 * hook later. Reports:
 *   1. Per-language coverage gaps (key in one file, missing from
 *      another). Symmetric — fr-vs-en, en-vs-de, etc.
 *   2. Keys called via t('foo') in templates that don't exist in any
 *      language file.
 *   3. (Informational) keys defined in every language file but never
 *      referenced — these can usually be deleted but verify first.
 *
 * The "no fr.json drift" rule that motivated this whole audit is
 * automatically enforced by check 1: fr.json is now the single source
 * of truth (loaded at runtime by bird-vue-core.js), so any divergence
 * shows up as a coverage gap immediately.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const I18N = path.join(REPO, 'public', 'i18n');
const LANGS = ['fr', 'en', 'de', 'nl'];

let exitCode = 0;
const fail = (msg) => { console.error('  ✗', msg); exitCode = 1; };
const ok   = (msg) => console.log('  ✓', msg);
const info = (msg) => console.log('  ·', msg);

// ── 1. Load and parse all four files ───────────────────────────────────────

const dicts = {};
for (const lang of LANGS) {
  const p = path.join(I18N, `${lang}.json`);
  try {
    dicts[lang] = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.error(`✗ ${lang}.json: ${e.message}`);
    process.exit(1);
  }
}

console.log('# i18n coverage check\n');
for (const lang of LANGS) {
  info(`${lang}.json: ${Object.keys(dicts[lang]).length} keys`);
}

// ── 2. Symmetric coverage check ────────────────────────────────────────────

console.log('\n## Coverage gaps');
let gaps = 0;
for (let i = 0; i < LANGS.length; i++) {
  for (let j = 0; j < LANGS.length; j++) {
    if (i === j) continue;
    const a = LANGS[i], b = LANGS[j];
    const missing = Object.keys(dicts[a]).filter(k => !(k in dicts[b]));
    if (missing.length) {
      gaps += missing.length;
      fail(`${missing.length} key(s) in ${a}.json but not in ${b}.json`);
      missing.slice(0, 5).forEach(k => console.error(`      - ${k}`));
      if (missing.length > 5) console.error(`      … and ${missing.length - 5} more`);
    }
  }
}
if (gaps === 0) ok('all four languages have the same key set');

// ── 3. Find t('foo') calls in templates and verify each key exists ─────────

console.log('\n## t() calls vs dict');

function* walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      yield* walk(p);
    } else if (/\.(html|js|vue)$/.test(name)) {
      yield p;
    }
  }
}

// Match t('key') OR t("key") followed by either:
//   - a closing paren (literal call)
//   - a comma (with vars: t('foo', {n: 5}))
// Reject patterns where the next char is '+' (dynamic concat: t('prefix_' + x))
// or where the key ends with '_' (heuristic for the same pattern in case of
// unusual whitespace).
const callRe = /\bt\(\s*['"]([a-zA-Z][a-zA-Z0-9_]*)['"]\s*([,)+])/g;
const allCalls = new Map(); // key → first file:line where seen
for (const file of walk(path.join(REPO, 'public'))) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let m;
    callRe.lastIndex = 0;
    while ((m = callRe.exec(lines[i])) !== null) {
      const key = m[1];
      const trailing = m[2];
      // Skip dynamic concatenations and prefix-ending keys.
      if (trailing === '+') continue;
      if (key.endsWith('_')) continue;
      if (!allCalls.has(key)) {
        allCalls.set(key, `${path.relative(REPO, file)}:${i + 1}`);
      }
    }
  }
}
info(`${allCalls.size} unique t() keys referenced across templates`);

const referencedSet = new Set(allCalls.keys());
const missingFromAll = [];
for (const [key, loc] of allCalls) {
  // A key is "missing" if no language file defines it.
  const inAny = LANGS.some(l => key in dicts[l]);
  if (!inAny) missingFromAll.push({ key, loc });
}
if (missingFromAll.length) {
  fail(`${missingFromAll.length} t() call(s) reference an undefined key`);
  missingFromAll.forEach(({ key, loc }) =>
    console.error(`      - t('${key}')  @ ${loc}`)
  );
} else {
  ok('every t() call has at least one translation');
}

// ── 4. Stale keys (defined but never referenced) — informational ───────────

console.log('\n## Stale keys (defined in every language but never referenced)');
const definedInAll = Object.keys(dicts.fr).filter(k =>
  LANGS.every(l => k in dicts[l])
);
const stale = definedInAll.filter(k => !referencedSet.has(k) && k !== '_meta');
if (stale.length) {
  info(`${stale.length} unreferenced key(s) (informational, may still be used dynamically):`);
  stale.slice(0, 15).forEach(k => console.log(`      - ${k}`));
  if (stale.length > 15) console.log(`      … and ${stale.length - 15} more`);
  console.log('      (note: keys built dynamically as t(prefix + var) won\'t be detected here)');
} else {
  ok('no stale keys');
}

console.log('');
process.exit(exitCode);
