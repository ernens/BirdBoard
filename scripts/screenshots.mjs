/**
 * screenshots.mjs — Capture all birdash pages for README
 *
 * Usage: node scripts/screenshots.mjs [baseUrl]
 *
 * Takes screenshots of every page in English, **lab** theme,
 * at 1440x900 viewport. Saves to screenshots/ directory.
 *
 * 502/504 handling: tracks API responses during page render. If birdash
 * timed out / Caddy returned upstream-error during the capture window,
 * retries the page up to MAX_RETRIES times with exponential backoff.
 * This is a real risk on a Pi running engine + dawn-chorus inference
 * concurrently.
 */

import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pages, systemTabs } from './_pages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const SHOTS_DIR = join(PROJECT_ROOT, 'screenshots');
const BASE = process.argv[2] || 'http://localhost';

// Capture knobs
const THEME = 'lab';
const LANG = 'en';
const MAX_RETRIES = 2;            // up to 2 retries (3 total attempts) on 5xx
const RETRY_BACKOFF_MS = 5000;    // wait before each retry, multiplied by attempt
const POST_READY_PAUSE_MS = 1500; // extra beat after ready selector hits — give XHRs time to settle

// Set English + lab theme via localStorage before each page
async function setupPage(page) {
  await page.addInitScript(({ lang, theme }) => {
    localStorage.setItem('birdash_lang', lang);
    localStorage.setItem('birdash_theme', theme);
    // Also set the data-theme attribute synchronously so the very first paint
    // doesn't flash the default. The Vue shell reads localStorage on mount,
    // but Caddy serves static HTML before Vue is loaded.
    document.documentElement.setAttribute('data-theme', theme);
  }, { lang: LANG, theme: THEME });
}

// Wait for Vue to mount + data to load
async function waitReady(page, ms = 3000) {
  await page.waitForSelector('[v-cloak]', { state: 'detached', timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

// Wait for a "ready" selector — typically something that appears only after
// data finishes loading (a KPI value, a chart canvas, a table row). Accepts
// a comma-separated list; we resolve when ANY of them shows up.
async function waitReadySelector(page, selector, timeout = 20000) {
  if (!selector) return;
  try {
    await page.waitForSelector(selector, { state: 'visible', timeout });
  } catch {
    // Don't fail the whole run — we'll screenshot what we have.
  }
}

// After the "ready" selector resolves, give chart/canvas libs a beat to
// finish drawing. Chart.js and ECharts mount synchronously but draw on
// the next animation frame.
async function waitChartsSettled(page) {
  await page.waitForTimeout(POST_READY_PAUSE_MS);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  // Let visible <img> elements resolve so photo-heavy pages don't ship grey placeholders.
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('img')).filter(i => i.offsetParent !== null);
    await Promise.all(imgs.map(i => i.complete && i.naturalWidth > 0 ? Promise.resolve() :
      new Promise(r => { i.onload = r; i.onerror = r; setTimeout(r, 4000); })));
  });
}

// Render a page once and return whether any 502/504 happened during the
// capture window (initial load + waits + action). The caller decides
// whether to retry.
async function renderPage(page, p, url) {
  let upstreamError = false;
  const errorPaths = [];
  const handler = (resp) => {
    const code = resp.status();
    if (code === 502 || code === 504) {
      upstreamError = true;
      errorPaths.push(`${code} ${new URL(resp.url()).pathname}`);
    }
  };
  page.on('response', handler);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitReady(page, p.wait);

    if (p.action) await p.action(page);

    // For settings pages with hash tabs, the page reads location.hash on
    // mount. Some legacy paths still need a click; try that as fallback.
    if (p.path.includes('#') && !p.path.endsWith('#detection')) {
      const tabId = p.path.split('#')[1];
      const tabBtn = page.locator(`[data-tab="${tabId}"], [onclick*="${tabId}"], button:has-text("${tabId}")`).first();
      if (await tabBtn.isVisible().catch(() => false)) {
        await tabBtn.click();
        await page.waitForTimeout(1200);
      }
    }

    await waitReadySelector(page, p.ready);
    await waitChartsSettled(page);
  } finally {
    page.off('response', handler);
  }

  return { upstreamError, errorPaths };
}

async function captureWithRetry(page, p, url, outPath) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const tag = attempt === 0 ? '' : ` (retry ${attempt}/${MAX_RETRIES})`;
    process.stdout.write(`  ${p.name}${tag}...`);
    try {
      const { upstreamError, errorPaths } = await renderPage(page, p, url);
      if (upstreamError && attempt < MAX_RETRIES) {
        process.stdout.write(` 5xx (${errorPaths.slice(0, 2).join(', ')}), retrying\n`);
        await page.waitForTimeout(RETRY_BACKOFF_MS * (attempt + 1));
        continue;
      }
      await page.screenshot({ path: outPath, fullPage: false });
      if (upstreamError) {
        process.stdout.write(` OK (with leftover 5xx — verify manually)\n`);
      } else {
        process.stdout.write(` OK\n`);
      }
      return;
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        process.stdout.write(` ERR (${e.message.slice(0, 60)}), retrying\n`);
        await page.waitForTimeout(RETRY_BACKOFF_MS * (attempt + 1));
      } else {
        process.stdout.write(` FAILED: ${e.message.slice(0, 80)}\n`);
      }
    }
  }
}

(async () => {
  console.log(`Capturing ${pages.length + systemTabs.length} screenshots from ${BASE}`);
  console.log(`Theme: ${THEME}, Lang: ${LANG}, Viewport: 1440x900, Retries on 5xx: ${MAX_RETRIES}`);
  console.log(`Output: ${SHOTS_DIR}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  await setupPage(page);

  // First navigate to set localStorage, then the first real screenshot will
  // pick up the theme on its own init.
  await page.goto(`${BASE}/birds/overview.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  for (const p of pages) {
    const url = `${BASE}${p.path}`;
    const outPath = join(SHOTS_DIR, `${p.name}.png`);
    await captureWithRetry(page, p, url, outPath);
  }

  // System sub-tabs (model, data, external) — the page reads location.hash
  // on mount, so we navigate fresh to each hashed URL rather than clicking.
  for (const st of systemTabs) {
    const outPath = join(SHOTS_DIR, `${st.name}.png`);
    const stPage = {
      name: st.name,
      path: `/birds/system.html#${st.tab}`,
      wait: 4500,
      ready: `[v-if*="${st.tab}"], .sys-tab-btn.active`,
    };
    await captureWithRetry(page, stPage, `${BASE}${stPage.path}`, outPath);
  }

  await browser.close();
  console.log(`\nDone — ${pages.length + systemTabs.length} screenshots captured.`);
})();
