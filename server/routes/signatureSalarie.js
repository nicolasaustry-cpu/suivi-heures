// ─────────────────────────────────────────────────────────────
// routes/signatureSalarie.js — Signature personnelle du salarié (mobile)
// ─────────────────────────────────────────────────────────────
// Permet à un salarié d'enregistrer sa signature une fois et de la
// réutiliser automatiquement dans les bons d'intervention, plutôt que de
// la redessiner à chaque fois. Une signature par salarié (pas d'historique,
// pas de gestion dédiée : uniquement via le champ signature d'un bon).
//
// Endpoints (POST, auth mobile dans le corps) :
//   POST /api/signature-salarie/recuperer   { codeEmploye, salarieId }
//        → { ok, data } — data = null si aucune signature enregistrée
//   POST /api/signature-salarie/enregistrer { codeEmploye, salarieId, data }
//        → enregistre/écrase la signature du salarié
// ─────────────────────────────────────────────────────────────

import express from "express";
import Donnees from "../models/donnees.js";
import SignatureSalarie from "../models/signatureSalarie.js";

const router = express.Router();

const U = s => String(s == null ? "" : s).trim().toUpperCase();
const TAILLE_MAX = 300000; // ~300 Ko en base64, largement suffisant pour un tracé de signature

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

  return { clientId: U(doc.clientId), salarieId: String(req.body.salarieId) };
}

// ── Récupérer la signature enregistrée du salarié (si elle existe) ──
router.post("/recuperer", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });

    const sig = await SignatureSalarie.findOne({ clientId: ctx.clientId, salarieId: ctx.salarieId });
    res.json({ ok: true, data: sig ? sig.data : null });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Enregistrer (ou remplacer) la signature du salarié ──
router.post("/enregistrer", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });

    const data = String(req.body.data || "");
    if (!data.startsWith("data:image/"))
      return res.status(400).json({ ok: false, message: "Signature invalide" });
    if (data.length > TAILLE_MAX)
      return res.status(413).json({ ok: false, message: "Signature trop volumineuse" });

    await SignatureSalarie.findOneAndUpdate(
      { clientId: ctx.clientId, salarieId: ctx.salarieId },
      { data, maj: new Date() },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
