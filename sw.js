/* Iron Kinetic — Service Worker v27
   Fixes vs v26:
   - ASSETS vuoti: non precachiamo nulla durante install.
     cache.addAll() con index.html o manifest fallisce se la rete è lenta
     o il server risponde lentamente → install event rigetta → SW non attivo
     → pagina nera. Meglio non rischiare: la cache si popola on-demand.
   - Rimosso SW_ACTIVATED postMessage + reload forzato: causava loop di reload
     su connessioni lente (il reload avveniva mentre la pagina stava ancora
     caricando, portando di nuovo a schermata nera).
   - Navigation: network-first puro, fallback su cache solo se offline.
   - [SW-05] AbortController with 10s timeout on all fetch requests.
*/
const CACHE = 'iron-kinetic-v27';

// [SW-05] Request timeout: all fetch calls use AbortController with 10s limit
const TIMEOUT_MS = 10_000;

self.addEventListener('install', (event) => {
  // Cache static shell assets only (not index.html — avoids slow-fetch install failures)
  const SHELL_ASSETS = ['/manifest.webmanifest', '/offline.html'];
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL_ASSETS).catch(() => {/* shell assets optional */}))
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
    // NON fare postMessage/reload qui: causerebbe loop su pagine lente
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Risorse esterne (font, CDN, Supabase, Stripe, Google APIs):
  // NON intercettare — il browser le gestisce direttamente.
  if (url.origin !== self.location.origin) {
    return; // nessun event.respondWith()
  }

  // Navigazione: sempre network-first, mai stale.
  // Se offline: prova cache, altrimenti errore visibile (meglio del nero)
  if (req.mode === 'navigate') {
    event.respondWith(
      (function () {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        return fetch(req, { signal: ctrl.signal })
          .then((res) => {
            if (res && res.status === 200) {
              caches.open(CACHE).then((c) => c.put(req, res.clone())).catch((e) => console.warn('[SW] cache put failed:', e.message));
            }
            clearTimeout(timer);
            return res;
          })
          .catch(() =>
            caches.match('./index.html')
              .then((r) => r || caches.match('/'))
          );
      })()
    );
    return;
  }

  // Asset same-origin (manifest, icone, ecc.): stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const networkFetch = fetch(req, { signal: ctrl.signal }).then((res) => {
        if (res && res.status === 200) {
          caches.open(CACHE).then((c) => c.put(req, res.clone())).catch((e) => console.warn('[SW] cache put failed:', e.message));
        }
        clearTimeout(timer);
        return res;
      }).catch(() => null);
      return cached || networkFetch;
    })
  );
});
