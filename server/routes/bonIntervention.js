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
// ─────────────────────────────────────────────────────────────

import express from "express";
import Donnees from "../models/donnees.js";
import MasqueIntervention from "../models/masqueIntervention.js";
import BonIntervention from "../models/bonIntervention.js";

const router = express.Router();

const U = s => String(s == null ? "" : s).trim().toUpperCase();

/* Résout le contexte mobile (codeEmploye + salarieId). Renvoie
   { clientId, entreprise, salarieId, salarieNom } ou { err: [code, message] }. */
async function resoudreContexteMobile(req) {
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
    return { err: [403, "Fonctionnalité non activée pour ce compte (page Entreprise)"] };
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
      .find({ clientId: ctx.clientId, actif: true }, "nom champs")
      .sort({ nom: 1 });
    res.json({ ok: true, masques });
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
      const v = reponses[champ.id];
      const vide = v === undefined || v === null || v === "" ||
        (Array.isArray(v) && v.length === 0);
      if (vide) return res.status(400).json({ ok: false, message: `Le champ "${champ.libelle}" est obligatoire` });
    }

    const bon = await BonIntervention.create({
      clientId: ctx.clientId,
      chantier,
      masqueId: masque._id,
      masqueNom: masque.nom,
      salarieId: ctx.salarieId,
      salarieNom: ctx.salarieNom,
      dateIntervention: String(req.body.dateIntervention || "").trim(),
      reponses,
      creeLe: new Date()
    });

    res.json({ ok: true, id: bon._id });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
