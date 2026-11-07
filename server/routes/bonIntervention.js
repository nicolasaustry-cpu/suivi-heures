// ─────────────────────────────────────────────────────────────
// routes/bonIntervention.js — Bons d'intervention remplis (mobile)
// ─────────────────────────────────────────────────────────────
// Auth mobile uniquement (codeEmploye + salarieId), même schéma que
// routes/documents.js. Protégé par l'activation de la fonctionnalité
// (entreprise.bonsInterventionActifs), vérifiée côté serveur en plus
// du masquage du menu côté client.
//
// Endpoints (POST, l'auth passe par le corps) :
//   POST /api/bons-intervention/masques  { codeEmploye, salarieId }
//        → liste des masques ACTIFS du client (pour le choix sur mobile)
//   POST /api/bons-intervention          { codeEmploye, salarieId, chantier,
//                                           masqueId, dateIntervention, reponses }
//        → enregistre un bon rempli
//
// Côté bureau (PC, auth par token comme routes/masqueIntervention.js) :
//   GET    /api/bons-intervention/pc            → liste (sans photos/signatures)
//   GET    /api/bons-intervention/pc/:id        → bon complet + champs
//   GET    /api/bons-intervention/pc/:id/pdf    → PDF du bon
//   POST   /api/bons-intervention/pc/:id/envoyer { a, copie, message } → e-mail + PDF joint
//   DELETE /api/bons-intervention/pc/:id        → supprimer un bon
//   POST   /api/bons-intervention/pc/exemple    → crée le masque + le bon d'exemple (rapport Organilog)
// ─────────────────────────────────────────────────────────────

import express from "express";
import Donnees from "../models/donnees.js";
import MasqueIntervention from "../models/masqueIntervention.js";
import BonIntervention, { prochainNumeroBon } from "../models/bonIntervention.js";
import Saisie from "../models/saisies.js";
import ReglageCerfa from "../models/reglageCerfa.js";
import { MODELES as CERFAS, listeModeles, assainirValeurs, remplirCerfa, assemblerPdf } from "../cerfa/index.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import Equipement, { cleClient, libelleEquipement } from "../models/equipement.js";
import { genererPdfBon } from "../services/pdfBon.js";
import { NOM_MASQUE_EXEMPLE, CHAMPS_EXEMPLE, BON_EXEMPLE } from "../data/exempleBonOrganilog.js";

const router = express.Router();

const U = s => String(s == null ? "" : s).trim().toUpperCase();

/* Résout le contexte mobile (codeEmploye + salarieId). Renvoie
   { clientId, entreprise, salarieId, salarieNom } ou { err: [code, message] }. */
export async function resoudreContexteMobile(req) {
  const codeEmp = U(req.body.codeEmploye);
  if (!codeEmp) return { err: [400, "Code employé manquant"] };

  const docs = await Donnees.find({});
  const correspondants = docs.filter(d => U(d.entreprise?.codeEmploye) === codeEmp);
  if (correspondants.length === 0) return { err: [403, "Code employé invalide"] };
  if (correspondants.length > 1) {
    console.error(`[ANTI-MÉLANGE] Code employé « ${codeEmp} » partagé par plusieurs entreprises. Accès refusé.`);
    return { err: [409, "Ce code employé est utilisé par plusieurs entreprises. Contactez votre administrateur."] };
  }
  const doc = correspondants[0];
  const sal = (doc.salaries || []).find(s => String(s.id) === String(req.body.salarieId));
  if (!sal) return { err: [401, "Salarié inconnu"] };

  if (!doc.entreprise?.bonsInterventionActifs) {
    return { err: [409, "Fonctionnalité non activée pour ce compte (page Entreprise)"], inactif: true };
  }

  return {
    clientId: U(doc.clientId),
    salarieId: String(req.body.salarieId),
    salarieNom: `${sal.prenom || ""} ${sal.nom || ""}`.trim()
  };
}

// ── Liste des masques actifs du client (pour le choix sur mobile) ──
router.post("/masques", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });

    const masques = await MasqueIntervention
      .find({ clientId: ctx.clientId, actif: true }, "nom champs cerfa")
      .sort({ nom: 1 });
    res.json({ ok: true, masques });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Partie CERFA à compléter sur mobile ──
router.post("/cerfa-mobile", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });
    const m = CERFAS[String(req.body.code || "")];
    if (!m || !m.MOBILE) return res.status(404).json({ ok: false, message: "CERFA inconnu" });
    const reg = await ReglageCerfa.findOne({ clientId: ctx.clientId }).lean();
    res.json({ ok: true, code: m.CODE, titre: m.TITRE, sections: m.MOBILE,
      memo: { Detecteur_ID: reg?.valeurs?.detecteur || "" } });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Nom du signataire client proposé par défaut ──
// Le dernier nom saisi pour ce client sur un bon précédent ; à défaut, le nom
// du client (chantier sans le n° de devis Henrri).
router.post("/signataire", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });
    const chantier = String(req.body.chantier || "").trim();
    const cle = cleClient(chantier);
    const parDefaut = chantier.replace(/\s+\d{2}-\d{2}-\d+\s*$/, "").trim();
    if (!cle) return res.json({ ok: true, nom: "" });
    const recents = await BonIntervention.find({ clientId: ctx.clientId }, "chantier reponses creeLe")
      .sort({ creeLe: -1 }).limit(300).lean();
    for (const b of recents) {
      if (cleClient(b.chantier) !== cle) continue;
      const rep = b.reponses || {};
      const k = Object.keys(rep).find(x => x.endsWith("__nom") && String(rep[x] || "").trim());
      if (k) return res.json({ ok: true, nom: String(rep[k]).trim(), source: "dernier bon" });
    }
    res.json({ ok: true, nom: parDefaut, source: "client" });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Enregistrer un bon rempli ──
router.post("/", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });

    const chantier = String(req.body.chantier || "").trim();
    if (!chantier) return res.status(400).json({ ok: false, message: "Chantier manquant" });

    const masqueId = req.body.masqueId;
    if (!masqueId) return res.status(400).json({ ok: false, message: "Masque manquant" });

    const masque = await MasqueIntervention.findById(masqueId);
    if (!masque || U(masque.clientId) !== ctx.clientId)
      return res.status(404).json({ ok: false, message: "Masque introuvable" });

    const reponses = (req.body.reponses && typeof req.body.reponses === "object") ? req.body.reponses : {};

    // Vérifie les champs obligatoires du masque
    for (const champ of masque.champs || []) {
      if (!champ.obligatoire) continue;
      if (champ.type === "datetime" && champ.auto) continue;   // repris du pointage (heure de fin souvent validée après le bon)
      const v = reponses[champ.id];
      const vide = v === undefined || v === null || v === "" ||
        (Array.isArray(v) && v.length === 0);
      if (vide) return res.status(400).json({ ok: false, message: `Le champ "${champ.libelle}" est obligatoire` });
    }

    // Équipement du parc client (facultatif) : doit appartenir au client du chantier
    let equipementId = null, equipement = null;
    if (req.body.equipementId) {
      let e = null;
      try { e = await Equipement.findById(req.body.equipementId).lean(); } catch (_) { e = null; }
      if (!e || U(e.clientId) !== ctx.clientId || e.clientCle !== cleClient(chantier))
        return res.status(404).json({ ok: false, message: "Équipement introuvable pour ce client" });
      equipementId = e._id;
      equipement = copieEquipement(e);
    }

    const bon = await BonIntervention.create({
      clientId: ctx.clientId,
      numero: await prochainNumeroBon(ctx.clientId),
      equipementId,
      equipement,
      chantier,
      masqueId: masque._id,
      masqueNom: masque.nom,
      masqueChamps: (masque.toObject().champs || []),
      salarieId: ctx.salarieId,
      salarieNom: ctx.salarieNom,
      dateIntervention: String(req.body.dateIntervention || "").trim(),
      reponses,
      creeLe: new Date()
    });

    // CERFA complété sur mobile : pré-remplissage complet + saisie du technicien
    if (req.body.cerfa && masque.cerfa && CERFAS[masque.cerfa] && String(req.body.cerfa.code) === masque.cerfa) {
      try { await joindreCerfaMobile(bon, masque.cerfa, req.body.cerfa.valeurs, ctx.clientId); }
      catch (e) { console.error("CERFA mobile non joint au bon", bon._id, e.message); }
    }

    res.json({ ok: true, id: bon._id });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
//  CÔTÉ BUREAU (PC)
// ═════════════════════════════════════════════════════════════

/* « Fonctionnalité non activée » répond 409 et non 403 : sync.js déconnecte
   l'utilisateur sur tout 401/403 d'une route /api/, ce qui n'a pas lieu d'être
   ici (la session est valide, seule l'option est désactivée). */
/* Contexte PC : token + fonctionnalité activée. Renvoie { clientId, doc } ou envoie l'erreur. */
async function contextePC(req, res) {
  const clientId = U(req.user?.clientId);
  const doc = await Donnees.findOne({ clientId }, "clientId entreprise coordonneesChantiers salaries");
  if (!doc?.entreprise?.bonsInterventionActifs) {
    res.status(409).json({ ok: false, inactif: true, message: "Les bons d'intervention ne sont pas activés pour votre entreprise. Activez-les sur la page Entreprise." });
    return null;
  }
  return { clientId, doc };
}

/* Bon du client (404 si absent ou appartenant à un autre client). */
async function chargerBon(req, res, clientId) {
  let bon = null;
  try { bon = await BonIntervention.findById(req.params.id); } catch (e) { bon = null; }
  if (!bon) { res.status(404).json({ ok: false, message: "Bon introuvable" }); return null; }
  if (U(bon.clientId) !== clientId) { res.status(404).json({ ok: false, message: "Bon introuvable" }); return null; }
  return bon;
}

/* Champs à utiliser pour afficher un bon : la copie figée au remplissage,
   ou à défaut (bons enregistrés avant cette évolution) le masque actuel. */
async function champsDuBon(bon) {
  if (Array.isArray(bon.masqueChamps) && bon.masqueChamps.length) return bon.masqueChamps;
  const m = await MasqueIntervention.findById(bon.masqueId).lean();
  return m?.champs || [];
}

/* Numérote les bons enregistrés avant la numérotation, dans l'ordre de création. */
async function numeroterAnciens(clientId) {
  const sansNum = await BonIntervention.find({ clientId, $or: [{ numero: "" }, { numero: { $exists: false } }] }, "_id creeLe")
    .sort({ creeLe: 1 });
  for (const b of sansNum) {
    const numero = await prochainNumeroBon(clientId, b.creeLe);
    await BonIntervention.updateOne({ _id: b._id }, { $set: { numero } });
  }
}

/* Copie figée d'un équipement, conservée dans le bon. */
function copieEquipement(e) {
  return {
    type: e.type || "", marque: e.marque || "", modele: e.modele || "", numeroSerie: e.numeroSerie || "",
    emplacement: e.emplacement || "", fluide: e.fluide || "", chargeKg: e.chargeKg ?? null,
    libelle: libelleEquipement(e)
  };
}

/* ── Champs « AUTO » (date / heures / durée) ──
   Sur mobile, ils ne sont plus ressaisis dans le bon : ils sont déjà sur l'écran
   de pointage. On les lit dans le pointage du salarié pour ce chantier et ce jour
   au moment d'afficher ou d'imprimer le bon — l'heure de fin validée APRÈS la
   signature du bon y figure donc bien. À défaut de pointage, la valeur enregistrée
   avec le bon est conservée. */
function _fmtDureeMin(min) {
  if (!(min > 0)) return "";
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}
function _minutes(a, d, pause) {
  const m = /^(\d{1,2}):(\d{2})$/, x = m.exec(a || ""), y = m.exec(d || "");
  if (!x || !y) return 0;
  const v = (+y[1] * 60 + +y[2]) - (+x[1] * 60 + +x[2]) - (parseInt(pause) || 0);
  return v > 0 ? v : 0;
}
async function pointageDuBon(bon, doc) {
  const date = bon.dateIntervention || "";
  const sid = Number(bon.salarieId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(sid) || !bon.salarieId) return null;
  const ids = [...new Set([doc?.clientId, bon.clientId].filter(Boolean))];
  const s = await Saisie.findOne({ clientId: { $in: ids }, salarieId: sid, date }).lean();
  const ch = (s?.chantiers || []).find(c => U(c.nom) === U(bon.chantier));
  if (!ch) return null;
  const duree = ch.dureeMin > 0 ? ch.dureeMin : _minutes(ch.heureArrivee, ch.heureDepart, ch.pause);
  return { date, heureDebut: ch.heureArrivee || "", heureFin: ch.heureDepart || "", duree: _fmtDureeMin(duree) };
}
/* Copie du bon dont les réponses « AUTO » sont complétées depuis le pointage. */
async function bonAvecPointage(bon, champs, doc) {
  const b = typeof bon.toObject === "function" ? bon.toObject() : { ...bon };
  const p = await pointageDuBon(b, doc).catch(() => null);
  if (!p) return b;
  const rep = { ...(b.reponses || {}) };
  for (const c of champs || []) {
    if (c.type === "datetime" && c.auto && p[c.auto]) rep[c.id] = p[c.auto];
  }
  b.reponses = rep;
  return b;
}

const nomFichier = bon => `Bon-intervention-${bon.numero || bon._id}.pdf`;

/* Identité de l'entreprise pour l'en-tête du PDF (page Entreprise → Informations). */
function enteteEntreprise(e = {}) {
  const t = v => String(v ?? "").trim();
  return {
    nom: t(e.nom), adresse: t(e.adresse), codePostal: t(e.codePostal), ville: t(e.ville),
    telephone: t(e.telephone), email: t(e.email), siret: t(e.siret),
    logo: typeof e.logo === "string" ? e.logo : ""
  };
}

async function pdfDuBon(bon, doc) {
  const coords = doc.coordonneesChantiers || {};
  const champs = await champsDuBon(bon);
  const bonComplet = await bonAvecPointage(bon, champs, doc);
  const principal = await genererPdfBon({
    bon: bonComplet,
    champs,
    entreprise: enteteEntreprise(doc.entreprise),
    coord: coords[U(bon.chantier)] || {}
  });
  // CERFA joints au bon, ajoutés à la suite
  const annexes = [];
  for (const c of bon.cerfas || []) {
    if (!CERFAS[c.code]) continue;
    annexes.push(await remplirCerfa(c.code, c.valeurs || {}, signaturesDuBon(bonComplet, champs)));
  }
  return assemblerPdf(principal, annexes);
}

/* ── CERFA ── */
function signaturesDuBon(bon, champs) {
  const rep = bon.reponses || {};
  const tech = (champs || []).find(c => c.type === "signature" && c.signataire !== "client");
  const cli  = (champs || []).find(c => c.type === "signature" && c.signataire === "client");
  return { operateur: tech ? rep[tech.id] : null, detenteur: cli ? rep[cli.id] : null };
}

async function valeursCerfaProposees(code, bon, champs, doc) {
  const reg = await ReglageCerfa.findOne({ clientId: U(bon.clientId) }).lean();
  let equipement = bon.equipement || null;
  if (bon.equipementId) {
    const e = await Equipement.findById(bon.equipementId).lean().catch(() => null);
    if (e) equipement = e;                     // caractéristiques à jour (fluide, charge…)
  }
  const coords = doc.coordonneesChantiers || {};
  return CERFAS[code].preremplir({
    bon, champs, equipement, coord: coords[U(bon.chantier)] || {},
    entreprise: doc.entreprise || {}, reglages: reg?.valeurs || {}
  });
}

/* CERFA rempli sur mobile : les valeurs proposées (entreprise, client, équipement,
   bon…) complétées par ce qu'a saisi le technicien, puis jointes au bon. */
async function joindreCerfaMobile(bon, code, brut, clientId) {
  const saisie = assainirValeurs(code, brut) || {};
  const doc = await Donnees.findOne({ clientId }, "clientId entreprise coordonneesChantiers");
  const b = typeof bon.toObject === "function" ? bon.toObject() : bon;
  const champs = b.masqueChamps || [];
  const proposees = await valeursCerfaProposees(code, b, champs, doc || {});
  // Natures cochées par le technicien : elles remplacent celles déduites du texte
  const natures = ["Case_Assemblage", "Case_MiseService", "Case_Modif", "Case_Maintenance", "Case_CtrlPerio", "Case_CtrlNonPerio", "Case_Demantel", "Case_Autre"];
  if (natures.some(k => saisie[k])) natures.forEach(k => { if (!saisie[k]) delete proposees[k]; });
  const valeurs = { ...proposees };
  for (const [k, v] of Object.entries(saisie)) if (v !== "" && v !== false) valeurs[k] = v;
  // Date du contrôle d'étanchéité = date du bon
  if ((valeurs.Case_CtrlPerio || valeurs.Case_CtrlNonPerio) && !valeurs.Controle_Annee) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(b.dateIntervention || "");
    if (m) { valeurs.Controle_Jour = m[3]; valeurs.Controle_Mois = m[2]; valeurs.Controle_Annee = m[1]; }
  }
  // Seuils [7] [8] recalculés si le fluide / la charge viennent du mobile
  if (saisie.Equipement_Fluide || saisie.Equipement_Charge) {
    const recalc = CERFAS[code].preremplir({ bon: b, champs, coord: {}, entreprise: {}, reglages: {},
      equipement: { fluide: valeurs.Equipement_Fluide, chargeKg: String(valeurs.Equipement_Charge || "").replace(",", ".") } });
    for (const k of Object.keys(valeurs)) if (/^Case_(HCFC|HFC|HFO|Sans|Avec)_/.test(k)) delete valeurs[k];
    for (const [k, v] of Object.entries(recalc)) if (/^Case_(HCFC|HFC|HFO|Sans|Avec)_|^Equipement_teqCO2$/.test(k)) valeurs[k] = v;
    if (saisie.Bouton_Oui === "1") {   // détection permanente : fréquences « avec »
      const m = { Case_Sans_12m: "Case_Avec_24m", Case_Sans_6m: "Case_Avec_12m", Case_Sans_3m: "Case_Avec_6m" };
      for (const [a, z] of Object.entries(m)) if (valeurs[a]) { delete valeurs[a]; valeurs[z] = true; }
    }
  }
  const finales = assainirValeurs(code, valeurs);
  await BonIntervention.updateOne({ _id: b._id }, { $set: { cerfas: [{ code, valeurs: finales, modifieLe: new Date(), origine: "mobile" }] } });
  if (saisie.Detecteur_ID) await ReglageCerfa.updateOne({ clientId }, { $set: { "valeurs.detecteur": saisie.Detecteur_ID, maj: new Date() } }, { upsert: true });
  // Fluide / charge reportés dans la fiche équipement s'ils y manquent
  if (b.equipementId && (saisie.Equipement_Fluide || saisie.Equipement_Charge)) {
    const e = await Equipement.findById(b.equipementId).catch(() => null);
    if (e) {
      let modif = false;
      if (!e.fluide && saisie.Equipement_Fluide) { e.fluide = "R" + String(saisie.Equipement_Fluide).replace(/^R\s*-?\s*/i, ""); modif = true; }
      const ch = Number(String(saisie.Equipement_Charge || "").replace(",", "."));
      if (e.chargeKg == null && Number.isFinite(ch) && ch > 0) { e.chargeKg = ch; modif = true; }
      if (modif) { e.modifieLe = new Date(); await e.save(); }
    }
  }
}

/* Mémorise les valeurs propres à l'entreprise (champs marqués « memo »). */
async function memoriserReglages(clientId, code, valeurs) {
  const memo = {};
  for (const s of CERFAS[code].SECTIONS) for (const c of s.champs) {
    if (c.memo && String(valeurs[c.pdf] || "").trim()) memo["valeurs." + c.memo] = String(valeurs[c.pdf]).trim();
  }
  if (Object.keys(memo).length)
    await ReglageCerfa.updateOne({ clientId }, { $set: { ...memo, maj: new Date() } }, { upsert: true });
}

// ── Liste des bons (légère : sans réponses, donc sans photos ni signatures) ──
router.get("/pc", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    await numeroterAnciens(ctx.clientId);
    const bons = await BonIntervention
      .find({ clientId: ctx.clientId }, "numero chantier masqueNom salarieId salarieNom dateIntervention envois creeLe equipementId equipement.libelle cerfas.code")
      .sort({ creeLe: -1 })
      .limit(2000)
      .lean();
    res.json({ ok: true, bons });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Bon d'exemple : masque « Rapport d'intervention (exemple) » + bon rempli ──
// Sans effet si l'exemple existe déjà (renvoie le bon existant).
router.post("/pc/exemple", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const clientId = ctx.clientId;

    let masque = await MasqueIntervention.findOne({ clientId, nom: NOM_MASQUE_EXEMPLE });
    if (!masque) {
      masque = await MasqueIntervention.create({
        clientId, nom: NOM_MASQUE_EXEMPLE, actif: true, champs: CHAMPS_EXEMPLE, cerfa: "15497",
        creeLe: new Date(), modifieLe: new Date()
      });
    }

    // Équipement d'exemple dans le parc du client (créé une seule fois)
    const clientCle = cleClient(BON_EXEMPLE.chantier);
    let equip = await Equipement.findOne({ clientId, clientCle, marque: BON_EXEMPLE.equipement.marque, modele: BON_EXEMPLE.equipement.modele });
    if (!equip) equip = await Equipement.create({ clientId, clientCle, clientNom: BON_EXEMPLE.chantier, ...BON_EXEMPLE.equipement, creePar: "bureau" });

    const existant = await BonIntervention.findOne({ clientId, masqueId: masque._id, chantier: BON_EXEMPLE.chantier }, "_id numero equipementId");
    if (existant) {
      // Bon d'exemple créé avant le parc d'équipements : on le rattache à l'équipement
      if (!existant.equipementId) {
        await BonIntervention.updateOne({ _id: existant._id },
          { $set: { equipementId: equip._id, equipement: copieEquipement(equip.toObject()) } });
      }
      return res.json({ ok: true, id: existant._id, numero: existant.numero, dejaPresent: true });
    }

    // Coordonnées du chantier d'exemple, seulement si la fiche n'existe pas déjà
    const coords = ctx.doc.coordonneesChantiers || {};
    if (!coords[BON_EXEMPLE.chantier]) {
      coords[BON_EXEMPLE.chantier] = BON_EXEMPLE.coord;
      await Donnees.updateOne({ _id: ctx.doc._id }, { $set: { coordonneesChantiers: coords } });
    }

    const bon = await BonIntervention.create({
      clientId,
      numero: await prochainNumeroBon(clientId, new Date(BON_EXEMPLE.dateIntervention)),
      chantier: BON_EXEMPLE.chantier,
      masqueId: masque._id,
      masqueNom: masque.nom,
      masqueChamps: masque.toObject().champs,
      equipementId: equip._id,
      equipement: copieEquipement(equip.toObject()),
      salarieId: "",
      salarieNom: BON_EXEMPLE.salarieNom,
      dateIntervention: BON_EXEMPLE.dateIntervention,
      reponses: BON_EXEMPLE.reponses,
      creeLe: new Date(`${BON_EXEMPLE.dateIntervention}T12:00:00+02:00`)
    });
    res.json({ ok: true, id: bon._id, numero: bon.numero });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Catalogue des CERFA disponibles ──
router.get("/pc/cerfa-modeles", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    res.json({ ok: true, modeles: listeModeles() });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Un bon complet ──
router.get("/pc/:id", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    const coords = ctx.doc.coordonneesChantiers || {};
    const champs = await champsDuBon(bon);
    res.json({ ok: true, bon: await bonAvecPointage(bon, champs, ctx.doc), champs, coord: coords[U(bon.chantier)] || null });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── PDF du bon ──
router.get("/pc/:id/pdf", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    const pdf = await pdfDuBon(bon, ctx.doc);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nomFichier(bon)}"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Envoi du bon au client par e-mail (PDF en pièce jointe, via Resend) ──
const EMAIL_OK = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const echapper = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

router.post("/pc/:id/envoyer", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;

    const a = String(req.body.a || "").trim().toLowerCase();
    const copie = String(req.body.copie || "").trim().toLowerCase();
    const message = String(req.body.message || "").slice(0, 3000);
    if (!EMAIL_OK(a)) return res.status(400).json({ ok: false, message: "Adresse e-mail du destinataire invalide" });
    if (copie && !EMAIL_OK(copie)) return res.status(400).json({ ok: false, message: "Adresse e-mail de copie invalide" });

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return res.status(503).json({ ok: false, message: "Envoi d'e-mails non configuré sur le serveur (RESEND_API_KEY)" });
    const from = process.env.MAIL_FROM || process.env.SMTP_FROM || "contact@volitis.net";

    const entNom = ctx.doc.entreprise?.nom || "Suiv'Heures";
    const pdf = await pdfDuBon(bon, ctx.doc);
    const dateTxt = (/^(\d{4})-(\d{2})-(\d{2})$/.exec(bon.dateIntervention || "") || []).slice(1).reverse().join("/");
    const sujet = `Bon d'intervention n° ${bon.numero} — ${bon.chantier}${dateTxt ? " — " + dateTxt : ""}`;
    const corps = message.trim() ||
      `Bonjour,\n\nVeuillez trouver ci-joint le bon d'intervention n° ${bon.numero}${dateTxt ? " du " + dateTxt : ""}.\n\nCordialement,\n${entNom}`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.55;">${echapper(corps).replace(/\n/g, "<br>")}</div>`;

    const payload = {
      from: `${entNom.replace(/[<>"]/g, "")} <${from}>`,
      to: [a],
      subject: sujet,
      text: corps,
      html,
      attachments: [{ filename: nomFichier(bon), content: pdf.toString("base64") }]
    };
    if (copie) { payload.cc = [copie]; payload.reply_to = copie; }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ ok: false, message: `L'envoi a échoué (${r.status}) ${detail}`.trim() });
    }

    const envoi = { a, copie, le: new Date() };
    await BonIntervention.updateOne({ _id: bon._id }, { $push: { envois: envoi } });
    res.json({ ok: true, envoi });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── CERFA d'un bon : formulaire (valeurs enregistrées, sinon proposées) ──
router.get("/pc/:id/cerfa/:code", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    const m = CERFAS[req.params.code];
    if (!m) return res.status(404).json({ ok: false, message: "CERFA inconnu" });
    const champs = await champsDuBon(bon);
    const joint = (bon.cerfas || []).find(c => c.code === m.CODE);
    const proposees = await valeursCerfaProposees(m.CODE, await bonAvecPointage(bon, champs, ctx.doc), champs, ctx.doc);
    res.json({
      ok: true,
      modele: { code: m.CODE, titre: m.TITRE, sections: m.SECTIONS },
      valeurs: joint ? joint.valeurs : proposees,
      proposees,
      joint: !!joint
    });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Joindre / mettre à jour un CERFA sur le bon ──
router.put("/pc/:id/cerfa/:code", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    const code = req.params.code;
    const valeurs = assainirValeurs(code, req.body.valeurs);
    if (!valeurs) return res.status(404).json({ ok: false, message: "CERFA inconnu" });
    const cerfas = (bon.cerfas || []).filter(c => c.code !== code);
    cerfas.push({ code, valeurs, modifieLe: new Date() });
    await BonIntervention.updateOne({ _id: bon._id }, { $set: { cerfas } });
    await memoriserReglages(ctx.clientId, code, valeurs);
    // Fluide / charge saisis sur le CERFA : reportés dans la fiche de l'équipement s'ils y manquent
    if (bon.equipementId && (valeurs.Equipement_Fluide || valeurs.Equipement_Charge)) {
      const e = await Equipement.findById(bon.equipementId).catch(() => null);
      if (e && U(e.clientId) === ctx.clientId) {
        let modif = false;
        if (!e.fluide && valeurs.Equipement_Fluide) { e.fluide = "R" + String(valeurs.Equipement_Fluide).replace(/^R\s*-?\s*/i, ""); modif = true; }
        const ch = Number(String(valeurs.Equipement_Charge || "").replace(",", "."));
        if (e.chargeKg == null && Number.isFinite(ch) && ch > 0) { e.chargeKg = ch; modif = true; }
        if (modif) { e.modifieLe = new Date(); await e.save(); }
      }
    }
    res.json({ ok: true, cerfas: cerfas.map(c => ({ code: c.code, modifieLe: c.modifieLe })) });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Retirer un CERFA du bon ──
router.delete("/pc/:id/cerfa/:code", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    const cerfas = (bon.cerfas || []).filter(c => c.code !== req.params.code);
    await BonIntervention.updateOne({ _id: bon._id }, { $set: { cerfas } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── PDF du CERFA seul (valeurs envoyées pour l'aperçu, sinon enregistrées / proposées) ──
router.post("/pc/:id/cerfa/:code/pdf", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    const code = req.params.code;
    if (!CERFAS[code]) return res.status(404).json({ ok: false, message: "CERFA inconnu" });
    const champs = await champsDuBon(bon);
    const bonComplet = await bonAvecPointage(bon, champs, ctx.doc);
    let valeurs = req.body?.valeurs ? assainirValeurs(code, req.body.valeurs) : null;
    if (!valeurs) {
      const joint = (bon.cerfas || []).find(c => c.code === code);
      valeurs = joint ? joint.valeurs : await valeursCerfaProposees(code, bonComplet, champs, ctx.doc);
    }
    const pdf = await remplirCerfa(code, valeurs, signaturesDuBon(bonComplet, champs));
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="CERFA-${code}-${bon.numero || bon._id}.pdf"`);
    res.send(pdf);
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Changer le technicien d'un bon (choisi parmi les salariés) ──
router.post("/pc/:id/technicien", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    const sal = (ctx.doc.salaries || []).find(s => String(s.id) === String(req.body.salarieId));
    if (!sal) return res.status(400).json({ ok: false, message: "Salarié inconnu" });
    const salarieNom = `${sal.prenom || ""} ${sal.nom || ""}`.trim();
    await BonIntervention.updateOne({ _id: bon._id }, { $set: { salarieId: String(sal.id), salarieNom } });
    res.json({ ok: true, salarieId: String(sal.id), salarieNom });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Supprimer un bon ──
router.delete("/pc/:id", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    await bon.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
