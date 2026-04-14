/* Iron Kinetic — Service Worker v16
   Cache: cache-first for assets, network-first for navigation.
   Offline fallback: cached index.html.
*/
const CACHE = 'iron-kinetic-v24';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './offline.html'
];

/* OFFLINE_FALLBACK: create offline.html with:
   <!DOCTYPE html><html><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width,initial-scale=1">
   <title>Iron Kinetic — Offline</title>
   <style>body{background:#0e0e0e;color:#4ddcc6;font-family:sans-serif;
   display:flex;flex-direction:column;align-items:center;justify-content:center;
   height:100vh;margin:0;text-align:center;gap:16px}
   h1{font-size:22px;margin:0}p{color:rgba(199,196,216,.6);font-size:13px;margin:0}
   </style></head><body>
   <span style="font-size:48px">⚡</span>
   <h1>Iron Kinetic</h1>
   <p>Sei offline. Riconnettiti per sincronizzare.</p>
   </body></html>
*/

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

  // Navigation (page load): network-first, fall back to cached index.html or offline.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .catch(() =>
          caches.match('./index.html').then((r) => r || caches.match('/'))
            .then((r) => r || caches.match('./offline.html'))
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
    }).catch(() => caches.match('./offline.html'))
  );
});
