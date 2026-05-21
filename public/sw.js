/* =======================================
   SERVICE WORKER – Suiv'Heures Saisie
   Cache les ressources pour usage hors ligne
   ======================================= */

const CACHE_NAME = 'suivheures-v1';

// Fichiers à mettre en cache pour le mode hors ligne
const FICHIERS_CACHE = [
  '/saisie.html',
  '/assets/style.css',
  '/assets/script.js',
  '/assets/sync.js',
  '/assets/icon-192.png',
  '/manifest.json'
];

/* ── Installation : mise en cache ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(FICHIERS_CACHE);
    })
  );
  self.skipWaiting();
});

/* ── Activation : nettoyage des vieux caches ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Interception des requêtes ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Les appels API ne sont jamais mis en cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Pour les ressources statiques : cache en priorité, réseau en fallback
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Mettre en cache les nouvelles ressources statiques
        if (response.ok && event.request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      }).catch(() => {
        // Hors ligne et pas en cache : page de fallback
        if (event.request.destination === 'document') {
          return caches.match('/saisie.html');
        }
      });
    })
  );
});
