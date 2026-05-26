# Suiv'Heures — Journal des modifications

## Version du 26 mai 2026

### Sécurité

- **Auth PIN salarié côté serveur** (`server/routes/saisies.js`)
  Nouvelle route `POST /api/saisies/auth-pin`. Les PIN ne sont plus jamais envoyés au navigateur via `/connect` — le mobile envoie le PIN saisi et le serveur valide. Plus aucun risque de voir les PIN d'autres salariés en inspectant la console.

- **Suppression des hash résiduels**
  Anciens PIN hashés (`$2a$10$…`) dans MongoDB ré-écrits en clair via le bouton 💾 sur la page Salariés. Plus de hashage automatique côté serveur.

### Page Entreprise

- **Bouton ⏻ Déconnexion** dans le bandeau bleu, à droite, sous le badge "Licence active". Confirmation, vide le `localStorage` et revient à l'accueil. Les données serveur ne sont jamais affectées.

- **Badge "PLUS"** maintenant correctement affiché à côté de "Licence active" quand la licence est de type Plus (avant : invisible sur la page Entreprise à cause d'un bug d'initialisation).

- **Nav Plus visible sur la page Entreprise** : Saisie mobile, Planning réalisé, Rapports apparaissent désormais dès la page d'accueil pour les licences Plus.

### Page Salariés

- **PIN masqués par défaut** (`••••`), affichage en clair via le bouton 👁 (qui devient 🙈 quand visible).
- **Bouton 💾 Enregistrer les PIN** : sauvegarde immédiate côté serveur sans attendre la sync auto.
- **Pavé numérique** déclenché sur mobile quand on tape un PIN (`inputmode="numeric"`).
- **Anti-autofill** : les gestionnaires de mots de passe (Chrome, Railway, etc.) n'interfèrent plus avec les cases PIN.

### Page Prévisionnel (Reporter un chantier)

- **Heures disponibles affichées** dans l'en-tête de la modale.
- **Compteur en temps réel** : "À reporter : X h · Reste sur le mois source : Y h", passe en rouge si dépassement.
- **Bouton "Reporter" désactivé** si on tente de reporter plus d'heures que disponibles.
- **Suppression automatique du chantier source** si tout est reporté.
- **Fusion des chantiers** : si on reporte vers un mois qui contient déjà un chantier du même client, les heures se cumulent au lieu de créer un doublon.
- **Tableau indicateur du haut rafraîchi** automatiquement après un transfert total (avant : nécessitait un rafraîchissement manuel de la page).

### Saisie mobile

- **En-tête figé** : le bandeau bleu (Saisie journalière + Sortir + Déconnexion) et la zone blanche (nom + date) restent collés en haut lors du scroll.
- **Chantiers prévus = uniquement ceux du planning du jour pour ce salarié.** Plus de fallback global qui affichait tous les chantiers prévisionnels de l'entreprise.
- **Envoi serveur progressif** : chaque clic OK pousse l'état du chantier au serveur immédiatement (arrivée seule, puis départ, puis modifications). Plus d'attente du bouton "Envoyer ce chantier".
- **Restauration au retour** : quand le salarié se reconnecte ou change de date, les chantiers déjà saisis ce jour-là sont préremplis (heures, déplacement, badge "✔ Enregistré"). Plus de perte visuelle des saisies.
- **Rafraîchissement automatique** du planning au changement de date (récupère les modifications faites côté patron pendant la session).

### Page Planning Réalisé

- **Scroll automatique vers le jour du jour** à l'ouverture (ou le jour saisi le plus récent si rien aujourd'hui). Si on consulte un mois passé ou futur, pas de scroll auto (reste en haut).

### Page Rapports

- **Export Excel** (📊) : fichier `.xlsx` à 3 feuilles (Synthèse, Détail prévu, Détail réalisé).
- **Export PDF** (📄) : synthèse côte à côte (prévu / réalisé) + détails sur pages suivantes + pagination.
- **Période personnalisée pour l'export** : lien repliable sous les filtres, permet de saisir une date de début et de fin. Si renseignée, les exports portent sur cette période ; sinon, sur le mois actuellement filtré.

### Stabilité

- **Plus de mélange de données entre licences** : quand on bascule sur une autre licence sans déconnexion préalable, les données du client précédent sont vidées et la page se recharge automatiquement. Avant : risque d'écraser le serveur du nouveau client avec les données de l'ancien.

- **Gestion globale des 401** dans `sync.js` : si le token de licence expire en cours d'utilisation, déconnexion propre + redirection vers l'accueil au lieu d'un plantage silencieux.

- **Fallback serveur amélioré** : les requêtes `/api/*` qui n'existent pas renvoient une 404 JSON propre (avant : renvoyait `index.html`, ce qui cassait le parsing côté front).

### Dépendances

- **Retrait de bcrypt / bcryptjs** : plus utilisé suite à la décision de garder les PIN en clair côté serveur. `package.json` allégé.

---

## Bonnes pratiques recommandées (pour le développement)

Le cache navigateur peut masquer des modifications fraîchement déployées. Pour éviter les fausses alertes pendant le développement :

- **Garder les DevTools ouverts** (F12) avec la case **"Disable cache"** cochée dans l'onglet Network.
- **Ctrl+Shift+R** après chaque déploiement pour forcer un rechargement complet.
- **Mode incognito** pour valider rapidement qu'un changement marche sur une session "neuve".
- Raccourci utile pour tout vider en cas de doute :
  ```js
  localStorage.clear();
  sessionStorage.clear();
  navigator.serviceWorker?.getRegistrations().then(r => r.forEach(x => x.unregister()));
  caches?.keys().then(k => k.forEach(c => caches.delete(c)));
  location.reload(true);
  ```
