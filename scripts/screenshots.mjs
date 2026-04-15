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

const pages = [
  // Home
  { name: 'overview',    path: '/birds/overview.html',    wait: 4000 },
  { name: 'today',       path: '/birds/today.html',       wait: 3000 },

  // Live
  { name: 'dashboard',   path: '/birds/dashboard.html',   wait: 4000 },
  { name: 'spectrogram', path: '/birds/spectrogram.html',  wait: 2000 },
  { name: 'log',         path: '/birds/log.html',          wait: 3000 },
  { name: 'liveboard',   path: '/birds/liveboard.html',    wait: 3000 },

  // History
  { name: 'calendar',    path: '/birds/calendar.html',     wait: 3000 },
  { name: 'timeline',    path: '/birds/timeline.html',     wait: 15000 },
  { name: 'detections',  path: '/birds/detections.html',   wait: 10000 },
  { name: 'review',      path: '/birds/review.html',       wait: 3000 },

  // Species
  { name: 'species',     path: '/birds/species.html',      wait: 4000 },
  { name: 'recordings',  path: '/birds/recordings.html',   wait: 3000 },
  { name: 'rarities',    path: '/birds/rarities.html',     wait: 6000 },
  { name: 'favorites',   path: '/birds/favorites.html',    wait: 6000 },

  // Indicators
  { name: 'weather',     path: '/birds/weather.html',      wait: 4000 },
  { name: 'stats',       path: '/birds/stats.html',        wait: 4000 },
  { name: 'analyses',    path: '/birds/analyses.html',     wait: 4000 },
  { name: 'biodiversity',path: '/birds/biodiversity.html',  wait: 4000 },
  { name: 'phenology',   path: '/birds/phenology.html',    wait: 3000, action: async (page) => {
    // Click the first suggestion button in the .ph-empty section
    const btn = page.locator('.ph-empty button').first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(6000);
    }
  }},
  { name: 'comparison',  path: '/birds/comparison.html',   wait: 4000 },

  // System
  { name: 'system',      path: '/birds/system.html',       wait: 3000 },

  // Settings tabs
  { name: 'settings-detection', path: '/birds/settings.html#detection', wait: 2000 },
  { name: 'settings-audio',     path: '/birds/settings.html#audio',     wait: 2000 },
  { name: 'settings-notif',     path: '/birds/settings.html#notif',     wait: 2000 },
  { name: 'settings-station',   path: '/birds/settings.html#station',   wait: 2000 },
  { name: 'settings-services',  path: '/birds/settings.html#services',  wait: 2000 },
  { name: 'settings-species',   path: '/birds/settings.html#species',   wait: 2000 },
  { name: 'settings-backup',    path: '/birds/settings.html#backup',    wait: 2000 },
  { name: 'settings-database',  path: '/birds/settings.html#database',  wait: 2000 },
  { name: 'settings-terminal',  path: '/birds/settings.html#terminal',  wait: 2000 },
];

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
  const systemTabs = [
    { name: 'system-model',    tab: 'model' },
    { name: 'system-data',     tab: 'data' },
    { name: 'system-external', tab: 'external' },
  ];

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
