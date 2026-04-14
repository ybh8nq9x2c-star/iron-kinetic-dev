/* Iron Kinetic — Service Worker v26
   Fix: schermata nera causata da cache corrotto o offline.html mancante.
   - Rimosso offline.html da ASSETS (fallisce cache.addAll se non esiste)
   - Navigation: network-first con aggiornamento cache
   - Dopo activate: postMessage ai client per forzare reload
   - Cache bumped a v26 per pulire tutti i cache precedenti
*/
const CACHE = 'iron-kinetic-v26';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest'
  // ⚠️ offline.html rimosso: se non esiste sul server, cache.addAll() fallisce
  // silenziosamente e il SW non si installa correttamente → schermata nera
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
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        // Forza reload di tutti i client aperti dopo l'attivazione
        // così non rimangono sulla versione cachata vecchia/nera
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_ACTIVATED' });
        });
      })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Risorse esterne (font, CDN, Stripe, ecc.) → browser gestisce
  if (url.origin !== self.location.origin) {
    return;
  }

  // Navigazione → network-first + aggiorna cache, fallback su cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match('./index.html').then((r) => r || caches.match('/'))
        )
    );
    return;
  }

  // Asset same-origin → stale-while-revalidate
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
    })
  );
});
