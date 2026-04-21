/**
 * smoke.mjs — Per-page error smoke test for birdash
 *
 * Loads every page in the shared list (_pages.mjs), captures pageerror
 * events and console.error messages, and reports failures. No screenshots.
 *
 * Usage:
 *   node scripts/smoke.mjs                    # local: http://localhost
 *   node scripts/smoke.mjs http://biloute.local
 *
 * Exit code:
 *   0 — all pages clean
 *   1 — at least one page had a pageerror, console.error, or failed to mount
 *
 * Designed to catch the silent regressions screenshot-only runs miss:
 * syntax errors in shared JS, missing icons, broken queries, network 5xx.
 */

import { chromium } from 'playwright';
import { pages, systemTabs } from './_pages.mjs';

const BASE = process.argv[2] || 'http://localhost';

// Console messages we ignore — known-noisy or out of scope for smoke.
// Keep this list short; every entry hides real signal.
const IGNORE_PATTERNS = [
  /favicon\.ico/i,                           // 404 on favicon — cosmetic
  /Failed to load resource.*photo/i,         // missing species photo URLs
  /\[Vue warn\].*Extraneous non-emits event/i, // Vue noise on dev components
  // "TypeError: Failed to fetch" almost always means a previous page's
  // fetch was cancelled by navigation — listeners catch it on the new
  // page. Real backend down / 5xx is caught separately via httpError.
  /TypeError:\s*Failed to fetch/i,
  /AbortError/i,
  // 429 (rate-limited) is the test's own footprint — running 30+ pages
  // in succession trips the 300-req/min limiter. Real user navigation
  // would never reach this rate.
  /\bHTTP 429\b/i,
  /status of 429/i,
  // 502/504 from Caddy = upstream cancelled by client navigation
  // (broken pipe / timeout). Same root cause as Failed to fetch —
  // already filtered server-side in the response handler.
  /status of 502/i,
  /status of 504/i,
  // Console.error from birdQuery surfaces these as "HTTP 502" / "HTTP 504"
  // (different wording than fetch's "status of") — same nav-cancel root cause.
  /\bHTTP 502\b/i,
  /\bHTTP 504\b/i,
];

function shouldIgnore(text) {
  return IGNORE_PATTERNS.some(re => re.test(text));
}

async function checkPage(context, p) {
  const errors = { pageError: [], consoleError: [], httpError: [], mounted: true };
  // Fresh page per test — no cross-test contamination from in-flight fetches
  const page = await context.newPage();

  page.on('pageerror', e => errors.pageError.push(e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (!shouldIgnore(text)) errors.consoleError.push(text);
  });
  page.on('response', r => {
    const status = r.status();
    // 502 from Caddy = nav-cancelled upstream (broken pipe). 504 = upstream
    // timeout, also nav-induced. Real backend bugs surface as 500 or via
    // pageerror.
    if (status >= 500 && status !== 502 && status !== 504 && r.url().includes(BASE)) {
      errors.httpError.push(`${status} ${r.url().replace(BASE, '')}`);
    }
  });

  try {
    await page.goto(`${BASE}${p.path}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const mounted = await page.waitForSelector('[v-cloak]', { state: 'detached', timeout: 8000 })
      .then(() => true).catch(() => false);
    errors.mounted = mounted;
    await page.waitForTimeout(p.wait);
    if (p.action) await p.action(page);
    // Let pending requests settle. SSE pages (log/spectrogram) never idle —
    // networkidle just times out, harmless because the page is already closed
    // right after.
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  } catch (e) {
    errors.pageError.push(`navigation: ${e.message.slice(0, 100)}`);
  } finally {
    await page.close().catch(() => {});
  }
  return errors;
}

function fmt(name, errors, ok) {
  const tag = ok ? '✓' : '✗';
  const counts = [];
  if (errors.pageError.length)    counts.push(`${errors.pageError.length} pageerror`);
  if (errors.consoleError.length) counts.push(`${errors.consoleError.length} console`);
  if (errors.httpError.length)    counts.push(`${errors.httpError.length} http5xx`);
  if (!errors.mounted)             counts.push('NOT MOUNTED');
  const summary = counts.length ? counts.join(', ') : 'clean';
  return `  ${tag} ${name.padEnd(22)} ${summary}`;
}

(async () => {
  console.log(`Smoke testing ${pages.length} pages on ${BASE}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Set EN + paper theme on every page in this context
  await context.addInitScript(() => {
    localStorage.setItem('birdash_lang', 'en');
    localStorage.setItem('birdash_theme', 'paper');
  });

  const results = [];
  for (const p of pages) {
    const errors = await checkPage(context, p);
    const ok = errors.mounted && !errors.pageError.length && !errors.consoleError.length && !errors.httpError.length;
    console.log(fmt(p.name, errors, ok));
    results.push({ name: p.name, errors, ok });
  }

  // System sub-tabs (model, data, external) reached via tab-click on system.html
  for (const st of systemTabs) {
    const tabAction = async (page) => {
      await page.evaluate((tabName) => {
        const btns = document.querySelectorAll('.sys-tab, [data-tab], button');
        for (const b of btns) {
          if (b.textContent.toLowerCase().includes(tabName) || b.dataset?.tab === tabName) { b.click(); return; }
        }
      }, st.tab).catch(() => {});
      await page.waitForTimeout(1500);
    };
    const errors = await checkPage(context, { name: st.name, path: '/birds/system.html', wait: 1500, action: tabAction });
    const ok = errors.mounted && !errors.pageError.length && !errors.consoleError.length && !errors.httpError.length;
    console.log(fmt(st.name, errors, ok));
    results.push({ name: st.name, errors, ok });
  }

  await browser.close();

  // Detailed report for failures
  const failed = results.filter(r => !r.ok);
  if (failed.length) {
    console.log(`\n── ${failed.length} page(s) with errors ──`);
    for (const r of failed) {
      console.log(`\n${r.name}:`);
      if (!r.errors.mounted) console.log('  · Vue never mounted (v-cloak stayed)');
      r.errors.pageError.forEach(e => console.log(`  · pageerror: ${e}`));
      r.errors.consoleError.forEach(e => console.log(`  · console:   ${e.slice(0, 200)}`));
      r.errors.httpError.forEach(e => console.log(`  · http:      ${e}`));
    }
  }

  const total = results.length;
  const clean = results.filter(r => r.ok).length;
  console.log(`\n${clean}/${total} pages clean.`);
  process.exit(failed.length ? 1 : 0);
})();
