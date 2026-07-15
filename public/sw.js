/* =======================================
   SERVICE WORKER – Suiv'Heures
   Stratégie :
   - Pages HTML + API : RÉSEAU D'ABORD (toujours la dernière version,
     repli sur le cache uniquement si hors-ligne)
   - Ressources statiques (CSS, JS, icônes) : cache d'abord
   ======================================= */

const CACHE_NAME = 'suivheures-v7';

// Ressources statiques pré-mises en cache (PAS les pages .html, PAS le manifest)
const FICHIERS_CACHE = [
  '/assets/style.css',
  '/assets/icon-192.png'
];

/* ── Installation ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FICHIERS_CACHE))
  );
  self.skipWaiting();
});

/* ── Activation : nettoyage des anciens caches ── */
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
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Détecte une navigation vers une page HTML
  const estPageHTML =
    event.request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname === '/';

  // Fichiers JS de l'application (hors CDN externe) : réseau d'abord aussi,
  // pour qu'une mise à jour de sync.js / script.js soit prise en compte tout de suite.
  const estJsApp =
    url.origin === self.location.origin && url.pathname.endsWith('.js');

  // Le manifest doit toujours venir du réseau : sinon une ancienne version
  // (mauvais start_url) resterait en cache et l'app installée ouvrirait la
  // mauvaise page au lancement.
  const estManifest = url.pathname.endsWith('manifest.json');

  // Pages HTML + API + JS de l'app + manifest → RÉSEAU D'ABORD (toujours la dernière version)
  if (url.pathname.startsWith('/api/') || estPageHTML || estJsApp || estManifest) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // Mémorise une copie pour le mode hors-ligne
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request)) // repli hors-ligne
    );
    return;
  }

  // Autres ressources statiques : cache d'abord
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

/* ── Réception d'une notification push (rappel de RDV) ──
   Le serveur envoie un JSON { titre, corps, url, tag }. On affiche
   la notification. Un repli texte est prévu si le format diffère. */
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { corps: event.data ? event.data.text() : '' };
  }

  const titre = data.titre || "Suiv'Heures";
  const options = {
    body:    data.corps || '',
    icon:    '/assets/icon-192.png',
    badge:   '/assets/icon-192.png',
    tag:     data.tag || 'rdv',          // regroupe les notifs d'un même RDV
    data:    { url: data.url || '/saisie.html' },
    vibrate: [100, 50, 100],
    requireInteraction: false
  };

  event.waitUntil(self.registration.showNotification(titre, options));
});

/* ── Clic sur la notification : ouvre (ou ramène au premier plan) l'app ── */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const cible = (event.notification.data && event.notification.data.url) || '/saisie.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(liste => {
      // Si une fenêtre de l'app est déjà ouverte, on la réutilise
      for (const client of liste) {
        if (client.url.includes(cible) && 'focus' in client) return client.focus();
      }
      // Sinon on en ouvre une nouvelle
      if (self.clients.openWindow) return self.clients.openWindow(cible);
    })
  );
});
