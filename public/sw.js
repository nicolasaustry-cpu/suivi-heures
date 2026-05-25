/* =======================================
   SERVICE WORKER – Suiv'Heures Saisie
   Ne cache PAS saisie.html pour toujours
   avoir la dernière version
   ======================================= */

const CACHE_NAME = 'suivheures-v3';

// Fichiers à mettre en cache (PAS saisie.html)
const FICHIERS_CACHE = [
  '/assets/style.css',
  '/assets/icon-192.png',
  '/manifest.json'
];

/* ── Installation ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FICHIERS_CACHE))
  );
  self.skipWaiting();
});

/* ── Activation : nettoyage ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Interception ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API et saisie.html → toujours depuis le réseau (jamais en cache)
  if (url.pathname.startsWith('/api/') || url.pathname.includes('saisie.html')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Autres ressources : cache en priorité
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
