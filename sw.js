// Fit Log service worker: app-shell caching for offline use.
// Bump CACHE_VERSION whenever a cached file changes. Files are fetched network-first, so
// online users get new files anyway; the bump gives the new worker a fresh cache and drops
// the old one, which is what makes the "new version is ready" prompt appear.
const CACHE_PREFIX = 'fitlog-';
const CACHE_VERSION = 'fitlog-v64';
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
  './js/strength-data.js',
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
    // cache: 'reload' bypasses the browser's HTTP cache, so the precache can never be filled
    // with stale copies of files that were just updated.
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // Only our own old caches: other apps on the same origin (e.g. GitHub Pages) may keep theirs.
      Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION).map((k) => caches.delete(k)))
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

// A usable response is a successful one of the right kind: HTML for page loads, anything but
// HTML for scripts, styles, the manifest and icons (a captive portal or error page comes back as
// HTML with status 200, and would otherwise overwrite the good cached copy).
function isUsable(request, response) {
  if (!response || !response.ok) return false;
  const isHtml = (response.headers.get('content-type') || '').includes('text/html');
  return request.mode === 'navigate' ? isHtml : !isHtml;
}

async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE_VERSION);
  const fromCache = async () => (await cache.match(request, { ignoreSearch: true }))
    || (request.mode === 'navigate' ? await cache.match('./index.html') : undefined);
  try {
    const response = await fetchFresh(request.url);
    if (isUsable(request, response)) {
      // waitUntil keeps the worker alive until the copy is written.
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      return response;
    }
    // A server error or error page: prefer the last good copy, else pass the response on.
    return (await fromCache()) || response;
  } catch (err) {
    const cached = await fromCache();
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(event));
});
