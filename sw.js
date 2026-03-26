/* Iron Kinetic — Service Worker v8
   Cache: cache-first for assets, network-first for navigation.
   Offline fallback: cached index.html.
*/
const CACHE = 'iron-kinetic-v8';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  // Navigation (page load): network-first, fall back to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .catch(() =>
          caches.match('./index.html').then((r) => r || caches.match('/'))
        )
    );
    return;
  }

  // Same-origin assets only: cache-first, then network, then skip
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // External resources (fonts, CDN scripts): network-first, cache fallback
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
    return;
  }

  // Same-origin assets: cache-first, update in background (stale-while-revalidate)
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req).then((res) => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => null);
      return cached || networkFetch;
    })
  );
});
