import express from "express";
import bcrypt from "bcryptjs";
import { verifyToken } from "../middleware/authMiddleware.js";
import Donnees from "../models/donnees.js";

const router = express.Router();

// ── Charger toutes les données du client ──
router.get("/", verifyToken, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    let doc = await Donnees.findOne({ clientId });
    if (!doc) doc = { entreprise: {}, salaries: [], heures: {}, chantiers: [], previsionnel: {} };
    res.json({ ok: true, data: doc });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Sauvegarder toutes les données du client ──
router.post("/", verifyToken, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { entreprise, salaries, heures, chantiers, previsionnel } = req.body;

    // Hasher les PIN en clair avant stockage (les hash bcrypt commencent par $2)
    const salariesSecurises = Array.isArray(salaries) ? await Promise.all(salaries.map(async s => {
      if (s && typeof s.pin === "string" && /^\d{4}$/.test(s.pin)) {
        return { ...s, pin: await bcrypt.hash(s.pin, 10) };
      }
      return s;
    })) : salaries;

    await Donnees.findOneAndUpdate(
      { clientId },
      { clientId, entreprise, salaries: salariesSecurises, heures, chantiers, previsionnel, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Sauvegarder une seule clé (ex: juste "heures") ──
router.patch("/:cle", verifyToken, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const { cle }  = req.params;
    const clesAutorisees = ["entreprise", "salaries", "heures", "chantiers", "previsionnel"];
    if (!clesAutorisees.includes(cle))
      return res.status(400).json({ ok: false, message: "Clé non autorisée" });

    let valeur = req.body.valeur;
    if (cle === "salaries" && Array.isArray(valeur)) {
      valeur = await Promise.all(valeur.map(async s => {
        if (s && typeof s.pin === "string" && /^\d{4}$/.test(s.pin)) {
          return { ...s, pin: await bcrypt.hash(s.pin, 10) };
        }
        return s;
      }));
    }

    await Donnees.findOneAndUpdate(
      { clientId },
      { $set: { [cle]: valeur, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Réinitialiser le PIN d'un salarié (par le patron / admin client) ──
// Le PIN reçu est hashé immédiatement avant stockage.
router.post("/reset-pin", verifyToken, async (req, res) => {
  try {
    const clientId  = req.user.clientId;
    const { salarieId, pin } = req.body;

    if (!salarieId)                return res.status(400).json({ ok: false, message: "salarieId requis" });
    if (!pin || !/^\d{4}$/.test(String(pin)))
      return res.status(400).json({ ok: false, message: "PIN invalide (4 chiffres requis)" });

    const doc = await Donnees.findOne({ clientId });
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal) return res.status(404).json({ ok: false, message: "Salarié introuvable" });

    sal.pin = await bcrypt.hash(String(pin), 10);
    doc.markModified("salaries");
    doc.updatedAt = new Date();
    await doc.save();

    res.json({ ok: true, message: "PIN réinitialisé et sécurisé" });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
