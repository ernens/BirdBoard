/**
 * screenshots.mjs — Capture all birdash pages for README
 *
 * Usage: node scripts/screenshots.mjs [baseUrl]
 *
 * Takes screenshots of every page in English, Paper theme,
 * at 1440x900 viewport. Saves to screenshots/ directory.
 */

import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { pages, systemTabs } from './_pages.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const SHOTS_DIR = join(PROJECT_ROOT, 'screenshots');
const BASE = process.argv[2] || 'http://localhost';

// Set English + Paper theme via localStorage before each page
async function setupPage(page) {
  await page.addInitScript(() => {
    localStorage.setItem('birdash_lang', 'en');
    localStorage.setItem('birdash_theme', 'paper');
  });
}

// Wait for Vue to mount + data to load
async function waitReady(page, ms = 3000) {
  // Wait for v-cloak to disappear (Vue mounted)
  await page.waitForSelector('[v-cloak]', { state: 'detached', timeout: 10000 }).catch(() => {});
  // Extra wait for async data
  await page.waitForTimeout(ms);
}

// Page list lives in _pages.mjs (shared with smoke.mjs)

(async () => {
  console.log(`Capturing ${pages.length} screenshots from ${BASE}`);
  console.log(`Theme: paper, Lang: en, Viewport: 1440x900`);
  console.log(`Output: ${SHOTS_DIR}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  await setupPage(page);

  // First navigate to set localStorage, then reload
  await page.goto(`${BASE}/birds/overview.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  for (const p of pages) {
    const url = `${BASE}${p.path}`;
    const outPath = join(SHOTS_DIR, `${p.name}.png`);

    process.stdout.write(`  ${p.name}...`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await waitReady(page, p.wait);

      // Custom action (e.g. select a species)
      if (p.action) await p.action(page);

      // For settings pages with hash tabs, click the tab
      if (p.path.includes('#') && !p.path.endsWith('#detection')) {
        const tabId = p.path.split('#')[1];
        const tabBtn = page.locator(`[data-tab="${tabId}"], [onclick*="${tabId}"], button:has-text("${tabId}")`).first();
        if (await tabBtn.isVisible().catch(() => false)) {
          await tabBtn.click();
          await page.waitForTimeout(1000);
        }
      }

      await page.screenshot({ path: outPath, fullPage: false });
      process.stdout.write(` OK\n`);
    } catch (e) {
      process.stdout.write(` FAILED: ${e.message.slice(0, 80)}\n`);
    }
  }

  // System sub-tabs (model, data, external) — need to click tabs on system.html
  await page.goto(`${BASE}/birds/system.html`, { waitUntil: 'domcontentloaded' });
  await waitReady(page, 3000);

  for (const st of systemTabs) {
    const outPath = join(SHOTS_DIR, `${st.name}.png`);
    process.stdout.write(`  ${st.name}...`);
    try {
      // Try clicking tab by various selectors
      const clicked = await page.evaluate((tabName) => {
        const btns = document.querySelectorAll('.sys-tab, [data-tab], button');
        for (const b of btns) {
          if (b.textContent.toLowerCase().includes(tabName) ||
              b.dataset?.tab === tabName) {
            b.click();
            return true;
          }
        }
        return false;
      }, st.tab);

      if (clicked) {
        await page.waitForTimeout(1500);
      }
      await page.screenshot({ path: outPath, fullPage: false });
      process.stdout.write(` OK\n`);
    } catch (e) {
      process.stdout.write(` FAILED: ${e.message.slice(0, 80)}\n`);
    }
  }

  await browser.close();
  console.log(`\nDone — ${pages.length + systemTabs.length} screenshots captured.`);
})();
