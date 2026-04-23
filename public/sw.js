/**
 * BIRDASH — Service Worker
 * Cache les assets statiques (JS, CSS, SVG, polices) pour un chargement instantané.
 * Stratégie : cache-first pour les assets, network-first pour l'API.
 */

const CACHE_NAME = 'birdash-v171';

// Assets statiques à pré-cacher à l'installation
const PRECACHE = [
  'css/bird-styles.css',
  'css/bird-pages.css',
  'js/bird-config.js',
  'js/bird-icons.js',
  'js/bird-shared.js',
  'js/bird-queries.js',
  'js/bird-vue-core.js',
  'img/robin-logo.svg',
  'img/favicon.svg',
  'i18n/fr.json',
  'i18n/en.json',
  'i18n/de.json',
  'i18n/nl.json',
];

// Patterns d'assets à cacher au vol (cache-first)
const CACHEABLE_ASSET = /\.(css|js|svg|woff2?|ttf|eot)(\?|$)/;

// Patterns CDN à cacher (longue durée)
const CACHEABLE_CDN = /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com)\//;

// Installation : pré-cache des assets locaux
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// Activation : nettoyer les anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch : stratégie selon le type de requête
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorer les requêtes non-GET
  if (event.request.method !== 'GET') return;

  // Photos d'oiseaux : cache-first (changent rarement, et l'endpoint /api/photo
  // proxy déjà ses propres CDN — re-cacher au niveau SW évite les allers-retours).
  // Doit passer AVANT le early-return /birds/api/.
  if (url.pathname.startsWith('/birds/api/photo')) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // API : network-only (données live)
  if (url.pathname.startsWith('/birds/api/')) return;

  // CDN : cache-first (libs versionnées, immuables)
  if (CACHEABLE_CDN.test(event.request.url)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Assets locaux (JS, CSS, SVG) : network-first (toujours à jour, cache fallback)
  if (CACHEABLE_ASSET.test(url.pathname) && url.origin === self.location.origin) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Partials HTML (settings/*.html chargés via fetch()) : network-first.
  // Sans ça, le navigateur sert un cache HTTP stale après une mise à jour.
  if (url.pathname.endsWith('.html') && url.origin === self.location.origin) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Pages HTML : network-first (toujours fraîches)
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(networkFirst(event.request));
    return;
  }
});

// ── Stratégies de cache ────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }
}

