// ─────────────────────────────────────────────────────────────
// cerfa/cerfa16026.js — CERFA 16026*02
// Certificat de conformité d'une installation individuelle de gaz — modèle 2 (CC2)
// ─────────────────────────────────────────────────────────────
// Le PDF officiel (cerfa_16026-02.pdf) n'a pas de champs remplissables :
// le texte est écrit aux positions du formulaire (MODE "superpose").
// pos.y = ligne de base mesurée depuis le HAUT de la page (A4 : 595 x 842 pt).
// Le n° de certificat et le visa sont réservés à l'organisme de contrôle.
// ─────────────────────────────────────────────────────────────

import { T, Z, C, R, N, jjmmaaaa, nomClient, cpVille, blocEntreprise, signataireClient, libelleEq } from "./outils.js";

export const CODE = "16026";
export const TITRE = "CERFA 16026*02 — Certificat de conformité gaz, modèle 2 (CC2)";
export const FICHIER = "cerfa_16026-02.pdf";
export const MODE = "superpose";

const P = (x, y, w, extra = {}) => ({ page: 0, x, y, w, ...extra });
const BOX = (x, yCentre) => ({ page: 0, x, y: yCentre });

// ── Tableau « Description des travaux » : 4 lignes ──
const LIGNES = [474, 499, 524, 549];          // lignes de base (depuis le haut)
const TUYAU = [                                // [clé, libellé, x, largeur]
  ["mat", "Nature du matériau (6.1)", 17, 21],
  ["long", "Longueur (m)", 41, 21],
  ["diam", "Diamètre extérieur (mm)", 65, 22],
  ["press", "Pression de service (mbar)", 90, 23],
  ["ass", "Type d'assemblage (6.2)", 116, 24],
  ["acc", "Type d'accessoire (6.3)", 143, 26]
];
const sectionLigne = (i) => {
  const y = LIGNES[i], n = i + 1, yc = y - 2.5;
  return { titre: `Ligne ${n} du tableau`, aide: n === 1 ? "Codes de la notice : matériau CU, PE, PLT… ; assemblage BF, SERT, RM… ; accessoire OCA, OCG, RI… ; appareil CHAUD, CE, CUIS, POELE… ; type A, B ou C." : "", champs: [
    ...TUYAU.map(([k, lib, x, w]) => T(`t${n}_${k}`, `Tuyauterie : ${lib}`, { court: true, pos: P(x, y, w, { taille: 6.5, lignes: 2 }) })),
    T(`a${n}_app`, "Appareil (7.1)", { court: true, pos: P(172, y, 58, { taille: 6.5, lignes: 2 }) }),
    R(`a${n}_inst`, "Appareil installé par l'installateur (7.2)", [["oui", "Oui"], ["non", "Non"]],
      { posOptions: { oui: BOX(237.5, yc), non: BOX(254.5, yc) } }),
    T(`a${n}_type`, "Type d'appareil A / B / C (7.3)", { court: true, pos: P(273, y, 12, { taille: 7 }) }),
    T(`a${n}_puiss`, "Puissance (kW)", { court: true, pos: P(290, y, 28, { taille: 7 }) }),
    T(`a${n}_impl`, "Implantation (8)", { pos: P(322, y, 80, { taille: 6.5, lignes: 2 }) }),
    R(`a${n}_sys`, "Évacuation des produits de combustion : système (9)", [["indiv", "Individuel"], ["coll", "Collectif"]],
      { posOptions: { indiv: BOX(410, yc), coll: BOX(427.5, yc) } }),
    R(`a${n}_evac`, "Évacuation : type (9)", [["cf", "Conduit de fumée"], ["vmc", "VMC-Gaz"], ["csp", "Conduit sous pression"], ["autre", "Autres solutions"]],
      { posOptions: { cf: BOX(447.5, yc), vmc: BOX(470, yc), csp: BOX(493, yc), autre: BOX(515.5, yc) } }),
    C(`a${n}_amenee`, "Ventilation : amenée d'air (10)", { pos: BOX(539.5, yc) }),
    C(`a${n}_sortie`, "Ventilation : sortie d'air (10)", { pos: BOX(565, yc) })
  ] };
};

export const SECTIONS = [
  { titre: "En-tête", champs: [
    Z("destinataire", "Destinataire du certificat", { pos: P(20, 78, 172, { lignes: 3 }) }),
    Z("qualification", "Qualification de l'installateur (PG / PGI, n°…)", { memo: "qualifGaz", pos: P(212, 78, 192, { lignes: 3 }) })
  ] },
  { titre: "(2) Identification de l'installation de gaz", champs: [
    T("usager", "Usager / établissement", { pos: P(128, 142, 166) }),
    T("numero", "N° (ou lot / parcelle / réf. cadastrale)", { court: true, pos: P(228, 157, 66) }),
    T("rue", "Rue", { pos: P(45, 172, 249) }),
    T("complement", "Complément d'adresse", { pos: P(20, 188, 274) }),
    T("bat", "Bât.", { court: true, pos: P(39, 202, 55) }),
    T("esc", "Esc.", { court: true, pos: P(117, 202, 38) }),
    T("etage", "Ét.", { court: true, pos: P(171, 202, 32) }),
    T("lgt", "Lgt n°", { court: true, pos: P(243, 202, 50) }),
    T("cp", "Code postal", { court: true, pos: P(79, 219, 45) }),
    T("ville", "Ville", { pos: P(152, 219, 142) }),
    R("local", "Type de local", [["indiv", "Habitation individuelle"], ["coll", "Habitation collective"], ["erp", "ERP 5e catégorie <= 19 p."]],
      { posOptions: { indiv: BOX(19.6, 232.8), coll: BOX(123.8, 232.8), erp: BOX(215.6, 232.8) } }),
    R("batiment", "Bâtiment", [["neuf", "Bâtiment neuf"], ["existant", "Bâtiment existant"]],
      { posOptions: { neuf: BOX(19.6, 249.9), existant: BOX(92.3, 249.9) } })
  ] },
  { titre: "(3) Installateur", champs: [
    Z("installateur", "Identité et coordonnées de l'installateur (nom, adresse, SIRET)", { memo: "installateurGaz", pos: P(304, 138, 266, { taille: 8, lignes: 9 }) }),
    T("responsable", "Responsable gaz (Mme / M.)", { memo: "responsableGaz", pos: P(426, 254, 146) })
  ] },
  { titre: "(4) Mode d'alimentation en gaz", champs: [
    R("gaz", "Nature du gaz", [["naturel", "Gaz naturel"], ["propane", "Propane"], ["butane", "Butane"], ["autre", "Autre"]],
      { posOptions: { naturel: BOX(88.9, 298.8), propane: BOX(157.7, 298.8), butane: BOX(209.3, 298.8), autre: BOX(94, 310.8) } }),
    T("gazAutre", "Autre gaz (préciser)", { court: true, pos: P(140, 313, 152) }),
    T("distributeur", "Distributeur de gaz", { pos: P(110, 326, 183) }),
    T("pce", "N° d'identification de l'installation (PCE)", { court: true, pos: P(194, 338, 100) })
  ] },
  { titre: "(5) Nature des travaux ou opérations réalisés", champs: [
    C("trav_neuve", "Réalisation d'une installation neuve de gaz", { pos: BOX(301.5, 294.8) }),
    C("trav_modif", "Modification d'une installation de gaz existante", { pos: BOX(301.5, 306.8) }),
    C("trav_rempl", "Remplacement d'appareil(s)", { pos: BOX(301.5, 318.8) }),
    C("trav_secu", "Remise en sécurité suite à un accident ou une intoxication", { pos: BOX(301.5, 330.8) })
  ] },
  sectionLigne(0), sectionLigne(1), sectionLigne(2), sectionLigne(3),
  { titre: "(11) Autres opérations et (12) guides utilisés", champs: [
    C("op_verif", "Vérification de sécurité", { pos: BOX(131.4, 601.2) }),
    C("op_remise", "Remise en conformité de l'installation individuelle", { pos: BOX(212.5, 601.2) }),
    C("op_autres", "Autres actions", { pos: BOX(131.8, 609.8) }),
    T("op_autresTxt", "Autres actions (préciser)", { pos: P(200, 612, 372, { taille: 7 }) }),
    C("guide_cnpg", "Guides du CNPG", { pos: BOX(136.6, 629.8) }),
    C("guide_autres", "Autres guides", { pos: BOX(136.6, 641.8) }),
    T("guide_autresTxt", "Autres guides (éditeur, référence, édition)", { pos: P(352, 644, 220, { taille: 7 }) })
  ] },
  { titre: "Attestation de l'installateur", aide: "La signature du technicien saisie sur le bon est apposée automatiquement.", champs: [
    T("date", "Date", { court: true, pos: P(92, 740, 120) })
  ] }
];

/* Saisie sur MOBILE : ce que le technicien constate sur place (ligne 1 du tableau). */
export const MOBILE = [
  { titre: "Nature des travaux", champs: [
    C("trav_neuve", "Installation neuve"), C("trav_modif", "Modification de l'installation"),
    C("trav_rempl", "Remplacement d'appareil(s)"), C("trav_secu", "Remise en sécurité (accident / intoxication)")
  ] },
  { titre: "Installation", champs: [
    R("gaz", "Nature du gaz", [["naturel", "Naturel"], ["propane", "Propane"], ["butane", "Butane"], ["autre", "Autre"]]),
    R("local", "Local", [["indiv", "Hab. individuelle"], ["coll", "Hab. collective"], ["erp", "ERP 5e cat."]]),
    R("batiment", "Bâtiment", [["neuf", "Neuf"], ["existant", "Existant"]]),
    T("pce", "N° PCE (facture de gaz), si connu")
  ] },
  { titre: "Appareil", aide: "Repris de la fiche équipement s'il est connu.", champs: [
    T("a1_app", "Appareil (ex. CHAUD, CE, CUIS, POELE)"),
    R("a1_inst", "Installé par vous", [["oui", "Oui"], ["non", "Non"]]),
    R("a1_type", "Type", [["A", "A non raccordé"], ["B", "B raccordé"], ["C", "C étanche"]]),
    N("a1_puiss", "Puissance (kW)"),
    T("a1_impl", "Implantation (cuisine, cellier…)"),
    R("a1_sys", "Évacuation : système", [["indiv", "Individuel"], ["coll", "Collectif"]]),
    R("a1_evac", "Évacuation : type", [["cf", "Conduit de fumée"], ["vmc", "VMC-Gaz"], ["csp", "Sous pression"], ["autre", "Autre"]]),
    C("a1_amenee", "Amenée d'air vérifiée"), C("a1_sortie", "Sortie d'air vérifiée")
  ] },
  { titre: "Tuyauterie", champs: [
    T("t1_mat", "Matériau (CU, PE, PLT…)"), N("t1_long", "Longueur (m)"), N("t1_diam", "Diamètre ext. (mm)"),
    N("t1_press", "Pression (mbar)"), T("t1_ass", "Assemblage (BF, SERT, RM…)"), T("t1_acc", "Accessoire (OCA, OCG, RI…)")
  ] },
  { titre: "Autres opérations", champs: [
    C("op_verif", "Vérification de sécurité"), C("op_remise", "Remise en conformité"),
    C("guide_cnpg", "Travaux selon les guides du CNPG")
  ] }
];

/* Signature du technicien dans « Date et signature » de l'attestation. */
export const SIGNATURES = {
  operateur: { page: 0, x: 22, y: 54, w: 150, h: 40 }
};

/* Valeurs proposées. ctx = { bon, champs, equipement, coord, entreprise, reglages } */
export function preremplir(ctx) {
  const { bon, champs = [], coord = {}, entreprise = {}, reglages = {} } = ctx;
  const eq = ctx.equipement || bon.equipement || {};
  const v = {};
  const client = nomClient(bon.chantier);
  const { cp, ville, rue } = cpVille(coord);
  v.destinataire = [signataireClient(bon, champs) || client, rue, [cp, ville].filter(Boolean).join(" ")].filter(Boolean).join("\n");
  v.qualification = reglages.qualifGaz || "";
  v.usager = client;
  v.rue = rue;
  v.cp = cp;
  v.ville = ville;
  v.local = "indiv";
  v.batiment = "existant";
  v.installateur = reglages.installateurGaz || blocEntreprise(entreprise);
  v.responsable = reglages.responsableGaz || "";
  v.gaz = "naturel";
  v.guide_cnpg = true;
  // Appareil : d'après la fiche équipement
  const lib = libelleEq(eq);
  if (lib) { v.a1_app = lib; v.a1_impl = eq.emplacement || ""; }
  const texte = Object.values(bon.reponses || {}).filter(x => typeof x === "string" && !x.startsWith("data:")).join(" ").toLowerCase();
  if (/remplacement|remplac/.test(texte)) v.trav_rempl = true;
  else if (/mise en service|installation neuve|cr[ée]ation/.test(texte)) v.trav_neuve = true;
  v.date = jjmmaaaa(bon.dateIntervention);
  return v;
}
