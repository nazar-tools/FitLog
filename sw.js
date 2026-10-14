// Fit Log service worker — app-shell caching for offline use.
// Bump CACHE_VERSION whenever any cached file changes so clients pick up the update.
const CACHE_VERSION = 'fitlog-v53';
const APP_SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/charts.js',
  './js/icons.js',
  './js/units.js',
  './js/calc.js',
  './js/features.js',
  './js/catalog.js',
  './js/standards.js',
  './js/migrations.js',
  './js/backup.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for the app's own files, falling back to the cache when
// offline or slow. Online, the newest files are always used, so a stale cache
// cannot leave the app half-updated; offline, the last good copy is served.
// The app makes no other network requests (all data lives in localStorage).
const NETWORK_TIMEOUT_MS = 4000;

function fetchFresh(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  return fetch(url, { cache: 'no-cache', signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetchFresh(request.url);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});
