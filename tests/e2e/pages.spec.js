// @ts-check
const { test, expect } = require('@playwright/test');

// All pages that should load without error
const PAGES = [
  { path: '/overview.html', title: 'Overview', mustHave: '.kpi-grid' },
  { path: '/today.html', title: 'Today' },
  { path: '/dashboard.html', title: 'Dashboard' },
  { path: '/calendar.html', title: 'Calendar', mustHave: '.kpi-grid' },
  { path: '/timeline.html', title: 'Timeline' },
  { path: '/detections.html', title: 'Detections' },
  { path: '/review.html', title: 'Review' },
  { path: '/species.html', title: 'Species' },
  { path: '/rarities.html', title: 'Rarities' },
  { path: '/gallery.html', title: 'Gallery' },
  { path: '/recordings.html', title: 'Recordings' },
  { path: '/favorites.html', title: 'Favorites' },
  { path: '/weather.html', title: 'Weather' },
  { path: '/stats.html', title: 'Statistics' },
  { path: '/stats.html?tab=models', title: 'Models tab' },
  { path: '/analyses.html', title: 'Analyses' },
  { path: '/biodiversity.html', title: 'Biodiversity' },
  { path: '/phenology.html', title: 'Phenology' },
  { path: '/comparison.html', title: 'Comparison' },
  { path: '/spectrogram.html', title: 'Spectrogram' },
  { path: '/log.html', title: 'Live log' },
  { path: '/settings.html', title: 'Settings' },
  { path: '/system.html', title: 'System' },
  { path: '/network.html', title: 'Network' },
];

for (const page of PAGES) {
  test(`${page.title} (${page.path}) loads without errors`, async ({ page: p }) => {
    const errors = [];
    p.on('pageerror', err => errors.push(err.message));

    const resp = await p.goto(page.path, { waitUntil: 'domcontentloaded' });
    expect(resp.status()).toBeLessThan(400);

    // Wait for Vue to mount (birdash-shell renders the nav)
    await p.waitForSelector('.app-header', { timeout: 15000 });

    // Check for critical JS errors (ignore minor ones)
    const criticalErrors = errors.filter(e => !e.includes('429') && !e.includes('NetworkError'));
    expect(criticalErrors).toEqual([]);

    // Check specific element if defined
    if (page.mustHave) {
      await p.waitForSelector(page.mustHave, { timeout: 15000 });
    }
  });
}
