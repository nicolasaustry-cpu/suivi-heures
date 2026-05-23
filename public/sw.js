/* =======================================
   SERVICE WORKER – Suiv'Heures Saisie
   v3 — Auto-update intelligent
   ======================================= */

// La version est basée sur la date de build (mise à jour à chaque déploiement)
// Pour forcer une mise à jour, change ce numéro
const CACHE_VERSION = 'v3.2026.05.23.16h00';
const CACHE_NAME = 'suivheures-' + CACHE_VERSION;

// Fichiers à mettre en cache pour le mode hors ligne
const FICHIERS_CACHE = [
  '/saisie.html',
  '/assets/style.css',
  '/assets/theme-volitis.css',
  '/assets/script.js',
  '/assets/sync.js',
  '/assets/icon-192.png',
  '/manifest.json'
];

/* ── Installation : mise en cache ── */
self.addEventListener('install', event => {
  console.log('[SW] Installing version', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // addAll échoue si UN seul fichier n'est pas accessible, on utilise add() individuellement
      return Promise.all(
        FICHIERS_CACHE.map(url =>
          cache.add(url).catch(err => console.warn('[SW] Failed to cache', url, err))
        )
      );
    })
  );
  // On force l'activation immédiate (la nouvelle version remplace l'ancienne sans attendre)
  self.skipWaiting();
});

/* ── Activation : nettoyage des vieux caches + prise de contrôle ── */
self.addEventListener('activate', event => {
  console.log('[SW] Activating version', CACHE_VERSION);
  event.waitUntil(
    Promise.all([
      // Supprimer tous les anciens caches
      caches.keys().then(keys =>
        Promise.all(keys
          .filter(k => k !== CACHE_NAME)
          .map(k => {
            console.log('[SW] Deleting old cache', k);
            return caches.delete(k);
          })
        )
      ),
      // Prendre le contrôle immédiat de toutes les pages ouvertes
      self.clients.claim()
    ]).then(() => {
      // Notifier toutes les pages ouvertes qu'une nouvelle version est active
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(client => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      });
    })
  );
});

/* ── Stratégie réseau : Network-first pour HTML, Cache-first pour le reste ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Les appels API ne sont jamais mis en cache
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // ── STRATÉGIE NETWORK-FIRST pour les documents HTML ──
  // On essaie d'abord le réseau, et on tombe sur le cache si offline.
  // Comme ça la dernière version est toujours servie quand on a du réseau.
  const isDocument = event.request.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');

  if (isDocument) {
    event.respondWith(
      fetch(event.request).then(response => {
        // Mettre à jour le cache avec la version fraîche
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Pas de réseau : fallback sur le cache
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Si on cherchait saisie.html et qu'il n'est pas en cache, on retourne celui qu'on a
          if (url.pathname.includes('saisie')) {
            return caches.match('/saisie.html');
          }
          return new Response('Hors ligne', { status: 503 });
        });
      })
    );
    return;
  }

  // ── STRATÉGIE CACHE-FIRST pour les ressources statiques (CSS/JS/images) ──
  // Mais on actualise le cache en arrière-plan (stale-while-revalidate)
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => null);

      // On renvoie le cache immédiatement si présent, et on rafraîchit en arrière-plan
      return cached || networkFetch;
    })
  );
});

/* ── Écoute les messages depuis la page (ex: "force update now") ── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
