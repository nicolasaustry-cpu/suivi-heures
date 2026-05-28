# Suiv'Heures — Journal des modifications

## Version du 26 mai 2026 (suite)

État : déployée en production sur `suivi-heures.volitis.net`, fonctionnelle et testée.

Cette version complète et stabilise la version stable précédente (`CHANGELOG_v2026-05-26.md`).

---

## Nouveautés

### Planning Réalisé — Modifier et supprimer une saisie

Le patron peut désormais corriger ou supprimer une saisie réalisée par erreur via l'application mobile.

- **Bouton crayon jaune ✏** sur chaque ligne de chantier : ouvre une modale d'édition avec les champs pré-remplis (nom du chantier, heure d'arrivée, heure de départ, déplacement). Le bouton "💾 Enregistrer" valide la modification.
- **Bouton poubelle rouge 🗑** : confirmation puis suppression définitive du chantier.
- **Suppression intelligente** : si on supprime le dernier chantier d'une saisie, la saisie complète est supprimée (pas de saisie vide qui reste dans la base).
- **Recalcul automatique** des durées et totaux côté serveur.
- **Sécurité** : seul le patron du compte peut modifier ses propres saisies (vérification `clientId` côté serveur).
- **Icônes SVG colorées** (crayon jaune, poubelle rouge) avec effet de survol et léger zoom, **masquées automatiquement à l'impression**.
- Aucun bouton sur les **lignes "prévu"** (chantiers prévisionnels non encore saisis).

**Décisions** :
- Modification + suppression uniquement par le patron (depuis son PC). Pas de modification rétroactive par le salarié.
- Pas d'historique des modifications (gain de simplicité, à reconsidérer si litige avec un salarié).

### Rapports + Planning Réalisé — Filtre multi-mois

Plus d'input `<input type="month">` ni de sélecteur "Année". À la place, un **bouton multi-sélection style Excel** identique à ceux des filtres Salariés/Chantiers.

- **Picker multi-mois** : clic sur le bouton ouvre un dropdown avec :
  - Champ de recherche
  - Case "(Sélectionner tout)"
  - Liste cochable des mois disponibles, format "Avril 2026"
- **Mois proposés** : ceux ayant au moins une saisie réalisée (récupérés via la nouvelle route serveur `GET /api/saisies/mois-list`) plus le mois courant systématiquement.
- **Sélection par défaut** : mois en cours.
- **Affichage du bouton** : "Avril 2026 ▼" si 1 mois, "3 mois sélectionnés ▼" si plusieurs.
- **Sur Planning Réalisé** : sélection multiple → fetch parallèle des saisies de chaque mois, affichage groupé par jour en ordre chronologique. Le scroll auto vers aujourd'hui ne se déclenche que si le mois courant est dans la sélection.
- **Sur Rapports** : libellé adapté pour les exports Excel/PDF — "Mois Avril 2026" si 1, "3 mois (Janvier 2026 → Avril 2026)" si plusieurs.

**Décisions** :
- Mois proposés = ceux ayant des données (option pertinente, pas de mois "vide" dans la liste).
- Filtre Année retiré (le multi-mois est plus flexible : on peut mélanger des mois de plusieurs années si besoin).

### Documents fournis aux clients

- **`Guide_Raccourci_SuivHeures.docx`** : guide Word de 2 pages pour installer Suiv'Heures côté patron sur Windows :
  - Pourquoi un raccourci
  - Étape 1 : télécharger l'icône `.ico`
  - Étape 2 : créer le raccourci bureau pointant vers `https://suivi-heures.volitis.net`
  - Étape 3 : remplacer l'icône par celle de Suiv'Heures (clic droit → Propriétés → Changer d'icône)
  - Étape 4 (facultatif) : épingler à la barre des tâches
  - Section désinstallation
- **`SuivHeures.ico`** : fichier d'icône Windows multi-résolutions (16/32/48/64/128/256 px) avec le logo officiel de l'application, à fournir au client en même temps que le guide.

---

## Routes serveur ajoutées

Dans `server/routes/saisies.js` :

- `GET /api/saisies/mois-list` (verifyToken) : renvoie la liste triée des mois (`YYYY-MM`) ayant au moins une saisie pour le client connecté. **Déclarée AVANT `/:mois`** pour ne pas être interceptée par le matching paramétrique d'Express.
- `PATCH /api/saisies/:id/chantier/:idx` (verifyToken) : modifie un chantier précis dans une saisie. Vérifie le `clientId`. Recalcule `dureeMin` à partir des heures arrivée/départ et met à jour `totalMin`.
- `DELETE /api/saisies/:id/chantier/:idx` (verifyToken) : supprime un chantier précis dans une saisie. Si c'était le dernier chantier, supprime la saisie complète.

---

## Bugs corrigés

### Page Entreprise — pré-remplissage et seuils de jauge

**Bug 1** : à la première connexion d'un client, le champ "Nom de l'entreprise" était vide alors qu'il avait été saisi à la création de la licence par l'admin.
**Correctif** : `sync.js` mémorise désormais le `nomClient` reçu de `/login` et `/verify` dans `localStorage['syncNomClient']`. Dans `chargerDonnees`, si le serveur ne renvoie pas encore de nom d'entreprise, on pré-remplit avec ce `nomClient`. Le patron peut le modifier librement par la suite.

**Bug 2** : les réglages de la jauge (seuils rouge/orange, case "Figer") étaient stockés dans des clés `localStorage` séparées (`jaugeRouge`, `jaugeOrange`, `jaugeFige`) non listées dans `CLES` de `sync.js`. Conséquence : jamais poussés au serveur, donc perdus à chaque changement de PC / navigateur, et impossibles à partager entre utilisateurs du même compte.
**Correctif** : seuils désormais stockés dans `entreprisedata.jauge = { rouge, orange, fige }`, ce qui les fait passer par la sync auto vers MongoDB. Les anciennes clés sont conservées en parallèle pour migration douce. `planning.html` et `realise.html` lisent en priorité depuis `entreprise.jauge` avec fallback sur les anciennes clés.

### Saisie mobile — QR code

**Bug** : la lib `qrcode@1.5.3` choisie pour générer le QR est en réalité une lib Node.js, non compatible navigateur — résultat : 404 ou `QRCode undefined`.
**Correctif** : remplacée par `qrcode-generator@1.4.4` (lib pur navigateur, génération SVG inline, plus légère et plus nette visuellement).

---

## Améliorations graphiques

### Cohérence visuelle de la page Saisie mobile

La page Saisie mobile avait un design propre mais différent des autres pages (bandeau bleu minimaliste sans logo ni titre).
**Correctif** : aligné sur le style standard des autres pages :
- Bandeau bleu avec **logo Volitis**, slogan, titre "Saisie mobile", nom entreprise, badge PLUS, bouton Déconnexion
- Nav identique aux autres pages (gérée par `sync.js`, avec les onglets Plus affichés en vert)
- Téléphone d'aperçu compact (**300×600 px** au lieu de 390×780 px) à gauche
- Panneau QR à côté du téléphone (200 px SVG)
- L'option "Saisie mobile" n'apparaît dans la nav que pour les licences Plus (ne s'ajoute plus en doublon localement dans le HTML)

### Bouton Déconnexion partout

Avant : présent uniquement sur la page Entreprise.
**Maintenant** : injecté automatiquement par `sync.js` (`majStatutLicence`) sur **toutes les pages** (sous le badge licence). Une seule fonction `SYNC.seDeconnecter()` centralisée, plus de duplication dans `index.html`.

---

## État stable retenu

Cette version constitue un **point de référence stable**. Le code source à cette date sur GitHub correspond à cet état documenté.

Pour revenir à cette version en cas de régression future, il suffira de consulter l'historique des commits à la date de ce CHANGELOG (26 mai 2026).

Un **tag Git** dédié peut être créé depuis GitHub Desktop (onglet History → clic droit sur le dernier commit déployé → "Create tag" → nom suggéré : `v1.1-stable-2026-05-26`).

---

## Limites connues (toujours d'actualité)

- **Pas de mode super-admin mobile multi-licences** (volontairement reporté pour des raisons de sécurité — un mot de passe en dur dans le navigateur serait facilement contournable).
- **Installation PWA 100% silencieuse impossible** sur smartphone (limite Apple / Google). Le bandeau d'installation requiert 1 tap utilisateur sur Android et 3 taps sur iPhone.
- **Pas d'historique des modifications de saisies** : la modification écrase la saisie sans trace. À reconsidérer en cas de besoin de justification (litige avec un salarié).
- **Mois disponibles dans le picker = uniquement ceux avec des saisies serveur + mois courant**. Les mois ayant uniquement des prévisions (planning prévu) mais aucune saisie réalisée ne sont pas listés. Si on veut planifier sur un mois futur vide, le mois courant est sélectionné par défaut et il faut basculer manuellement.

---

## Bonnes pratiques de développement (rappel)

- DevTools ouverts (F12) avec **"Disable cache"** coché dans Network.
- Ctrl+Shift+R après chaque push pour forcer le rechargement.
- Mode incognito (Ctrl+Maj+N) pour valider qu'un changement fonctionne sur une session neuve.
- Workflow GitHub Desktop : modifier fichier → Commit to main → **ne pas oublier Push origin** → Railway redéploie automatiquement en 1-2 min.
- Vérification du déploiement Railway : onglet Deployments → dernier commit avec statut "Success".

Raccourci utile pour tout vider en cas de doute :

```js
localStorage.clear();
sessionStorage.clear();
navigator.serviceWorker?.getRegistrations().then(r => r.forEach(x => x.unregister()));
caches?.keys().then(k => k.forEach(c => caches.delete(c)));
location.reload(true);
```
