// ─────────────────────────────────────────────────────────────
// cerfa/cerfa15497.js — CERFA 15497*04
// Fiche d'intervention fluides frigorigènes (art. R. 543-82 du code de l'environnement)
// ─────────────────────────────────────────────────────────────
// - SECTIONS : champs affichés dans la fenêtre de saisie (PC), chacun relié à
//   un champ du PDF officiel (nom AcroForm exact).
// - preremplir(ctx) : valeurs proposées à partir du bon, de l'équipement, du
//   client, de l'entreprise et des réglages CERFA mémorisés.
// - signatures : où apposer les signatures du bon sur le formulaire.
// ─────────────────────────────────────────────────────────────

export const CODE = "15497";
export const TITRE = "CERFA 15497*04 — Fiche d'intervention fluides frigorigènes";
export const FICHIER = "cerfa_15497-04.pdf";

const T = (pdf, label, extra = {}) => ({ pdf, label, type: "texte", ...extra });
const Z = (pdf, label, extra = {}) => ({ pdf, label, type: "zone", ...extra });
const C = (pdf, label, extra = {}) => ({ pdf, label, type: "case", ...extra });

export const SECTIONS = [
  { titre: "Fiche", champs: [T("Fiche_no", "Fiche n°", { court: true })] },
  { titre: "[1] Opérateur", champs: [
    Z("Operateur", "Nom, adresse et SIRET de l'entreprise", { memo: "operateur" }),
    T("Attestation_no", "N° d'attestation de capacité", { memo: "attestation" })
  ] },
  { titre: "[2] Détenteur", champs: [Z("Detenteur", "Nom, adresse et SIRET du client")] },
  { titre: "[3] Équipement concerné", champs: [
    Z("Equipement_ID", "Identification"),
    T("Equipement_Fluide", "Dénomination du fluide (sans « R- »)", { court: true }),
    T("Equipement_Charge", "Charge totale (kg)", { court: true }),
    T("Equipement_teqCO2", "Tonnage équivalent CO2 (t.éq.CO2)", { court: true, aide: "Calculé d'après le fluide et la charge quand le fluide est connu." })
  ] },
  { titre: "[4] Nature de l'intervention", champs: [
    C("Case_Assemblage", "Assemblage de l'équipement"),
    C("Case_MiseService", "Mise en service de l'équipement"),
    C("Case_Modif", "Modification de l'équipement"),
    C("Case_Maintenance", "Maintenance de l'équipement"),
    C("Case_CtrlPerio", "Contrôle d'étanchéité périodique"),
    C("Case_CtrlNonPerio", "Contrôle d'étanchéité non périodique"),
    C("Case_Demantel", "Démantèlement"),
    C("Case_Autre", "Autre"),
    T("Autre", "Autre (préciser)")
  ] },
  { titre: "[5] [6] Contrôle d'étanchéité", champs: [
    T("Detecteur_ID", "Détecteur manuel de fuite : identification", { memo: "detecteur" }),
    T("Controle_Jour", "Contrôlé le : jour", { court: true }),
    T("Controle_Mois", "mois", { court: true }),
    T("Controle_Annee", "année", { court: true }),
    { pdf: "Bouton_Oui", label: "Système permanent de détection de fuites", type: "radio", options: [["1", "Oui"], ["2", "Non"]] }
  ] },
  { titre: "[7] Quantité de fluide dans l'équipement", aide: "Cochée automatiquement d'après le fluide et la charge, à vérifier.", champs: [
    C("Case_HCFC_2", "HCFC : 2 kg ≤ Q < 30 kg"), C("Case_HCFC_30", "HCFC : 30 kg ≤ Q < 300 kg"), C("Case_HCFC_300", "HCFC : Q ≥ 300 kg"),
    C("Case_HFC_5", "HFC/PFC : 5 t ≤ teqCO2 < 50 t"), C("Case_HFC_50", "HFC/PFC : 50 t ≤ teqCO2 < 500 t"), C("Case_HFC_500", "HFC/PFC : teqCO2 ≥ 500 t"),
    C("Case_HFO_1", "HFO : 1 kg ≤ Q < 10 kg"), C("Case_HFO_10", "HFO : 10 kg ≤ Q < 100 kg"), C("Case_HFO_100", "HFO : Q ≥ 100 kg")
  ] },
  { titre: "[8] [9] Fréquence minimale du contrôle périodique", champs: [
    C("Case_Sans_12m", "Sans détection permanente : 12 mois"), C("Case_Sans_6m", "Sans détection permanente : 6 mois"), C("Case_Sans_3m", "Sans détection permanente : 3 mois"),
    C("Case_Avec_24m", "Avec détection permanente : 24 mois"), C("Case_Avec_12m", "Avec détection permanente : 12 mois"), C("Case_Avec_6m", "Avec détection permanente : 6 mois")
  ] },
  { titre: "[10] Fuites constatées lors du contrôle", champs: [
    C("Case_Fuite_Oui", "Fuites constatées : OUI"), C("Case_Fuite_Non", "Fuites constatées : NON"),
    T("Fuite_Loca_1", "Fuite 1 : localisation"), C("Case_Rep_Fuite1_realisee", "Fuite 1 : réparation réalisée"), C("Case_Rep_Fuite1_AFaire", "Fuite 1 : réparation à faire"),
    T("Fuite_Loca_2", "Fuite 2 : localisation"), C("Case_Rep_Fuite2_realisee", "Fuite 2 : réparation réalisée"), C("Case_Rep_Fuite2_AFaire", "Fuite 2 : réparation à faire"),
    T("Fuite_Loca_3", "Fuite 3 : localisation"), C("Case_Rep_Fuite3_realisee", "Fuite 3 : réparation réalisée"), C("Case_Rep_Fuite3_AFaire", "Fuite 3 : réparation à faire")
  ] },
  { titre: "[11] Manipulation du fluide frigorigène (kg)", aide: "Les totaux A+B+C et D+E se calculent seuls.", champs: [
    T("11_QA", "A - Dont fluide vierge", { court: true }),
    T("11_QB", "B - Dont fluide recyclé", { court: true }),
    T("11_QC", "C - Dont fluide régénéré", { court: true }),
    T("11_Quantite", "Quantité chargée totale (A+B+C)", { court: true, calcule: true }),
    T("11_Denom", "Dénomination du fluide chargé si changement", { court: true }),
    T("11_QD", "D - Dont fluide destiné au traitement", { court: true }),
    T("11_QE", "E - Dont fluide conservé pour réutilisation", { court: true }),
    T("11_QDE", "Quantité récupérée totale (D+E)", { court: true, calcule: true }),
    T("11_BSFF", "N° du BSFF (Trackdéchets), si connu"),
    T("11_Contenant_ID", "Identification du ou des contenants")
  ] },
  { titre: "[12] Dénomination ADR/RID (fluide récupéré)", champs: [
    C("Case_12_UN1078", "14 06 01* — UN 1078 — fluides non inflammables"),
    C("Case_12_Autre140601", "Autres fluides non inflammables"), T("Autre-FF-NON-inflammable", "Préciser (non inflammable)"),
    C("Case_12_UN3161", "16 05 04* — UN 3161 — fluides inflammables"),
    C("Case_12_Autre160504", "Autres fluides inflammables"), T("Autre-FF-inflammable", "Préciser (inflammable)")
  ] },
  { titre: "[13] Installation de destination du fluide récupéré", champs: [
    Z("13_Instal", "Nom, SIRET, adresse", { memo: "installation" })
  ] },
  { titre: "[14] Observations", champs: [Z("14_Observations", "Observations")] },
  { titre: "Signatures", aide: "Les signatures du bon (technicien et client) sont apposées automatiquement.", champs: [
    T("Sign_Operateur_Nom", "Opérateur : nom du signataire"),
    T("Sign_Operateur_Qualite", "Opérateur : qualité", { memo: "qualiteOperateur" }),
    T("Sign_Operateur_Date", "Opérateur : date", { court: true }),
    T("Sign_Detenteur_Nom", "Détenteur : nom du signataire"),
    T("Sign_Detenteur_Qualite", "Détenteur : qualité"),
    T("Sign_Detenteur_Date", "Détenteur : date", { court: true })
  ] }
];

/* Zones où apposer les images de signature du bon (coordonnées PDF, page 1). */
export const SIGNATURES = {
  operateur: { x: 232, y: 41, w: 104, h: 24 },
  detenteur: { x: 450, y: 40, w: 104, h: 24 }
};

// ── Fluides : PRG (potentiel de réchauffement global, AR4 — règlement F-Gas)
//    et famille, pour le tonnage équivalent CO2 et les cases [7] [8] [9] [12].
const FLUIDES = {
  "32":    { prg: 675,  famille: "HFC",  inflammable: true },
  "410A":  { prg: 2088, famille: "HFC",  inflammable: false },
  "407C":  { prg: 1774, famille: "HFC",  inflammable: false },
  "404A":  { prg: 3922, famille: "HFC",  inflammable: false },
  "134A":  { prg: 1430, famille: "HFC",  inflammable: false },
  "407A":  { prg: 2107, famille: "HFC",  inflammable: false },
  "407F":  { prg: 1825, famille: "HFC",  inflammable: false },
  "422D":  { prg: 2729, famille: "HFC",  inflammable: false },
  "448A":  { prg: 1387, famille: "HFC",  inflammable: false },
  "449A":  { prg: 1397, famille: "HFC",  inflammable: false },
  "452A":  { prg: 2140, famille: "HFC",  inflammable: false },
  "513A":  { prg: 631,  famille: "HFC",  inflammable: false },
  "454B":  { prg: 466,  famille: "HFC",  inflammable: true },
  "454C":  { prg: 148,  famille: "HFC",  inflammable: true },
  "1234YF":{ prg: 4,    famille: "HFO",  inflammable: true },
  "1234ZE":{ prg: 7,    famille: "HFO",  inflammable: true },
  "22":    { prg: 1810, famille: "HCFC", inflammable: false }
};
export function infoFluide(nom) {
  const k = String(nom || "").toUpperCase().replace(/^R\s*-?\s*/, "").replace(/\s+/g, "");
  return FLUIDES[k] ? { code: k, ...FLUIDES[k] } : null;
}

const fr = n => String(Math.round(n * 1000) / 1000).replace(".", ",");
const num = v => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const jjmmaaaa = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };

/* Valeurs proposées. ctx = { bon, champs, equipement, coord, entreprise, reglages } */
export function preremplir(ctx) {
  const { bon, champs = [], coord = {}, entreprise = {}, reglages = {} } = ctx;
  const eq = ctx.equipement || bon.equipement || {};
  const rep = bon.reponses || {};
  const v = {};

  v.Fiche_no = bon.numero || "";
  v.Operateur = reglages.operateur || entreprise.nom || "";
  v.Attestation_no = reglages.attestation || "";
  v.Detenteur = [bon.chantier, coord.adresse, coord.ville].filter(Boolean).join("\n");

  v.Equipement_ID = [
    [eq.type, eq.marque].filter(Boolean).join(" "),
    eq.modele, eq.numeroSerie ? "N° série " + eq.numeroSerie : "", eq.emplacement
  ].filter(Boolean).join(" — ");
  const fl = infoFluide(eq.fluide);
  v.Equipement_Fluide = String(eq.fluide || "").replace(/^R\s*-?\s*/i, "");
  const charge = num(eq.chargeKg);
  if (charge != null) v.Equipement_Charge = fr(charge);
  const teq = fl && charge != null ? charge * fl.prg / 1000 : null;
  if (teq != null) v.Equipement_teqCO2 = fr(teq);

  // [4] Nature : d'après le texte du bon (type d'activité, rapport…)
  const texte = Object.values(rep).filter(x => typeof x === "string" && !x.startsWith("data:")).join(" ").toLowerCase();
  if (/mise en service/.test(texte)) v.Case_MiseService = true;
  if (/contr[ôo]le d.?[ée]tanch/.test(texte)) v.Case_CtrlPerio = true;
  if (/d[ée]pannage|entretien|maintenance|r[ée]paration/.test(texte)) v.Case_Maintenance = true;
  if (/d[ée]mant[eè]lement|d[ée]pose/.test(texte)) v.Case_Demantel = true;
  if (v.Case_CtrlPerio) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(bon.dateIntervention || "");
    if (m) { v.Controle_Jour = m[3]; v.Controle_Mois = m[2]; v.Controle_Annee = m[1]; }
  }
  v.Detecteur_ID = reglages.detecteur || "";

  // [7] [8] Seuils d'après le fluide et la charge (sans détection permanente par défaut)
  if (fl && charge != null) {
    v.Bouton_Oui = "2";
    if (fl.famille === "HFC" && teq != null) {
      if (teq >= 500) { v.Case_HFC_500 = true; v.Case_Sans_3m = true; }
      else if (teq >= 50) { v.Case_HFC_50 = true; v.Case_Sans_6m = true; }
      else if (teq >= 5) { v.Case_HFC_5 = true; v.Case_Sans_12m = true; }
    } else if (fl.famille === "HFO") {
      if (charge >= 100) { v.Case_HFO_100 = true; v.Case_Sans_3m = true; }
      else if (charge >= 10) { v.Case_HFO_10 = true; v.Case_Sans_6m = true; }
      else if (charge >= 1) { v.Case_HFO_1 = true; v.Case_Sans_12m = true; }
    } else if (fl.famille === "HCFC") {
      if (charge >= 300) { v.Case_HCFC_300 = true; v.Case_Sans_3m = true; }
      else if (charge >= 30) { v.Case_HCFC_30 = true; v.Case_Sans_6m = true; }
      else if (charge >= 2) { v.Case_HCFC_2 = true; v.Case_Sans_12m = true; }
    }
  }

  v["13_Instal"] = reglages.installation || "";

  // [14] Observations : le premier champ texte « rapport / observations » du bon
  const champObs = champs.find(c => c.type === "texte" && /rapport|observ|compte.?rendu/i.test(c.libelle || ""));
  if (champObs && rep[champObs.id]) v["14_Observations"] = String(rep[champObs.id]).replace(/\s*\n+\s*/g, " ").slice(0, 900);

  // Signatures
  const signClient = champs.find(c => c.type === "signature" && c.signataire === "client");
  const dateFr = jjmmaaaa(bon.dateIntervention);
  v.Sign_Operateur_Nom = bon.salarieNom || "";
  v.Sign_Operateur_Qualite = reglages.qualiteOperateur || "Technicien";
  v.Sign_Operateur_Date = dateFr;
  v.Sign_Detenteur_Nom = signClient ? (rep[signClient.id + "__nom"] || "") : "";
  v.Sign_Detenteur_Qualite = "";
  v.Sign_Detenteur_Date = dateFr;
  return v;
}

/* Calculs avant impression : totaux A+B+C et D+E. */
export function completer(v) {
  const out = { ...v };
  const s = (...k) => k.map(x => num(out[x])).filter(n => n != null);
  const abc = s("11_QA", "11_QB", "11_QC"), de = s("11_QD", "11_QE");
  if (abc.length && !String(out["11_Quantite"] || "").trim()) out["11_Quantite"] = fr(abc.reduce((a, b) => a + b, 0));
  if (de.length && !String(out["11_QDE"] || "").trim()) out["11_QDE"] = fr(de.reduce((a, b) => a + b, 0));
  return out;
}
