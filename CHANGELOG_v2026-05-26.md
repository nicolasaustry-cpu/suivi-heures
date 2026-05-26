# Suiv'Heures — Version stable

## Version du 26 mai 2026

**État** : déployée en production sur `suivi-heures.volitis.net`, fonctionnelle et testée.

Cette version constitue un **point de référence stable**. Toute évolution ultérieure peut s'y rapporter en cas de régression.

---

## Fonctionnalités opérationnelles

### Sécurité et authentification

- **PIN salariés en clair côté serveur**, jamais transmis au navigateur via `/api/saisies/connect` (strippage automatique). Le mobile valide via `POST /api/saisies/auth-pin` en envoyant le PIN saisi.
- **Token JWT licence client** valide 30 jours, stocké dans `localStorage` (`syncToken`).
- **Plus de bcrypt / bcryptjs** : décision de garder les PIN en clair côté base, fluidifie la saisie côté patron.

### Page Entreprise (`index.html`)

- Bandeau bleu avec logo Volitis, slogan, titre, **nom entreprise** (pré-rempli à la 1ʳᵉ connexion depuis `nomClient` de la licence), **badge ✓ Licence active [PLUS]** si applicable, **bouton ⏻ Déconnexion**.
- Champs : nom entreprise, code employé (transmis aux salariés pour saisie mobile), seuils de jauge (rouge/orange/vert) avec aperçu en direct, case "Figer les seuils" pour verrouiller.
- **Seuils stockés dans `entreprisedata.jauge`** : suivent la sync auto vers MongoDB, partagés entre tous les ordinateurs/navigateurs du client.

### Page Salariés (`salaries.html`)

- Ajout / modification / suppression de salariés.
- **PIN à 4 chiffres** par salarié, **masqués par défaut** (`••••`), affichage en clair via bouton 👁/🙈.
- **Bouton 💾 Enregistrer les PIN** : sauvegarde immédiate côté serveur sans attendre la sync auto.
- Pavé numérique automatique sur mobile, anti-autofill des gestionnaires de mots de passe.
- Rafraîchissement automatique du tableau quand les données serveur arrivent (listener `donnees-chargees`).

### Page Prévisionnel (`chantiers.html`)

- Tableau d'indicateurs (Heures vendables, devis, écart, %) calculés automatiquement avec couleur selon les seuils de jauge.
- Saisie des chantiers par mois.
- **Modale "Reporter un chantier"** :
  - Affichage des **heures disponibles** dans l'en-tête.
  - **Compteur temps réel** "À reporter X h · Reste Y h" avec passage en rouge si dépassement.
  - **Bouton Reporter désactivé** si dépassement.
  - **Suppression automatique du chantier source** si tout est reporté.
  - **Fusion automatique** sur destinations contenant déjà un chantier du même client.
  - **Tableau indicateur rafraîchi automatiquement** après transfert.

### Page Planning (`planning.html`)

- Planning hebdomadaire par salarié.
- Lecture des seuils de jauge depuis `entreprisedata.jauge` en priorité, fallback sur anciennes clés.
- Jauges colorées selon les seuils configurés.

### Page Planning Réalisé (`realise.html`)

- Tableau mensuel des heures réellement saisies par les salariés via le mobile.
- **Scroll automatique vers le jour du jour** à l'ouverture (ou jour le plus récent ≤ aujourd'hui).
- Comparaison réel / prévu avec écart calculé et coloré.

### Page Rapports (`rapports.html`)

- Synthèse mensuelle avec filtres multi-sélection (salariés / chantiers).
- **Export Excel 📊** : 3 feuilles (Synthèse, Détail prévu, Détail réalisé).
- **Export PDF 📄** : synthèse côte à côte + détails sur pages suivantes + pagination.
- **Période personnalisée** repliable : input date début / date fin pour limiter l'export.

### Saisie mobile (`saisie.html`)

#### Header cohérent avec les autres pages (sur PC)

- Logo Volitis + slogan + titre "Saisie mobile" + nom entreprise + badge PLUS + bouton Déconnexion.
- Nav identique aux autres pages, avec onglets Plus en vert.

#### Téléphone d'aperçu + QR de partage (PC uniquement)

- **Téléphone d'aperçu compact** (300×600 px) à gauche.
- **Panneau QR à droite** dès qu'un code employé est saisi :
  - QR code SVG 200 px (lib `qrcode-generator@1.4.4`)
  - URL en clair : `https://.../saisie.html?code=XXX`
  - Bouton **🖨️ Imprimer** : génère une affiche A4 avec QR agrandi + URL + code employé
- Au scan du QR sur un téléphone, l'app détecte le paramètre `?code=`, mémorise le code, lance la reconnexion automatique. URL nettoyée après.

#### Bandeau d'installation PWA

- **Android (Chrome)** : bouton "📲 Installer" → boîte de dialogue native → app installée sur l'écran d'accueil.
- **iPhone (Safari)** : bouton → modal avec instructions visuelles (Partager → Sur l'écran d'accueil → Ajouter).
- Détection automatique si app déjà installée (`display-mode: standalone`).
- Bouton "×" Plus tard → bandeau caché 7 jours.

#### Écran PIN et saisie

- Sélecteur de salarié + pavé PIN 4 chiffres.
- **Lien "Changer d'entreprise"** discret : permet à un administrateur ou à un salarié de basculer vers un autre code employé (efface toutes les données locales du mobile et recharge).
- En-tête figé (bandeau bleu + nom/date) lors du scroll.

#### Écran de saisie journalière

- **Chantiers prévus = uniquement ceux du planning du jour pour ce salarié** (filtrage strict salarieId+date).
- **Envoi serveur progressif** : chaque OK arrivée / OK départ pousse immédiatement au serveur (upsert par nom de chantier).
- **Restauration au retour** : récupération via `POST /api/saisies/mobile-day` des chantiers déjà saisis ce jour, préremplissage des heures, badge "✔ Enregistré", boutons OK verts.
- Ajout de chantiers libres (en plus du planning prévu) sans limite.
- Compteur déplacement (par incréments de 15 min).

### Stabilité multi-comptes

- **Plus de mélange entre licences.** Au changement de client (autre code licence saisi), les données du client précédent sont vidées du localStorage et la page se recharge automatiquement.
- **Préservation des PIN locaux** lors de la sync mobile : à chaque écriture de `salariesdata` par le mobile (3 endroits : `reconnecterAuto`, validation manuelle code, `rafraichirDonneesServeur`), fusion avec les PIN locaux existants pour éviter l'écrasement par la sync auto.
- **Pré-remplissage automatique** du nom entreprise à partir du `nomClient` de la licence si le serveur n'a pas encore de donnée entreprise.
- **Rafraîchissement asynchrone** des pages Salariés, Entreprise et autres dès l'arrivée des données serveur (listener `donnees-chargees`).
- **Bouton ⏻ Déconnexion centralisé** : injecté automatiquement par `sync.js` sur toutes les pages, sous le badge licence.

### Admin Volitis (`admin.html`)

- Identifiants admin via variables d'environnement Railway (`ADMIN_EMAIL`, `ADMIN_PASSWORD`).
- Création / modification / suppression de licences clients.
- Bouton "Consulter client" : ouvre `index.html?admin=1&client=XXX` dans un nouvel onglet avec session client temporaire.

---

## Architecture technique

### Stack

- **Backend** : Node.js + Express + MongoDB (Mongoose), déployé sur **Railway** via GitHub (push automatique).
- **Frontend** : HTML / JS vanilla, PWA avec service worker pour cache statique et mode hors-ligne partiel.
- **Auth** : JWT 30 jours pour les clients, 8h pour l'admin.

### Modèles MongoDB

- **`Licence`** : `codeClient`, `nomClient`, `email`, `dateExpiration`, `type` ('standard' | 'plus'), `notes`.
- **`Donnees`** : `clientId`, `entreprise` (nom, codeEmploye, jauge), `salaries` (id, prenom, nom, pin, heuresParJour…), `heures` (planning), `chantiers`, `previsionnel`.
- **`Saisie`** : `clientId`, `salarieId`, `salarieNom`, `date`, `chantiers` (nom, heureArrivee, heureDepart, dureeMin, deplacement, isPrevisionnel), `totalMin`, `statut`.

### Routes API principales

- `POST /api/auth/login`, `POST /api/auth/verify`, `POST /api/auth/admin-login`
- `GET /api/data`, `POST /api/data` (client : lecture/écriture de ses données entreprise)
- `POST /api/saisies/connect` (mobile : récupère salariés sans PIN), `POST /api/saisies/auth-pin`, `POST /api/saisies/envoyer`, `POST /api/saisies/mobile-day`
- `GET /api/saisies/:mois`, `GET /api/saisies/:mois/:salarieId` (patron : lecture des saisies)
- `PATCH /api/saisies/:id/valider` (patron : validation d'une saisie)
- Routes admin sous `/api/admin/*` (création / modification de licences)

### Synchronisation

- Toutes les écritures dans `localStorage` (5 clés : `entreprisedata`, `salariesdata`, `heuresdata`, `chantiersdata`, `previsionnel_data`) déclenchent une sync automatique vers MongoDB après 2 secondes (debounce).
- Au chargement d'une page : vérification du token via `/verify`, puis appel à `/api/data` pour rafraîchir.
- Émission de l'événement `donnees-chargees` après chaque rafraîchissement → permet aux pages de re-rendre leur contenu.

---

## Points de vigilance (limites connues)

- **Cache navigateur côté développeur** : après chaque déploiement Railway, Ctrl+Shift+R nécessaire pour voir les nouveautés. Bonnes pratiques : DevTools ouverts + case "Disable cache" cochée dans Network, ou tests en mode incognito.
- **Pas de mode super-admin mobile** multi-licences (volontairement reporté pour des raisons de sécurité — un mot de passe en dur dans le navigateur serait facilement contournable).
- **Installation PWA 100% silencieuse impossible** (limite imposée par Apple et Google). Le bandeau d'installation requiert 1 tap utilisateur sur Android et 3 taps sur iPhone, c'est le minimum technique.
- **Pas de modification ni suppression des saisies réalisées** dans le Planning Réalisé. Si un salarié saisit une erreur, le patron ne peut actuellement pas la corriger depuis l'interface — décision : à implémenter dans une version ultérieure.

---

## Bonnes pratiques de développement

Pour les sessions de développement et de test :

- **DevTools ouverts** (F12) avec **"Disable cache"** coché dans Network.
- **Ctrl+Shift+R** après chaque push pour forcer le rechargement.
- **Mode incognito** (Ctrl+Maj+N) pour valider qu'un changement fonctionne sur une session neuve.
- **Workflow GitHub Desktop** : modifier fichier → Commit to main → **ne pas oublier Push origin** → Railway redéploie automatiquement en 1-2 min.
- **Vérification du déploiement Railway** : onglet Deployments → dernier commit avec statut "Success".

Raccourci utile pour tout vider en cas de doute :

```js
localStorage.clear();
sessionStorage.clear();
navigator.serviceWorker?.getRegistrations().then(r => r.forEach(x => x.unregister()));
caches?.keys().then(k => k.forEach(c => caches.delete(c)));
location.reload(true);
```

Les vrais utilisateurs (salariés et patrons clients) ne rencontrent pas ces problèmes : leur navigateur gère le cache normalement et les mises à jour sont fluides.

---

## Documents complémentaires fournis

- **Guide_Raccourci_SuivHeures.docx** : guide d'installation côté patron (créer un raccourci bureau avec icône Suiv'Heures sur Windows).
- **SuivHeures.ico** : fichier d'icône Windows multi-résolutions pour personnaliser le raccourci bureau.
