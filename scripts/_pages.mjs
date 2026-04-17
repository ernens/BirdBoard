/**
 * _pages.mjs — Shared page list for screenshots.mjs and smoke.mjs
 *
 * Each entry: { name, path, wait, action?, ready? }
 *   - name: short identifier (also screenshot filename)
 *   - path: URL path on the birdash site
 *   - wait: min ms to wait after Vue mount before considering page "ready"
 *   - action: optional async fn(page) for pages needing extra interaction
 *             (e.g. click a species, start a spectrogram, select filters).
 *             Actions run AFTER v-cloak detached and AFTER `wait` ms.
 *   - ready: optional selector that must be visible before screenshot — used
 *            by screenshots.mjs to confirm data rendered (not just mounted).
 *
 * The two scripts share this file, but only screenshots.mjs runs `action`
 * and `ready`. Smoke uses just the path + wait.
 */

export const pages = [
  // Home
  { name: 'overview',    path: '/birds/overview.html',    wait: 4000, ready: '.ov-kpi-value' },
  { name: 'today',       path: '/birds/today.html',       wait: 3000 },

  // Live
  { name: 'dashboard',   path: '/birds/dashboard.html',   wait: 4000 },
  // Spectrogram defaults to mic mode, which needs browser mic permission.
  // Switch to clips mode (streams recent detections through the spectrogram)
  // so we get a real waveform without granting any permissions.
  { name: 'spectrogram', path: '/birds/spectrogram.html', wait: 2000, action: async (page) => {
    const sel = page.locator('select').first();
    if (await sel.isVisible().catch(() => false)) {
      await sel.selectOption('clips').catch(() => {});
    }
    const startBtn = page.locator('button.btn-primary:has-text("Start"), button.btn-primary:has-text("Démarrer")').first();
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click().catch(() => {});
      // Let the canvas accumulate enough frames to look like a spectrogram
      await page.waitForTimeout(6000);
    }
  }},
  { name: 'log',         path: '/birds/log.html',         wait: 3000 },
  { name: 'liveboard',   path: '/birds/liveboard.html',   wait: 3000 },
  // Bird Pulse: let the breathing halo, river dots, and wall tiles all settle
  { name: 'dashboard-kiosk', path: '/birds/dashboard-kiosk.html', wait: 6000, ready: '.k-tile' },

  // History
  { name: 'calendar',    path: '/birds/calendar.html',    wait: 4000, ready: '.cal-cell .cal-day' },
  { name: 'timeline',    path: '/birds/timeline.html',    wait: 15000 },
  { name: 'detections',  path: '/birds/detections.html',  wait: 10000 },
  { name: 'review',      path: '/birds/review.html',      wait: 4000 },

  // Species
  // species.html auto-loads the last detection when ?species is absent.
  // Wait for the KPI grid and charts to render.
  { name: 'species',     path: '/birds/species.html',     wait: 6000, ready: '.sp-kpis, .sp-kpi-value' },
  { name: 'recordings',  path: '/birds/recordings.html',  wait: 4000, action: async (page) => {
    // Open the first row's inline spectrogram so the page shows the feature
    const btn = page.locator('.rec-spectro-btn').first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(3000);
    }
  }},
  { name: 'rarities',    path: '/birds/rarities.html',    wait: 8000, ready: '.bird-table tbody tr, .hint-empty' },
  { name: 'favorites',   path: '/birds/favorites.html',   wait: 6000 },

  // Indicators
  { name: 'weather',     path: '/birds/weather.html',     wait: 6000, ready: '.chart-wrap canvas, .kpi-card .kpi-value' },
  { name: 'stats',       path: '/birds/stats.html',       wait: 4000 },
  // Analyses needs species selected. The Top-N button picks the N most
  // detected species (default N=10) and triggers all charts to render.
  { name: 'analyses',    path: '/birds/analyses.html',    wait: 2000, action: async (page) => {
    const topBtn = page.locator('.sp-topn-btn').first();
    if (await topBtn.isVisible().catch(() => false)) {
      await topBtn.click().catch(() => {});
      // Polar (ECharts) + Chart.js series + heatmap + narrative all need time
      await page.waitForTimeout(9000);
    }
  }},
  { name: 'biodiversity',path: '/birds/biodiversity.html', wait: 4000 },
  // Phenology: pre-select Verdier d'Europe, year 2025, and open week 22 zoom.
  { name: 'phenology',   path: "/birds/phenology.html?species=Verdier%20d'Europe",
                         wait: 4000, ready: '.ph-ribbon .ph-cell', action: async (page) => {
    // Switch year dropdown to 2025 if available
    const yearSel = page.locator('.ph-year-select').first();
    if (await yearSel.isVisible().catch(() => false)) {
      await yearSel.selectOption('2025').catch(() => {});
      await page.waitForTimeout(3000);
    }
    // Click week 22 cell in the ribbon
    const wk22 = page.locator('.ph-ribbon .ph-cell').nth(22);
    if (await wk22.isVisible().catch(() => false)) {
      await wk22.click().catch(() => {});
      await page.waitForTimeout(2500);
    }
  }},
  { name: 'comparison',  path: '/birds/comparison.html',  wait: 4000 },
  // Compare: URL params work (a=, b=, range=). Chart.js needs time to settle.
  { name: 'compare',     path: '/birds/compare.html?a=Phylloscopus%20collybita&b=Phylloscopus%20trochilus&range=year',
                         wait: 8000, ready: '.cmp2-chart-box canvas' },

  // System
  { name: 'system',      path: '/birds/system.html',      wait: 3000 },

  // Settings tabs (hash-routed)
  { name: 'settings-detection', path: '/birds/settings.html#detection', wait: 2000 },
  { name: 'settings-audio',     path: '/birds/settings.html#audio',     wait: 2000 },
  { name: 'settings-notif',     path: '/birds/settings.html#notif',     wait: 2000 },
  { name: 'settings-station',   path: '/birds/settings.html#station',   wait: 3000 },
  { name: 'settings-services',  path: '/birds/settings.html#services',  wait: 2000 },
  { name: 'settings-species',   path: '/birds/settings.html#species',   wait: 2000 },
  { name: 'settings-backup',    path: '/birds/settings.html#backup',    wait: 2000 },
  { name: 'settings-database',  path: '/birds/settings.html#database',  wait: 2000 },
  { name: 'settings-terminal',  path: '/birds/settings.html#terminal',  wait: 2000 },
];

export const systemTabs = [
  { name: 'system-model',    tab: 'model' },
  { name: 'system-data',     tab: 'data' },
  { name: 'system-external', tab: 'external' },
];
