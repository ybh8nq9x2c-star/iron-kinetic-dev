/* Iron Kinetic — Service Worker v22
   Key changes vs v21:
   - navigate + index.html: always network-first (never stale)
   - External fonts/CDN: network-first, cache as fallback only
   - Same-origin static assets: stale-while-revalidate (unchanged)
   - Added SKIP_WAITING message listener for instant activation
*/
const CACHE = 'iron-kinetic-v22';
const ASSETS = [
  './manifest.webmanifest',
  './offline.html'
  /* index.html intentionally excluded — always fetched fresh */
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

/* Allow index.html to trigger instant SW activation */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isIndex = url.pathname === '/' || url.pathname.endsWith('/index.html');

  // Navigation requests and index.html: always network-first, never serve stale
  if (req.mode === 'navigate' || isIndex) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match('./index.html')
            .then((r) => r || caches.match('/'))
            .then((r) => r || caches.match('./offline.html'))
        )
    );
    return;
  }

  // External resources (fonts, CDN): network-first, cache as offline fallback only
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Same-origin static assets (manifest, icons, etc.): stale-while-revalidate
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
    }).catch(() => caches.match('./offline.html'))
  );
});
