import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import Saisie from "../models/saisies.js";

const router = express.Router();

/* ── Connexion par code employé (sans token licence) ── */
router.post("/connect", async (req, res) => {
  try {
    const codeEmploye = (req.body.codeEmploye || "").trim().toUpperCase();
    if (!codeEmploye) return res.status(400).json({ ok: false, message: "Code employé manquant" });

    const Donnees = (await import("../models/donnees.js")).default;
    const doc = await Donnees.findOne({ "entreprise.codeEmploye": codeEmploye });
    if (!doc) return res.status(404).json({ ok: false, message: "Code employé invalide" });

    // Retourner uniquement les données nécessaires à la saisie
    res.json({
      ok: true,
      clientId:    doc.clientId,
      salaries:    doc.salaries || [],
      previsionnel: doc.previsionnel || {}
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Envoyer une saisie (avec code employé) ── */
router.post("/envoyer", async (req, res) => {
  try {
    const { codeEmploye, salarieId, salarieNom, date, chantiers, totalMin } = req.body;
    const codeEmp = (codeEmploye || "").trim().toUpperCase();

    const Donnees = (await import("../models/donnees.js")).default;
    const doc = await Donnees.findOne({ "entreprise.codeEmploye": codeEmp });
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    const saisie = await Saisie.findOneAndUpdate(
      { clientId: doc.clientId, salarieId, date },
      { clientId: doc.clientId, salarieId, salarieNom, date, chantiers, totalMin, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Authentification salarié par PIN ── */
router.post("/auth", verifyToken, async (req, res) => {
  try {
    const { salarieId, pin } = req.body;
    const Donnees = (await import("../models/donnees.js")).default;
    const doc = await Donnees.findOne({ clientId: req.user.clientId });
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const sal = (doc.salaries || []).find(s => s.id == salarieId);
    if (!sal) return res.status(404).json({ ok: false, message: "Salarié introuvable" });
    if (!sal.pin || sal.pin !== pin)
      return res.status(401).json({ ok: false, message: "Code PIN incorrect" });

    res.json({ ok: true, salarieId: sal.id, nom: `${sal.prenom} ${sal.nom}` });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Envoyer une saisie journalière ── */
router.post("/", verifyToken, async (req, res) => {
  try {
    const clientId  = req.user.clientId;
    const { salarieId, salarieNom, date, chantiers, totalMin } = req.body;

    const saisie = await Saisie.findOneAndUpdate(
      { clientId, salarieId, date },
      { clientId, salarieId, salarieNom, date, chantiers, totalMin, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Récupérer les saisies d'un mois ── */
router.get("/:mois", verifyToken, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const mois     = req.params.mois; // "YYYY-MM"
    const saisies  = await Saisie.find({
      clientId,
      date: { $regex: `^${mois}` }
    }).sort({ date: 1, salarieNom: 1 });
    res.json({ ok: true, saisies });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Récupérer les saisies d'un salarié pour un mois ── */
router.get("/:mois/:salarieId", verifyToken, async (req, res) => {
  try {
    const clientId  = req.user.clientId;
    const { mois, salarieId } = req.params;
    const saisies = await Saisie.find({
      clientId, salarieId: parseInt(salarieId),
      date: { $regex: `^${mois}` }
    }).sort({ date: 1 });
    res.json({ ok: true, saisies });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Valider une saisie (responsable) ── */
router.patch("/:id/valider", verifyToken, async (req, res) => {
  try {
    const saisie = await Saisie.findByIdAndUpdate(
      req.params.id,
      { statut: "validee" },
      { new: true }
    );
    if (!saisie) return res.status(404).json({ ok: false });
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
