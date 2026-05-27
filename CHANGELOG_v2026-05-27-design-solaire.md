# Suiv'Heures — Journal des modifications

## Version du 27 mai 2026 — Design Solaire

État : déployée en production sur `suivi-heures.volitis.net`, fonctionnelle et testée.

Cette version introduit un **nouveau design "Solaire"** pour la saisie mobile, conçu pour améliorer l'expérience des ouvriers sur chantier (lisibilité en plein soleil, gros boutons tactiles, couleurs chaudes et accessibles).

---

## Nouveau design Solaire — Saisie mobile

### Périmètre

Le design Solaire s'applique **uniquement à l'application mobile** (page `saisie.html`) : écran PIN d'identification, écran de saisie journalière, modales (ajout chantier, instructions installation iOS), bandeau d'installation PWA.

Les **pages patron** (Entreprise, Salariés, Prévisionnel, Planning, Rapports, Planning réalisé) conservent leur identité graphique **bleue Volitis** existante.

Le **logo Volitis bleu** présent sur le header desktop de saisie mobile (PC uniquement) est également conservé.

### Palette Solaire

- **Orange principal** `#f97316` — header, bouton "Ajouter un chantier", accents
- **Orange foncé** `#c2410c` — titres, nom du salarié, valeurs importantes
- **Brun** `#92400e` — labels, textes secondaires
- **Crème** `#fffaf0` — fond général chaleureux
- **Jaune ambré** `#fef3c7` / `#fde68a` — inputs d'heure (très lisibles au soleil), carte totale
- **Vert** `#16a34a` / `#15803d` — confirmations, boutons OK validés

### Composants redessinés

**Écran PIN d'identification** : dégradé orange chaud (`#f97316` → `#ea580c`), boutons numériques agrandis (font-size 1.5rem), points PIN en jaune crème, sélecteur de salarié en blanc avec texte orange foncé.

**Header saisie journalière** : bandeau orange plein, boutons Sortir / Déconnexion en fond translucide blanc.

**Bandeau salarié + date** : fond blanc, nom du salarié en orange foncé, date du jour en brun, séparateur orange pâle, input date en fond crème encadré orange.

**Sections (Chantiers prévus / Ajoutés)** : cartes blanches arrondies (16px), bordure orange pâle, ombre douce orange, titre en majuscules orange foncé.

**Cartes de chantier** : coins arrondis 14px, bordure orange pâle 1.5px, nom du chantier en orange foncé pour les prévus / gris foncé pour les libres, badges "✔ Enregistré" en vert et "Prévu" en orange pâle.

**Stepper déplacement** :
- Label "🚚 Déplacement depuis chantier précédent" sur sa propre ligne (passage à la ligne autorisé si trop long)
- Boutons − et + en ronds parfaits (50% radius) orange pêche
- Valeur centrale en orange foncé, taille 1.1rem, gras
- Unité "min" à droite du bouton + (intégrée au stepper)

**Inputs d'heure** : fond jaune ambré (`#fef3c7`), bordure jaune dorée (`#fde68a`), texte ambré (`#92400e`) en gras 1.2rem, padding généreux pour faciliter le tap. Focus → bordure orange, fond blanc.

**Boutons OK validation heure** :
- État initial : **orange** (`#f97316`) avec ombre orange
- État validé (après clic OK) : **vert** (`#16a34a`) avec ombre verte
- Effet de scale 0.95 au tap

**Bouton "Envoyer ce chantier"** : orange par défaut, disparaît après envoi au profit d'un bandeau vert "✔ Chantier enregistré" (logique existante préservée).

**Bouton "+ Ajouter un chantier"** : fond blanc, bordure tiretée orange 2px, texte orange.

**Carte "Total du jour"** : fond jaune ambré, bordure jaune dorée 2px, valeur en orange foncé taille 1.4rem gras.

**Modale "Ajouter un chantier"** : titre orange foncé, suggestions en cartes arrondies bordure orange, input libre en fond crème, bouton OK orange.

**Modale "Installer sur iPhone"** : titre orange foncé, étapes avec mini-badges crème, bouton "J'ai compris" orange.

**Bandeau installation PWA** : dégradé orange (`#ea580c` → `#f97316`), bouton "Installer" en blanc avec texte orange foncé.

---

## Améliorations UX

### Aperçu téléphone sur PC

Le téléphone d'aperçu côté PC (utile pour la formation et la démonstration côté patron) avait un problème de débordement : les éléments étaient affichés à taille mobile dans un cadre de 300×600 px, ce qui causait des coupures de texte et un rendu peu fidèle.

**Correctif** : le cadre est désormais un **vrai écran mobile de 390×779 px** réduit visuellement à 77% (donc affiché à ~300×600 px). Tous les éléments internes gardent leurs proportions réelles, et le rendu visuel sur PC est strictement fidèle à ce que voient les ouvriers sur leur téléphone.

### Stepper de déplacement

Le label "🚚 Déplacement depuis chantier précédent" était précédemment sur la même ligne que les boutons − / + / min, ce qui posait deux problèmes : tronquage du texte sur écrans étroits, et "min" qui pouvait être affiché sur la mauvaise ligne.

**Correctif** :
- Label sur une ligne complète au-dessus, passage à la ligne autorisé si nécessaire
- Stepper (− valeur + min) centré sur sa propre ligne
- "min" intégré dans le stepper (à droite du bouton +), modification dans le HTML JS (`saisie.html` à 2 endroits : chantiers prévus et chantiers ajoutés)

### Feedback visuel des validations

Avant le design Solaire, les boutons OK étaient verts dès le départ, ce qui ne donnait aucun retour visuel après un clic. Le mécanisme `.valide` existait dans le code mais sans contraste suffisant.

**Maintenant** :
- Bouton **OK orange** par défaut (action à faire)
- Bouton **OK vert** une fois validé (action confirmée)
- Contraste fort orange → vert, lisible d'un coup d'œil

---

## Fichiers modifiés

- `public/saisie.html` :
  - Bloc CSS "Solaire" ajouté à la fin du `<style>` (surcharge non destructive — facile à retirer si besoin)
  - HTML JS du stepper déplacement modifié à 2 endroits (déplacement du `<span class="step-unite">` dans le `<div class="stepper">`)
  - CSS `.phone-wrap` adapté pour scale 0.77 sur PC (taille mobile réelle 390×779 réduite à 300×600 visuel)

---

## État stable retenu

Cette version constitue un point de référence stable. Pour revenir à cette version en cas de régression future, consulter l'historique des commits GitHub à la date de ce CHANGELOG.

Un tag Git dédié peut être créé depuis GitHub Desktop (onglet History → clic droit sur le dernier commit déployé → "Create tag" → nom suggéré : `v1.2-design-solaire-2026-05-27`).

---

## Limites connues

- Le design Solaire est **uniquement appliqué côté saisie mobile**. Si vos clients souhaitent voir une cohérence visuelle entre mobile et bureau (par exemple un patron qui veut une app entièrement à son image orange), il faudrait étendre la palette aux autres pages — décision à prendre en fonction des retours utilisateurs.
- L'aperçu téléphone sur PC utilise `transform: scale(0.77)` ce qui peut légèrement adoucir le rendu visuel (rendu sub-pixel). Sur mobile réel, ce scale n'est pas appliqué — rendu net.
- Les anciens utilisateurs habitués au design bleu pourraient avoir un temps d'adaptation. Pas de bouton "revenir à l'ancien design" — décision : on assume le changement comme une amélioration définitive.

---

## Bonnes pratiques de développement (rappel)

- DevTools ouverts (F12) avec **"Disable cache"** coché dans Network
- Ctrl+Shift+R après chaque push pour forcer le rechargement
- Sur téléphone : fermer complètement Chrome/Safari et le rouvrir après push, ou désinstaller / réinstaller l'app PWA si déjà installée
- Mode incognito (Ctrl+Maj+N) pour valider sur session neuve
- Workflow GitHub Desktop : modifier → Commit to main → **ne pas oublier Push origin** → Railway redéploie en 1-2 min

Raccourci de purge complète en cas de doute :

```js
localStorage.clear();
sessionStorage.clear();
navigator.serviceWorker?.getRegistrations().then(r => r.forEach(x => x.unregister()));
caches?.keys().then(k => k.forEach(c => caches.delete(c)));
location.reload(true);
```
