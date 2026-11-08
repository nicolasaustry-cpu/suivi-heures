// ─────────────────────────────────────────────────────────────
// cerfa/cerfa13408.js — CERFA 13408*14
// Déclaration attestant l'achèvement et la conformité des travaux (DAACT)
// ─────────────────────────────────────────────────────────────
// PDF officiel remplissable (cerfa_13408-14.pdf). Le déclarant est le
// bénéficiaire de l'autorisation (le client) : sa signature N'EST PAS apposée
// automatiquement, il signe lui-même la déclaration avant de la déposer.
// ─────────────────────────────────────────────────────────────

import { T, Z, C, R, jjmmaaaa, nomClient, estSociete, cpVille } from "./outils.js";

export const CODE = "13408";
export const TITRE = "CERFA 13408*14 — Déclaration d'achèvement et de conformité des travaux (DAACT)";
export const FICHIER = "cerfa_13408-14.pdf";
export const COCHE_VECTORIELLE = true;

const DATE = { court: true, peigne: 8, aide: "JJ/MM/AAAA" };

export const SECTIONS = [
  { titre: "1. Autorisation d'urbanisme", champs: [
    R("typeAutorisation", "Type d'autorisation", [["pc", "Permis de construire"], ["pa", "Permis d'aménager"], ["dp", "Déclaration préalable"]],
      { cases: { pc: "J2Q_PC", pa: "J2P_PA", dp: "J2D_DP" } }),
    T("J2A_numero", "N° du permis de construire", { peigne: 15 }),
    T("J2R_numPA", "N° du permis d'aménager", { peigne: 15 }),
    T("J2E_numDP", "N° de la déclaration préalable", { peigne: 15 }),
    R("voiriesDifferees", "Aménagement avec finition des voiries différée", [["oui", "Oui"], ["non", "Non"]],
      { cases: { oui: "J2Y_oui", non: "J2N_non" } }),
    T("J2C_date", "Si oui, date de finition des voiries", DATE)
  ] },
  { titre: "2. Déclarant (titulaire de l'autorisation)", aide: "Particulier : nom et prénom. Personne morale : dénomination, SIRET et représentant.", champs: [
    T("D1N_nom", "Particulier : nom"),
    T("D1P_prenom", "Particulier : prénom"),
    T("D2D_denomination", "Personne morale : dénomination"),
    T("D2R_raison", "Raison sociale"),
    T("D2S_siret", "N° SIRET", { court: true, peigne: 14 }),
    T("D2J_type", "Type de société (SA, SCI…)", { court: true }),
    T("D2N_nom", "Représentant : nom"),
    T("D2P_prenom", "Représentant : prénom")
  ] },
  { titre: "3. Coordonnées du demandeur", aide: "À remplir uniquement en cas de changement de coordonnées du titulaire de l'autorisation.", champs: [
    T("D3N_numero", "Numéro", { court: true }),
    T("D3V_voie", "Voie"),
    T("D3W_lieudit", "Lieu-dit"),
    T("D3L_localite", "Localité"),
    T("D3C_code", "Code postal", { court: true, peigne: 5 }),
    T("D5GE1_email", "Adresse électronique (avant @)"),
    T("D5GE2_email", "Adresse électronique (après @)"),
    C("D5A_acceptation", "Accepte de recevoir les réponses de l'administration par voie électronique")
  ] },
  { titre: "4. Achèvement des travaux", champs: [
    T("C9A_acheve", "Chantier achevé le", DATE),
    T("C9D_destination", "Changement de destination effectué le", DATE),
    R("etendue", "Achèvement", [["total", "Pour la totalité des travaux"], ["tranche", "Pour une tranche des travaux"]],
      { cases: { total: "C9T_totaltravaux", tranche: "C9P_tranchetravaux" } }),
    Z("C9C_precisacheve", "Tranche : aménagements ou constructions achevés"),
    T("W1SB1", "Surface de plancher créée (m²)", { court: true }),
    T("C5ZA1_logements", "Nombre de logements terminés", { court: true, peigne: 3 }),
    T("C5ZA2_individuels", "dont individuels", { court: true }),
    T("C5ZA3_collectifs", "dont collectifs", { court: true }),
    T("C5ZC1_nombreLLS", "Logement locatif social", { court: true, peigne: 3 }),
    T("C5ZC2_nombreAS", "Accession sociale (hors PTZ)", { court: true, peigne: 3 }),
    T("C5ZC3_nombrePTZ", "Prêt à taux zéro", { court: true, peigne: 3 }),
    T("C5ZC5_nombreautres", "Autres financements", { court: true, peigne: 3 })
  ] },
  { titre: "Attestation et signatures", aide: "Le déclarant (client) signe lui-même la déclaration. L'architecte signe s'il a dirigé les travaux.", champs: [
    T("E1L_lieu", "Déclarant : fait à"),
    T("E1D_date", "Déclarant : fait le", DATE),
    T("E4G_lieuarchi", "Architecte : fait à"),
    T("E4D_datearcchi", "Architecte : fait le", DATE)
  ] },
  { titre: "Pièces jointes à la déclaration", aide: "Cocher les attestations jointes selon le projet.", champs: [
    C("P9AT2", "AT.1 — Attestation accessibilité"),
    C("P9AU2", "AT.2 — Attestation règles parasismiques"),
    C("P9AU3", "AT.2-1 — Attestation retrait-gonflement des sols argileux"),
    C("P9AV1", "AT.3 — Attestation réglementation thermique"),
    C("P9AV2", "AT.3-1 — Attestation performance énergétique et environnementale (RE2020)"),
    C("P9AX1", "AT.4 — Attestation de prise en compte de la réglementation thermique"),
    C("P9AZ1", "AT.5 — Attestation acoustique"),
    C("P9AY1", "AT.6 — Garantie d'achèvement (lotissement par tranche)")
  ] }
];

/* Saisie sur MOBILE : l'essentiel constaté en fin de chantier. */
export const MOBILE = [
  { titre: "Autorisation d'urbanisme", aide: "N° figurant sur l'arrêté de permis ou la non-opposition à déclaration préalable, s'il est connu.", champs: [
    R("typeAutorisation", "Type", [["pc", "Permis de construire"], ["dp", "Déclaration préalable"], ["pa", "Permis d'aménager"]]),
    T("J2A_numero", "N° du permis de construire"),
    T("J2E_numDP", "N° de la déclaration préalable")
  ] },
  { titre: "Achèvement", champs: [
    R("etendue", "Achèvement", [["total", "Totalité des travaux"], ["tranche", "Une tranche"]]),
    T("C9C_precisacheve", "Tranche : ce qui est achevé"),
    T("W1SB1", "Surface de plancher créée (m²)")
  ] },
  { titre: "Attestations à joindre", champs: [
    C("P9AV2", "RE2020 (performance énergétique et environnementale)"),
    C("P9AT2", "Accessibilité"),
    C("P9AU2", "Parasismique"),
    C("P9AZ1", "Acoustique")
  ] }
];

/* Pas de signature apposée automatiquement : le déclarant signe lui-même. */
export const SIGNATURES = {};

/* Valeurs proposées. ctx = { bon, champs, equipement, coord, entreprise, reglages } */
export function preremplir(ctx) {
  const { bon, coord = {} } = ctx;
  const v = {};
  const client = nomClient(bon.chantier);
  if (estSociete(client)) v.D2D_denomination = client;
  else v.D1N_nom = client;
  v.typeAutorisation = "pc";
  v.etendue = "total";
  const date = jjmmaaaa(bon.dateIntervention);
  v.C9A_acheve = date;
  v.E1D_date = date;
  v.E1L_lieu = cpVille(coord).ville;
  return v;
}
