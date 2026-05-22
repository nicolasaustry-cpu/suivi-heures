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
    // Chercher dans tous les documents (Object générique, pas de requête directe sur sous-champ)
    const docs = await Donnees.find({});
    const doc  = docs.find(d => {
      const ce = (d.entreprise?.codeEmploye || "").trim().toUpperCase();
      return ce === codeEmploye;
    });
    if (!doc) return res.status(404).json({ ok: false, message: "Code employé invalide" });

    res.json({
      ok: true,
      clientId:     doc.clientId,
      salaries:     doc.salaries     || [],
      previsionnel: doc.previsionnel || {},
      heures:       doc.heures       || {}
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Envoyer un chantier (avec code employé) – s'ajoute à la journée ── */
router.post("/envoyer", async (req, res) => {
  try {
    const { codeEmploye, salarieId, salarieNom, date, chantier } = req.body;
    const codeEmp = (codeEmploye || "").trim().toUpperCase();

    const Donnees = (await import("../models/donnees.js")).default;
    const docs = await Donnees.find({});
    const doc  = docs.find(d => {
      const ce = (d.entreprise?.codeEmploye || "").trim().toUpperCase();
      return ce === codeEmp;
    });
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    // Chercher la saisie du jour ou la créer
    let saisie = await Saisie.findOne({ clientId: doc.clientId, salarieId, date });

    if (!saisie) {
      // Créer une nouvelle saisie pour ce jour
      saisie = new Saisie({
        clientId: doc.clientId, salarieId, salarieNom, date,
        chantiers: [chantier],
        totalMin: chantier.dureeMin + (chantier.deplacement || 0),
        statut: "envoyee"
      });
    } else {
      // Ajouter le chantier à la saisie existante
      saisie.chantiers.push(chantier);
      saisie.totalMin = saisie.chantiers.reduce((s, c) => s + (c.dureeMin || 0) + (c.deplacement || 0), 0);
      saisie.updatedAt = new Date();
    }

    await saisie.save();
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
