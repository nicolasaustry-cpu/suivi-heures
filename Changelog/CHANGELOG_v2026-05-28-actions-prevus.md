# Suiv'Heures — Journal des modifications

## Version du 28 mai 2026 (correction) — Actions sur chantiers prévus

État : déployée en production sur `suivi-heures.volitis.net`, fonctionnelle et testée.

Petite correction d'ergonomie sur le Planning Réalisé.

---

## Correction

### Planning Réalisé — Boutons d'action sur les chantiers "(prévu)"

**Problème** : Sur la page Planning Réalisé, les lignes correspondant à des chantiers initialement issus du **planning prévisionnel** (étiquetés "(prévu)") ne disposaient pas des boutons d'action — alors que les chantiers ajoutés librement par le salarié en avaient.

Conséquence : impossible pour le patron de modifier ou de supprimer ces lignes depuis le Planning Réalisé, ce qui obligeait à des allers-retours vers d'autres pages pour corriger une saisie.

**Correctif** : la condition qui masquait les boutons sur les chantiers `isPrevisionnel = true` a été supprimée. Désormais **tous les chantiers** (prévus ou libres) affichent leurs boutons d'édition (crayon jaune) et de suppression (poubelle rouge) dans la colonne Actions.

L'étiquette "(prévu)" en bleu à côté du nom du chantier est conservée, pour garder la traçabilité visuelle de l'origine de la saisie (vient du prévisionnel ou pas).

---

## Fichier modifié

- `public/realise.html` : condition `c.isPrevisionnel` retirée du calcul de `actions`. Une seule ligne de logique simplifiée.

---

## État stable retenu

Tag Git suggéré : `v1.5.1-actions-prevus-2026-05-28` (correction mineure sur la version 1.5).

---

## Récapitulatif des versions

1. `v1.0-stable-2026-05-26` — Version initiale
2. `v1.1-stable-2026-05-26` — Multi-mois + exports
3. `v1.2-design-solaire-2026-05-27` — Refonte design mobile
4. `v1.3-suivi-devis-2026-05-27` — Suivi des devis
5. `v1.4-pauses-resilience-2026-05-28` — Pauses + résilience
6. `v1.5-pwa-previsionnel-2026-05-28` — PWA + Prévisionnel
7. `v1.5.1-actions-prevus-2026-05-28` — **Cette version** : correction boutons actions
