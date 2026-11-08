// ─────────────────────────────────────────────────────────────
// cerfa/demarches.js — Démarche à suivre pour chaque CERFA
// ─────────────────────────────────────────────────────────────
// Affichée dans l'éditeur de masques, dans la fenêtre CERFA du bon (PC) et
// sur mobile, pour que l'entreprise sache ce qui reste à faire après le bon.
// Les textes des CERFA pas encore branchés sont prêts : ils s'afficheront dès
// que le module du CERFA sera inscrit dans cerfa/index.js.
// ─────────────────────────────────────────────────────────────

const CONSUEL = couleur => [
  `Commander l'attestation ${couleur} sur consuel.com (espace Consuel) : le formulaire acheté est valable 1 an.`,
  "La remplir en reprenant les éléments de ce CERFA pré-rempli, la signer et l'envoyer au Consuel avec le dossier technique demandé.",
  "Le Consuel vise l'attestation, sur dossier ou après visite d'un inspecteur.",
  "Remettre l'attestation visée au client : elle est exigée pour la mise en service par le fournisseur d'électricité.",
  "Important : le document produit par Suiv'Heures est une copie de préparation. Seule l'attestation portant le numéro et le visa du Consuel fait foi."
];

export const DEMARCHES = {
  "15497": [
    "Fiche établie par l'opérateur titulaire de l'attestation de capacité, signée par l'opérateur (technicien) et le détenteur (client).",
    "Chacun en conserve un exemplaire au moins 5 ans.",
    "Le fluide récupéré est suivi par un BSFF sur Trackdéchets (n° à reporter sur la fiche s'il est connu)."
  ],
  "12506": CONSUEL("jaune"),
  "12507": CONSUEL("verte"),
  "15523": CONSUEL("bleue"),
  "15524": CONSUEL("violette"),
  "16026": [
    "Le certificat de conformité modèle 2 (CC2) est établi par l'installateur à la fin des travaux.",
    "Entreprise « Professionnel du Gaz » (PGI) : elle le remplit et l'envoie à l'organisme de contrôle agréé auquel elle est rattachée, qui le vérifie.",
    "Entreprise non PGI : demander le contrôle à un organisme agréé (Qualigaz, Dekra, Copraudit…), qui délivre le certificat après vérification.",
    "Remettre le certificat au client : il est exigé pour la mise en service du gaz.",
    "Important : le document produit par Suiv'Heures sert à préparer le certificat ; seul le certificat validé par l'organisme agréé fait foi."
  ],
  "13408": [
    "La DAACT est signée par le bénéficiaire du permis de construire ou de la déclaration préalable, c'est-à-dire le client, et non par le technicien.",
    "L'entreprise la prépare à partir du bon ; le client la signe et la dépose en mairie (ou en ligne) à l'achèvement des travaux.",
    "Y joindre les attestations exigées selon le projet (réglementation environnementale RE2020, accessibilité, parasismique, acoustique…)."
  ]
};

export function demarche(code) {
  return DEMARCHES[String(code || "")] || [];
}
