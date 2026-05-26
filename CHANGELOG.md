# Suiv'Heures — Journal des modifications

## Version du 26 mai 2026 (suite)

### Saisie mobile — partage et installation

- **QR code à côté du cadre téléphone** sur la page Saisie mobile (PC uniquement).
  Dès qu'un code employé est validé, un panneau apparaît à droite avec :
  - QR code SVG (lib `qrcode-generator`)
  - URL en clair en dessous
  - Bouton **🖨️ Imprimer** pour une affiche A4 avec QR agrandi, URL et code employé
  Le QR encode `https://…/saisie.html?code=XXX`. Lors du scan, le navigateur ouvre l'app, lit le paramètre, mémorise le code et lance la reconnexion automatique. Le `?code=` est ensuite retiré de l'URL pour ne pas traîner dans l'historique.

- **Bandeau d'installation PWA** en haut de l'écran saisie mobile.
  - **Android (Chrome)** : bouton "📲 Installer" → boîte de dialogue native du navigateur → app installée sur l'écran d'accueil.
  - **iPhone (Safari)** : bouton → modal avec instructions visuelles (Partager → Sur l'écran d'accueil → Ajouter).
  - **App déjà installée** (mode `display-mode: standalone`) : bandeau caché automatiquement.
  - **Bouton "×" Plus tard** : bandeau caché pendant 7 jours, puis réapparaît.
  - **Installation détectée** (événement `appinstalled`) : bandeau fermé définitivement.

### Saisie mobile — gestion des comptes

- **Lien "Changer d'entreprise"** discret sous l'écran PIN.
  Permet de basculer entre comptes clients pour les administrateurs Volitis sans déconnexion forcée. Pour les salariés, c'est une action confirmée explicitement (popup) qui efface toutes les données locales et permet de saisir un autre code employé.

### Sécurité des PIN salariés

- **Préservation des PIN locaux lors de la synchro mobile.**
  La route `/api/saisies/connect` (utilisée par la saisie mobile) ne renvoie jamais les PIN au navigateur — par sécurité. Mais comme cette donnée écrasait localement `salariesdata` qui contient aussi les PIN gérés par le patron, la sync auto pouvait pousser une version sans PIN au serveur, effaçant ainsi tous les PIN.
  **Correctif** : à chaque écriture de `salariesdata` côté mobile (3 endroits : `reconnecterAuto`, validation manuelle du code, `rafraichirDonneesServeur`), on fusionne avec les PIN locaux existants avant d'écrire.

### Stabilité — gestion multi-comptes

- **Plus de mélange entre licences.**
  Quand on bascule sur une autre licence sans déconnexion préalable, les données du client précédent (`salariesdata`, `heuresdata`, `previsionnel_data`, etc.) sont vidées et la page est rechargée automatiquement. Évite les écrasements croisés (un client qui pousse les données d'un autre par erreur de synchronisation).

- **Bouton "⏻ Déconnexion"** dans le bandeau bleu de la page Entreprise.
  Confirmation + `localStorage.clear()` + retour à l'accueil. Les données serveur ne sont jamais affectées. Plus besoin de bidouiller la console pour basculer entre licences.

### Affichage et navigation

- **Badge "PLUS"** correctement affiché sur **toutes** les pages (avant : visible uniquement sur Entreprise à cause d'un défaut d'initialisation côté `sync.js`).

- **Nav Plus visible sur la page Entreprise** : les onglets "Saisie mobile", "Planning réalisé" et "Rapports" apparaissent désormais dès la page d'accueil pour les licences Plus.

- **Rafraîchissement automatique de la page Salariés** après chargement des données serveur. Plus besoin de rafraîchir manuellement quand on arrive sur la page via l'admin (avant : tableau vide tant qu'on n'avait pas fait F5).

### Page Prévisionnel (Reporter un chantier)

- **Heures disponibles affichées** dans l'en-tête de la modale.
- **Compteur temps réel** "À reporter X h · Reste sur le mois source Y h", passe en rouge si dépassement.
- **Bouton "Reporter" désactivé** en cas de dépassement.
- **Suppression automatique du chantier source** si tout est reporté.
- **Fusion automatique** : si on reporte vers un mois contenant déjà un chantier du même client, les heures se cumulent (pas de doublon).
- **Tableau indicateur du haut rafraîchi automatiquement** après un transfert total (avant : nécessitait un rafraîchissement manuel).

### Saisie mobile — comportement

- **En-tête figé** : bandeau bleu (Saisie journalière + Sortir + Déconnexion) et zone blanche (nom + date) restent collés en haut lors du scroll.
- **Chantiers prévus = uniquement ceux du planning du jour pour ce salarié.** Plus de fallback global qui affichait tous les chantiers prévisionnels de l'entreprise.
- **Envoi serveur progressif** : chaque clic OK pousse l'état du chantier au serveur immédiatement.
- **Restauration au retour** : quand le salarié se reconnecte ou change de date, les chantiers déjà saisis ce jour-là sont préremplis (heures, déplacement, badge "✔ Enregistré").
- **Rafraîchissement automatique** du planning au changement de date.

### Page Planning Réalisé

- **Scroll automatique vers le jour du jour** à l'ouverture, ou le jour saisi le plus récent. Si on consulte un autre mois, pas de scroll auto.

### Page Rapports

- **Export Excel (📊)** : fichier `.xlsx` à 3 feuilles (Synthèse, Détail prévu, Détail réalisé).
- **Export PDF (📄)** : synthèse côte à côte (prévu / réalisé) + détails sur pages suivantes + pagination.
- **Période personnalisée pour l'export** : lien repliable sous les filtres, permet de saisir une date de début et de fin. Si renseignée, les exports portent sur cette période ; sinon, sur le mois actuellement filtré.

### Page Salariés

- **PIN masqués par défaut** (`••••`), affichage en clair via le bouton 👁 (qui devient 🙈 quand visible).
- **Bouton 💾 Enregistrer les PIN** : sauvegarde immédiate côté serveur sans attendre la sync auto.
- **Pavé numérique** déclenché sur mobile (`inputmode="numeric"`).
- **Anti-autofill** : les gestionnaires de mots de passe (Chrome, Railway, etc.) n'interfèrent plus avec les cases PIN.

### Stabilité — autres

- **Auth PIN salarié côté serveur** (`server/routes/saisies.js`).
  Les PIN ne sont plus jamais envoyés au navigateur via `/connect`. Le mobile envoie le PIN saisi et le serveur valide.
- **Gestion globale des 401** dans `sync.js` : si le token de licence expire en cours d'utilisation, déconnexion propre + redirection au lieu d'un plantage silencieux.
- **Fallback serveur amélioré** : les requêtes `/api/*` inconnues renvoient une 404 JSON propre (avant : renvoyait `index.html`, ce qui cassait le parsing côté front).
- **Retrait de bcrypt / bcryptjs** : plus utilisé, `package.json` allégé.

---

## Bonnes pratiques (développement)

Le cache navigateur peut masquer des modifications fraîchement déployées. Côté développeur :

- **Garder les DevTools ouverts** (F12) avec la case **"Disable cache"** cochée dans l'onglet Network.
- **Ctrl+Shift+R** après chaque déploiement pour forcer un rechargement complet.
- **Mode incognito** pour valider qu'un changement marche sur une session neuve.
- Raccourci utile pour tout vider en cas de doute :
  ```js
  localStorage.clear();
  sessionStorage.clear();
  navigator.serviceWorker?.getRegistrations().then(r => r.forEach(x => x.unregister()));
  caches?.keys().then(k => k.forEach(c => caches.delete(c)));
  location.reload(true);
  ```

Les vrais utilisateurs (salariés et patrons clients) ne rencontrent pas ces problèmes : leur navigateur gère le cache normalement et les mises à jour sont fluides.

---

## Limites connues

- **Installation PWA "silencieuse" impossible** : Apple et Google interdisent l'installation d'une app sans confirmation utilisateur. Pour atteindre ce niveau, il faudrait publier sur les stores (Google Play 25 € une fois, App Store 99 €/an + Mac requis). Pour un outil métier interne, le scénario actuel (1-3 taps utilisateur pour installer) est largement suffisant.

- **Pas de mode "super-admin" multi-licences** sur mobile. Pour des raisons de sécurité (le code source du navigateur étant lisible, un mot de passe en dur serait découvrable en 10 secondes), l'accès aux saisies de plusieurs entreprises depuis un téléphone nécessiterait une vraie authentification serveur avec mot de passe robuste + JWT, à coder spécifiquement. Décision : reportée.
