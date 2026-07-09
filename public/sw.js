/* =======================================
   SERVICE WORKER – Suiv'Heures
   Stratégie :
   - Pages HTML + API : RÉSEAU D'ABORD (toujours la dernière version,
     repli sur le cache uniquement si hors-ligne)
   - Ressources statiques (CSS, JS, icônes) : cache d'abord
   ======================================= */

const CACHE_NAME = 'suivheures-v6';

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

/* ── Activation : nettoyage des anciens caches (on conserve les identifiants notif) ── */
const CACHES_A_CONSERVER = [CACHE_NAME, 'notif-creds'];
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !CACHES_A_CONSERVER.includes(k)).map(k => caches.delete(k)))
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

/* ── Convertit la clé VAPID (base64url) en Uint8Array (identique au client) ── */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  const arr     = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/* ── Rotation d'abonnement (fréquente sur Android/FCM) ──
   Quand le service de push invalide/renouvelle l'abonnement, on se réabonne
   et on ré-enregistre le nouvel endpoint côté serveur, à l'aide des identifiants
   mémorisés par la page (cache 'notif-creds'). Sans ça, le serveur garde un
   endpoint mort et le salarié cesse SILENCIEUSEMENT de recevoir ses rappels. */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      let creds = null;
      try {
        const c = await caches.open('notif-creds');
        const r = await c.match('/__notif_creds');
        if (r) creds = await r.json();
      } catch (_) {}

      const rk = await fetch('/api/push/vapid-public-key');
      const dk = await rk.json().catch(() => null);
      if (!dk || !dk.ok || !dk.key) return;

      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(dk.key)
      });

      if (creds && creds.codeEmploye && creds.salarieId != null) {
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ codeEmploye: creds.codeEmploye, salarieId: creds.salarieId, subscription: sub })
        });
      }
    } catch (_) {}
  })());
});
