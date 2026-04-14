/* Iron Kinetic — Service Worker v23
   Key changes vs v22:
   - External origins: NOT intercepted at all (return without respondWith)
     Fixes: "Failed to convert value to 'Response'" + CSP violations
     Root cause: SW fetch() toward external origins was blocked by the
     document's CSP (connect-src), causing unhandled promise rejections
     that the browser converted into network errors for the page.
     Fix: simply don't call event.respondWith() for external origins —
     the browser handles them directly, unaffected by the SW.
   - navigate + index.html: always network-first (never stale)
   - Same-origin static assets: stale-while-revalidate (unchanged)
   - Added SKIP_WAITING message listener for instant activation
*/
const CACHE = 'iron-kinetic-v23';
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

  // External resources (fonts, CDN, Supabase, Stripe, Google APIs):
  // DO NOT intercept — let the browser handle them directly.
  //
  // WHY: calling fetch() from the SW toward external origins is blocked
  // by the document's CSP (connect-src). This causes the fetch promise
  // to reject, event.respondWith() receives a rejected promise, and the
  // browser synthesises a network error for the page — breaking fonts,
  // Supabase calls, Stripe, avatar images, etc.
  //
  // By returning without calling event.respondWith(), the browser
  // falls through to its normal network stack, which is NOT subject
  // to the SW's fetch restrictions and handles CSP correctly.
  if (url.origin !== self.location.origin) {
    return; // ← intentionally no event.respondWith()
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
