// ─────────────────────────────────────────────────────────────
// routes/equipement.js — Parc d'équipements des clients
// ─────────────────────────────────────────────────────────────
// Fait partie du module Bons d'intervention : protégé par la même activation
// (entreprise.bonsInterventionActifs).
//
// Bureau (PC, token) :
//   GET    /api/equipements                 → tous les équipements du client (+ dernière intervention)
//   POST   /api/equipements                 → créer   { clientNom, type, marque, modele, numeroSerie, … }
//   PUT    /api/equipements/:id             → modifier
//   DELETE /api/equipements/:id             → supprimer (les bons gardent leur copie)
//   POST   /api/equipements/import          → import en lot (ex. installations Organilog)
// Mobile (codeEmploye + salarieId dans le corps) :
//   POST   /api/equipements/mobile/liste    { chantier } → équipements du client de ce chantier
//   POST   /api/equipements/mobile/creer    { chantier, type, marque, modele, numeroSerie }
//   POST   /api/equipements/mobile/modifier { chantier, id, type, marque, modele, numeroSerie }
// ─────────────────────────────────────────────────────────────

import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import Donnees from "../models/donnees.js";
import { refusBons } from "../services/accesBons.js";
import Equipement, { cleClient } from "../models/equipement.js";
import BonIntervention from "../models/bonIntervention.js";
import { resoudreContexteMobile } from "./bonIntervention.js";

const router = express.Router();
const U = s => String(s == null ? "" : s).trim().toUpperCase();

/* Champs modifiables, nettoyés. */
function assainir(b) {
  const t = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
  const charge = b.chargeKg === "" || b.chargeKg == null ? null : Number(String(b.chargeKg).replace(",", "."));
  return {
    type: t(b.type, 120),
    marque: t(b.marque, 120),
    modele: t(b.modele, 200),
    numeroSerie: t(b.numeroSerie, 120),
    emplacement: t(b.emplacement, 200),
    miseEnService: /^\d{4}-\d{2}-\d{2}$/.test(b.miseEnService || "") ? b.miseEnService : "",
    fluide: t(b.fluide, 40),
    chargeKg: Number.isFinite(charge) ? Math.round(charge * 1000) / 1000 : null,
    notes: t(b.notes, 2000)
  };
}
const vide = e => !e.type && !e.marque && !e.modele && !e.numeroSerie;

/* Ajoute à chaque équipement la date de sa dernière intervention et son nombre de bons. */
async function avecInterventions(clientId, equipements) {
  if (!equipements.length) return [];
  const stats = await BonIntervention.aggregate([
    { $match: { clientId, equipementId: { $in: equipements.map(e => e._id) } } },
    { $group: { _id: "$equipementId", derniere: { $max: "$dateIntervention" }, nbBons: { $sum: 1 } } }
  ]);
  const parId = new Map(stats.map(s => [String(s._id), s]));
  return equipements.map(e => {
    const s = parId.get(String(e._id));
    return { ...e, derniereIntervention: s?.derniere || "", nbBons: s?.nbBons || 0 };
  });
}

async function contextePC(req, res) {
  const clientId = U(req.user?.clientId);
  const doc = await Donnees.findOne({ clientId }, "entreprise");
  const refus = await refusBons(clientId, doc?.entreprise);   // licence Plus + activation page Entreprise
  if (refus) {
    // 409 et non 403 : sync.js déconnecte sur tout 401/403 d'une route /api/.
    res.status(409).json({ ok: false, inactif: true, message: refus });
    return null;
  }
  return clientId;
}

async function chargerEquipement(req, res, clientId) {
  let e = null;
  try { e = await Equipement.findById(req.params.id); } catch (_) { e = null; }
  if (!e || U(e.clientId) !== clientId) { res.status(404).json({ ok: false, message: "Équipement introuvable" }); return null; }
  return e;
}

// ── Bureau : liste ──
router.get("/", verifyToken, async (req, res) => {
  try {
    const clientId = await contextePC(req, res); if (!clientId) return;
    const liste = await Equipement.find({ clientId }).sort({ clientCle: 1, creeLe: 1 }).lean();
    res.json({ ok: true, equipements: await avecInterventions(clientId, liste) });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Bureau : créer ──
router.post("/", verifyToken, async (req, res) => {
  try {
    const clientId = await contextePC(req, res); if (!clientId) return;
    const clientNom = String(req.body.clientNom || "").trim();
    const clientCle = cleClient(clientNom);
    if (!clientCle) return res.status(400).json({ ok: false, message: "Client manquant" });
    const champs = assainir(req.body);
    if (vide(champs)) return res.status(400).json({ ok: false, message: "Renseignez au moins le type, la marque, le modèle ou le n° de série" });
    const e = await Equipement.create({ clientId, clientCle, clientNom, ...champs, creePar: "bureau" });
    res.json({ ok: true, equipement: { ...e.toObject(), derniereIntervention: "", nbBons: 0 } });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Bureau : import en lot (installations Organilog…) ──
// Un équipement déjà présent chez le même client (même n° de série, ou même
// marque + modèle s'il n'y a pas de n° de série) n'est pas recréé.
router.post("/import", verifyToken, async (req, res) => {
  try {
    const clientId = await contextePC(req, res); if (!clientId) return;
    const liste = Array.isArray(req.body.equipements) ? req.body.equipements : [];
    if (liste.length > 5000) return res.status(400).json({ ok: false, message: "5 000 équipements maximum par import" });
    const existants = await Equipement.find({ clientId }, "clientCle marque modele numeroSerie refExterne").lean();
    const n = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
    // Doublon : même identifiant d'origine (n° d'installation Organilog), sinon même n° de série,
    // sinon même marque + modèle chez le même client
    const signature = e => e.refExterne ? "R|" + e.refExterne
      : e.numeroSerie ? e.clientCle + "|S|" + n(e.numeroSerie) : e.clientCle + "|M|" + n(e.marque) + "|" + n(e.modele);
    const vus = new Set(existants.map(signature));
    const rapport = { crees: 0, ignores: 0, invalides: 0 };
    const aCreer = [];
    for (const b of liste) {
      const clientNom = String(b?.clientNom || "").trim();
      const clientCle = cleClient(clientNom);
      const champs = assainir(b || {});
      if (!clientCle || vide(champs)) { rapport.invalides++; continue; }
      const refExterne = String(b?.refExterne || "").trim().slice(0, 80);
      const e = { clientId, clientCle, clientNom, ...champs, refExterne, creePar: "import Organilog" };
      const sig = signature(e);
      if (vus.has(sig)) { rapport.ignores++; continue; }
      vus.add(sig); aCreer.push(e);
    }
    if (aCreer.length) await Equipement.insertMany(aCreer);
    rapport.crees = aCreer.length;
    res.json({ ok: true, rapport });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Bureau : modifier ──
router.put("/:id", verifyToken, async (req, res) => {
  try {
    const clientId = await contextePC(req, res); if (!clientId) return;
    const e = await chargerEquipement(req, res, clientId); if (!e) return;
    const champs = assainir(req.body);
    if (vide(champs)) return res.status(400).json({ ok: false, message: "Renseignez au moins le type, la marque, le modèle ou le n° de série" });
    Object.assign(e, champs, { modifieLe: new Date() });
    await e.save();
    const [complet] = await avecInterventions(clientId, [e.toObject()]);
    res.json({ ok: true, equipement: complet });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Bureau : supprimer ──
router.delete("/:id", verifyToken, async (req, res) => {
  try {
    const clientId = await contextePC(req, res); if (!clientId) return;
    const e = await chargerEquipement(req, res, clientId); if (!e) return;
    await e.deleteOne();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Mobile : équipements du client d'un chantier ──
router.post("/mobile/liste", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });
    const clientCle = cleClient(req.body.chantier);
    if (!clientCle) return res.json({ ok: true, equipements: [] });
    const liste = await Equipement.find({ clientId: ctx.clientId, clientCle }).sort({ creeLe: 1 }).lean();
    res.json({ ok: true, equipements: await avecInterventions(ctx.clientId, liste) });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Mobile : nouvel équipement découvert sur place ──
router.post("/mobile/creer", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });
    const chantier = String(req.body.chantier || "").trim();
    const clientCle = cleClient(chantier);
    if (!clientCle) return res.status(400).json({ ok: false, message: "Chantier manquant" });
    const champs = assainir(req.body);
    if (vide(champs)) return res.status(400).json({ ok: false, message: "Renseignez au moins le type, la marque, le modèle ou le n° de série" });
    const nomSansRef = chantier.replace(/\s+\d{2}-\d{2}-\d+\s*$/, "").trim();
    const e = await Equipement.create({ clientId: ctx.clientId, clientCle, clientNom: nomSansRef, ...champs, creePar: ctx.salarieNom || "mobile" });
    res.json({ ok: true, equipement: { ...e.toObject(), derniereIntervention: "", nbBons: 0 } });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

// ── Mobile : corriger un équipement constaté sur place ──
// Seuls type / marque / modèle / n° de série sont modifiables depuis le mobile ;
// les autres caractéristiques (emplacement, fluide, notes…) restent gérées au bureau.
router.post("/mobile/modifier", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });
    let e = null;
    try { e = await Equipement.findById(req.body.id); } catch (_) { e = null; }
    if (!e || U(e.clientId) !== ctx.clientId || e.clientCle !== cleClient(req.body.chantier))
      return res.status(404).json({ ok: false, message: "Équipement introuvable pour ce client" });
    const c = assainir(req.body);
    const maj = { type: c.type, marque: c.marque, modele: c.modele, numeroSerie: c.numeroSerie };
    if (vide(maj)) return res.status(400).json({ ok: false, message: "Renseignez au moins le type, la marque, le modèle ou le n° de série" });
    Object.assign(e, maj, { modifieLe: new Date() });
    await e.save();
    const [complet] = await avecInterventions(ctx.clientId, [e.toObject()]);
    res.json({ ok: true, equipement: complet });
  } catch (err) { res.status(500).json({ ok: false, message: err.message }); }
});

export default router;
