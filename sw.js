/* Iron Kinetic — Service Worker v20
   Fixes v16: font/CDN risorse esterne ora network-first (no cache-first opaque).
   Risposte opaque mai messe in cache. SKIP_WAITING handler aggiunto.
*/
const CACHE = 'iron-kinetic-v20';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './offline.html'
];

/* Domini esterni che devono andare SEMPRE in rete — mai cache-first.
   Se la rete fallisce, fail silenzioso (no fallback opaque corrotto). */
const NETWORK_ONLY_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'js.stripe.com',
  'js-de.sentry-cdn.com',
];

/* ── Install ── */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: elimina cache vecchie ── */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
      )
      .then(() => self.clients.claim())
  );
});

/* ── Message: SKIP_WAITING per update immediato da HTML ── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: 'v17' });
  }
});

/* ── Fetch ── */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Solo GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Font e CDN critici: SEMPRE rete, mai cache.
  // Se offline, fallisce silenziosamente (il browser usa il fallback di sistema).
  if (NETWORK_ONLY_ORIGINS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    event.respondWith(
      fetch(req).catch(() => new Response('', { status: 503, statusText: 'Offline' }))
    );
    return;
  }

  // Navigazione: network-first, fallback a index.html cached o offline.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match('./index.html')
          .then((r) => r || caches.match('/'))
          .then((r) => r || caches.match('./offline.html'))
      )
    );
    return;
  }

  // Risorse esterne non in NETWORK_ONLY (es. Supabase JS, altri CDN):
  // network-first, cache solo se risposta NON opaque e status 200.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Non cachare mai risposte opaque (type !== 'basic'/'cors') o errori
          if (res && res.status === 200 && res.type !== 'opaque') {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || new Response('', { status: 503 })))
    );
    return;
  }

  // Risorse same-origin: stale-while-revalidate
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
