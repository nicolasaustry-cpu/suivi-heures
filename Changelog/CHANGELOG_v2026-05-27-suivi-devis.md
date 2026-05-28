# Suiv'Heures — Journal des modifications

## Version du 27 mai 2026 — Suivi des devis et corrections design

État : déployée en production sur `suivi-heures.volitis.net`, fonctionnelle et testée.

Cette version enrichit la **comparaison entre les heures prévues au devis et les heures réellement consommées** (planifiées dans le planning, réalisées sur le terrain). Elle complète également les ajustements graphiques de la session précédente (design Solaire) et les améliorations Rapports / Planning.

---

## Nouveautés

### Page Rapports — Encart "Heures prévues dans le devis"

Sur la carte **Synthèse Heures Réalisées**, ajout d'un encart bleu **à droite du tableau** affichant la somme des heures prévues au devis pour les chantiers sélectionnés.

- **Conditionnel** : l'encart n'apparaît **que si un filtre chantier est appliqué** (1 ou plusieurs chantiers cochés via le bouton multi-sélection). Si aucun filtre (option "Tous"), l'encart disparaît.
- **Source** : somme des heures prévues (`hPrevues`) lue depuis `previsionnel_data` pour les chantiers sélectionnés, **tous mois et toutes années confondus**.
- **Affichage** : titre "HEURES PRÉVUES DANS LE DEVIS" (sur 1 ligne, encart 200px de large), valeur en gros chiffres bleus, nombre de chantiers sélectionnés en sous-texte.
- **Layout** : tableau Synthèse et encart **centrés ensemble** dans la carte (espace réduit entre les deux).

### Page Rapports — Tableau Synthèse réalisée limité en hauteur

Au-delà de **4 lignes**, le tableau devient scrollable verticalement à l'intérieur de la carte.

- En-tête sticky (reste visible quand on scrolle).
- Total visible en bas, toujours présent.
- Évite que la carte s'allonge démesurément quand il y a beaucoup de salariés.

### Page Rapports — Renommages

Pour plus de clarté, les libellés des cartes ont été harmonisés autour de la formulation "Heures Planifiées / Réalisées" :

- "Synthèse prévue" → **"Synthèse Heures Planifiées"**
- "Synthèse réalisée" → **"Synthèse Heures Réalisées"**
- "Détail prévu" → **"Détail Heures Planifiées"**
- "Détail réalisé" → **"Détail Heures Réalisées"**

Les exports Excel (noms de feuilles) et PDF (titres de sections) ont également été mis à jour pour cohérence.

### Page Planning — Popup chantier : "Total devis" vs "Total planifié"

Quand on survole un nom de chantier dans la grille planning, la popup affiche désormais **deux totaux** :

```
Nom du chantier
Total devis : XX h        ← NOUVEAU
Total planifié : XX h
Salariés intervenus
...
```

- **Total devis** : somme des heures prévues pour ce chantier dans la page Prévisionnel (toutes années / tous mois confondus). Affiché en blanc, n'apparaît que si le chantier a des heures prévues au devis.
- **Total planifié** : somme des heures saisies dans le planning lui-même. Affiché en blanc par défaut.
- **Alerte rouge** : si Total planifié > Total devis, la valeur "Total planifié" passe en **rouge** pour signaler un dépassement visuellement immédiat.
- **Comparaison souple** des noms de chantier (casse, espaces, accents ignorés).

---

## Corrections de bugs

### Page Rapports — En-têtes de tableaux illisibles

**Problème** : les en-têtes "Salarié / Heures" du tableau Synthèse Heures Planifiées (bleu) et du tableau Synthèse Heures Réalisées (vert) apparaissaient en blanc sur fond blanc, donc illisibles. Le fond coloré du `<thead>` disparaissait dans certains contextes (sticky positioning, parents flex).

**Correctif** : application du fond directement sur les `<th>` plutôt que sur le `<thead>`, ce qui garantit un fond opaque en toutes circonstances.

### Page Rapports — Tableau Synthèse réalisée trop large

**Problème** : depuis l'ajout du scroll, le tableau s'étirait à toute la largeur disponible de la carte, créant des colonnes très larges avec beaucoup d'espace vide.

**Correctif** : largeur maximale du tableau limitée à **360px**, et `flex: 1 1 auto` pour qu'il s'adapte au contenu sans s'étendre inutilement. Layout centré pour un rendu plus équilibré.

---

## Fichiers modifiés

- `public/rapports.html` :
  - Renommages des titres (Synthèse / Détail Heures Planifiées / Réalisées)
  - Ajout du HTML de l'encart "Heures prévues dans le devis"
  - CSS pour le layout flex (tableau + encart centrés, espace 0.5rem)
  - CSS pour le scroll vertical (max-height 4 lignes + en-tête sticky)
  - CSS pour les `<th>` (fond opaque forcé)
  - Fonction `majEncartPrevus()` qui calcule la somme des heures prévues pour les chantiers filtrés
  - Renommages dans les exports Excel et PDF

- `public/planning.html` :
  - Fonction `getTotalDevisChantier(nom)` qui parcourt `previsionnel_data` pour trouver la somme des `hPrevues` du chantier
  - Modification de la popup chantier (`montrerTooltipChantier`) pour afficher la nouvelle ligne "Total devis"
  - Coloration conditionnelle de "Total planifié" en rouge si dépassement

---

## État stable retenu

Cette version constitue un point de référence stable. Tag Git suggéré : `v1.3-suivi-devis-2026-05-27`.

À chaque évolution future, vérifier que :
1. L'encart Heures prévues n'apparaît que si filtre chantier
2. Le calcul du Total devis dans Planning correspond bien aux heures saisies en Prévisionnel
3. Les en-têtes de tableaux Synthèse restent bien visibles en cas de modification du CSS

---

## Limites connues

- Le **Total devis dans Planning** se base sur la correspondance exacte du nom de chantier (après normalisation). Si vous renommez un chantier dans le Prévisionnel sans renommer son occurrence dans Planning, le rapprochement échoue.
- Pas encore d'alerte sur la page **Rapports** elle-même quand les heures réalisées dépassent les heures prévues au devis — pour l'instant l'utilisateur doit comparer mentalement Total réalisé vs Encart "Heures prévues dans le devis".
- Le calcul du Total devis dans Planning **ne tient pas compte des reports de chantier** : si un chantier est reporté d'un mois sur l'autre, les heures sont déplacées mais le total reste correct (somme tous mois confondus).

---

## Bonnes pratiques de développement (rappel)

- DevTools ouverts (F12) avec **"Disable cache"** coché dans Network
- Ctrl+Shift+R après chaque push pour forcer le rechargement
- Sur téléphone : fermer complètement Chrome/Safari et le rouvrir après push, ou désinstaller/réinstaller l'app PWA si déjà installée
- Mode incognito pour valider sur session neuve
- Workflow GitHub Desktop : modifier → Commit to main → **ne pas oublier Push origin** → Railway redéploie en 1-2 min
- Vérification du déploiement Railway : onglet Deployments → dernier commit avec statut "Success"

Raccourci de purge complète en cas de doute :

```js
localStorage.clear();
sessionStorage.clear();
navigator.serviceWorker?.getRegistrations().then(r => r.forEach(x => x.unregister()));
caches?.keys().then(k => k.forEach(c => caches.delete(c)));
location.reload(true);
```
