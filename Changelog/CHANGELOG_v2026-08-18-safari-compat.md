# Suiv'Heures — Journal des modifications

## Version du 18 août 2026 — Compatibilité Safari macOS renforcée (sync9)

État : déployée en production sur `suivi-heures.volitis.net`, validée en test réel chez un client sur MacBook Safari.

Cette version corrige un problème de compatibilité qui empêchait la synchronisation des saisies vers le serveur sur certains Mac équipés de Safari en configuration stricte. Symptôme utilisateur : « mes saisies du Prévisionnel disparaissent après rechargement de la page ».

---

## Le problème rencontré

Chez un client équipé d'un MacBook (Safari macOS), les saisies effectuées dans la page Prévisionnel disparaissaient systématiquement après rechargement de la page. Les mêmes saisies effectuées depuis un autre appareil (PC Chrome) restaient bien enregistrées.

**Diagnostic mené sur place** (long, plusieurs pistes explorées) :

1. **Sauvegarde locale (localStorage)** : vérifiée avec la console → les données étaient bien sauvegardées en local
2. **AdGuard** : suspecté puis écarté (test avec désactivation ne changeait rien)
3. **Paramètres Safari confidentialité/sécurité/JavaScript** : tous vérifiés, corrects
4. **Service Worker résiduel** : purgé via effacement des données de site, sans effet
5. **Certificat SSL / DNS** : validé (le site s'ouvre correctement sur d'autres appareils)
6. **Onglet Réseau des DevTools** : révélation clé — **aucune requête POST vers `/api/data` n'était émise** lors des saisies, alors qu'il aurait dû y en avoir toutes les 2 secondes
7. **Test décisif** : `localStorage.setItem.toString()` renvoyait `function setItem() { [native code] }`

**Cause identifiée** : sur ce Mac, Safari **refuse silencieusement la réassignation de `localStorage.setItem`** (une méthode native). Le code de sync qui intercepte cette méthode pour déclencher la sauvegarde serveur voit sa surcharge simplement ignorée par le navigateur. Résultat : les données s'écrivent bien en local mais aucune sauvegarde serveur ne se déclenche jamais. Au rechargement, le serveur (qui n'a jamais rien reçu) renvoie une version vide qui écrase le local.

Cause profonde probable : configuration Safari renforcée (Lockdown Mode ou politique équivalente non identifiée dans les réglages visibles), version macOS spécifique, ou politique de sécurité entreprise.

---

## La correction

### Filet de secours par polling automatique

Le fichier `sync.js` a été enrichi de deux protections en cascade :

**Protection 1 — SecurityError sur écriture locale** :
Si `localStorage.setItem` lève une erreur (mode privé, quota, sécurité stricte), la donnée est stockée en cache mémoire JavaScript et **la sauvegarde serveur est déclenchée immédiatement** (sans coalescence). Un bandeau rouge informatif s'affiche à l'utilisateur.

**Protection 2 — Refus de surcharge (nouveau, spécifique Safari)** :
Au démarrage de la page, le code teste si le navigateur a bien accepté la surcharge de `localStorage.setItem`. Si non (cas du MacBook client), un **polling léger** est activé : toutes les 2 secondes, le code compare les valeurs actuelles des clés applicatives à leur dernier état connu (via un hash simple), et déclenche la sauvegarde serveur si un changement est détecté.

**Impact** : nul sur les navigateurs qui acceptent la surcharge (Chrome, Firefox, Edge, Safari standard). Le polling ne s'active que quand la surcharge est refusée, ce qui reste rare mais désormais géré.

**Interception symétrique de `getItem`** : quand le stockage local est bloqué, la lecture retombe automatiquement sur le cache mémoire, ce qui préserve la cohérence des données pendant la session.

### Message console au démarrage

Sur les navigateurs concernés, un message apparaît en console : *« Surcharge localStorage refusée par le navigateur → activation du filet polling (2 s). »* Utile pour le diagnostic futur si un cas similaire se présente.

---

## Bugs corrigés en cours de session

### Erreur "FetchEvent.respondWith received an error: Returned response is null"

**Symptôme** : sur le premier chargement de la page depuis Safari sur le MacBook du client, Safari affichait cette erreur écran noir.

**Cause** : Service Worker de version antérieure (v3) qui, sur Safari, pouvait retourner `null` au lieu d'une vraie `Response` HTTP.

**Résolution ponctuelle** : effacement des données du site (Réglages Safari → Confidentialité → Gérer les données de sites web → supprimer volitis.net). Nouveau chargement de la page → Service Worker v4 installé → problème résolu.

**Prévention** : la nouvelle version du Service Worker (v4) déployée précédemment garantit qu'aucune réponse `null` ne peut être retournée. Ne devrait plus se reproduire chez de nouveaux clients.

### Confusion certificat/session lors du test

À un moment durant la manip, Safari a affiché « Cette connexion n'est pas privée » sur `suivi-heures.volitis.net`. En réalité, un onglet supplémentaire ouvert affichait bien l'app correctement — c'était juste un autre onglet en état incohérent qu'il fallait fermer. Pas de véritable problème de certificat.

---

## Numéro de version

Le numéro affiché en bas à gauche de toutes les pages passe de :
- `v2026.07.12-sync8` → **`v2026.08.18-sync9`**

Permet de vérifier rapidement si un client tourne bien sur la version corrigée.

---

## Points d'attention pour la suite

### Communication client

Pour les prospects et clients Mac : préciser dans la documentation que **Chrome ou Edge** sont recommandés sur macOS, Safari fonctionnant avec un léger filet de secours (2 s de délai de sync en plus, invisible à l'usage). Firefox reste non supporté pour l'installation PWA bureau mais fonctionne pour l'usage courant.

### Diagnostic à distance

Pour vérifier rapidement chez un futur client s'il est dans le cas Safari strict :
1. Ouvrir la console (Cmd + Option + C)
2. Taper : `localStorage.setItem.toString().substring(0, 100)`
3. Si le résultat contient `[native code]` → cas Safari strict, le filet polling est actif automatiquement
4. Si le résultat contient `_setItemOriginal` ou `echecEcriture` → cas standard, interception classique

### Robustesse générale

Le fichier `sync.js` gère désormais quatre situations différentes selon le navigateur :
- Cas standard (Chrome, Edge, Firefox, Safari moderne) : interception directe de `setItem`
- Cas Safari strict (Mac client) : polling de secours toutes les 2 s
- Cas mode privé / quota plein : cache mémoire + envoi serveur immédiat
- Cas hors ligne : coalescence + retry, envoi de sécurité au déchargement (sendBeacon)

Toutes les combinaisons ont été prises en compte dans ce patch.

---

## Fichier modifié

- `public/sync.js` :
  - Détection au chargement : test d'écriture localStorage et vérification que la surcharge a été acceptée
  - Cache mémoire de secours quand localStorage bloqué
  - Bandeau rouge d'information à l'utilisateur si stockage bloqué
  - Polling léger (2 s) activé automatiquement si la surcharge de setItem a été refusée
  - Numéro de version : `v2026.07.12-sync8` → `v2026.08.18-sync9`

Le patch fait environ 125 lignes ajoutées, toutes localisées au même endroit du fichier. Le reste de `sync.js` (1188 lignes originales) est strictement identique.

---

## État stable retenu

Tag Git suggéré : `v2026.08.18-sync9-compat-safari`.

---

## Chronologie des sessions

- 26-28 mai 2026 : versions 1.0 à 1.5.1 (fonctionnalités et corrections initiales)
- 12 juillet 2026 : passage à sync8 (renforcements côté sync)
- **18 août 2026 : sync9 (compatibilité Safari macOS renforcée — cette version)**

---

## Bonnes pratiques rappelées

- Ne pas surcharger silencieusement les méthodes natives sans vérifier que le navigateur l'a accepté (test `.toString()`)
- Toujours prévoir un chemin de secours quand on dépend de comportements navigateur non standardisés
- L'onglet Réseau des DevTools est le meilleur outil pour diagnostiquer les problèmes de sync : voir si les requêtes attendues partent effectivement
- Sur Mac : les raccourcis clavier français peuvent être piégeux (`[` = Option+Shift+(, `{` = Option+()
- Copier-coller les commandes de diagnostic plutôt que les retaper, évite les erreurs de frappe
