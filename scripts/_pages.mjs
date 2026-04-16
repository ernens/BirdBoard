/**
 * _pages.mjs — Shared page list for screenshots.mjs and smoke.mjs
 *
 * Each entry: { name, path, wait, action? }
 *   - name: short identifier (also screenshot filename)
 *   - path: URL path on the birdash site
 *   - wait: ms to wait after Vue mount before considering page "ready"
 *   - action: optional async fn(page) for pages needing extra interaction
 */

export const pages = [
  // Home
  { name: 'overview',    path: '/birds/overview.html',    wait: 4000 },
  { name: 'today',       path: '/birds/today.html',       wait: 3000 },

  // Live
  { name: 'dashboard',   path: '/birds/dashboard.html',   wait: 4000 },
  { name: 'spectrogram', path: '/birds/spectrogram.html', wait: 2000 },
  { name: 'log',         path: '/birds/log.html',         wait: 3000 },
  { name: 'liveboard',   path: '/birds/liveboard.html',   wait: 3000 },

  // History
  { name: 'calendar',    path: '/birds/calendar.html',    wait: 3000 },
  { name: 'timeline',    path: '/birds/timeline.html',    wait: 15000 },
  { name: 'detections',  path: '/birds/detections.html',  wait: 10000 },
  { name: 'review',      path: '/birds/review.html',      wait: 3000 },

  // Species
  { name: 'species',     path: '/birds/species.html',     wait: 4000 },
  { name: 'recordings',  path: '/birds/recordings.html',  wait: 3000 },
  { name: 'rarities',    path: '/birds/rarities.html',    wait: 6000 },
  { name: 'favorites',   path: '/birds/favorites.html',   wait: 6000 },

  // Indicators
  { name: 'weather',     path: '/birds/weather.html',     wait: 4000 },
  { name: 'stats',       path: '/birds/stats.html',       wait: 4000 },
  { name: 'analyses',    path: '/birds/analyses.html',    wait: 4000 },
  { name: 'biodiversity',path: '/birds/biodiversity.html', wait: 4000 },
  { name: 'phenology',   path: '/birds/phenology.html',   wait: 3000, action: async (page) => {
    const btn = page.locator('.ph-empty button').first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(6000);
    }
  }},
  { name: 'comparison',  path: '/birds/comparison.html',  wait: 4000 },
  { name: 'compare',     path: '/birds/compare.html?a=Phylloscopus%20collybita&b=Phylloscopus%20trochilus&range=year', wait: 4000 },

  // System
  { name: 'system',      path: '/birds/system.html',      wait: 3000 },

  // Settings tabs (hash-routed)
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

export const systemTabs = [
  { name: 'system-model',    tab: 'model' },
  { name: 'system-data',     tab: 'data' },
  { name: 'system-external', tab: 'external' },
];
