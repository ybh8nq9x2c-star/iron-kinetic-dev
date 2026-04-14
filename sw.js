/* Iron Kinetic — Service Worker v17
   Cache: cache-first for same-origin assets, network-first for navigation.
   External resources (fonts, CDN): let the browser handle them directly —
   DO NOT intercept, avoids CSP violations from sw fetch context.
   Offline fallback: cached index.html.
*/
const CACHE = 'iron-kinetic-v25';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './offline.html'
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

  const url = new URL(req.url);

  // ── External resources (fonts.googleapis.com, fonts.gstatic.com, CDN, Stripe, etc.)
  // Do NOT intercept: let the browser fetch them normally.
  // Intercepting external resources from SW context triggers CSP violations.
  if (url.origin !== self.location.origin) {
    return; // fall through to browser default fetch
  }

  // ── Navigation (page load): network-first, fall back to cached index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .catch(() =>
          caches.match('./index.html')
            .then((r) => r || caches.match('/'))
            .then((r) => r || caches.match('./offline.html'))
        )
    );
    return;
  }

  // ── Same-origin assets: stale-while-revalidate
  // Serve from cache immediately, update cache in background
  event.respondWith(
    caches.open(CACHE).then((cache) => {
      return cache.match(req).then((cached) => {
        const networkFetch = fetch(req).then((res) => {
          if (res && res.status === 200) {
            cache.put(req, res.clone());
          }
          return res;
        }).catch(() => null);

        return cached || networkFetch;
      });
    }).catch(() => caches.match('./offline.html'))
  );
});
