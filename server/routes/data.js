import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import Donnees from "../models/donnees.js";

const router = express.Router();

// ── Charger toutes les données du client ──
router.get("/", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    let doc = await Donnees.findOne({ clientId });
    // Compatibilité : ancien document enregistré dans une autre casse
    if (!doc) {
      const tous = await Donnees.find({});
      doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId) || null;
    }
    if (!doc) doc = { entreprise: {}, salaries: [], heures: {}, chantiers: [], previsionnel: {} };
    res.json({ ok: true, data: doc });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Sauvegarder toutes les données du client ──
router.post("/", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const { entreprise, salaries, heures, chantiers, previsionnel } = req.body;

    // Retrouver un document existant quelle que soit la casse de son clientId,
    // pour le mettre à jour EN PLACE et normaliser sa casse en majuscules.
    const tous = await Donnees.find({});
    const memeCle = tous.filter(d => (d.clientId || "").toUpperCase() === clientId);
    const existant = memeCle[0];
    // Nettoyer d'éventuels doublons de casse (on n'en garde qu'un seul)
    for (let i = 1; i < memeCle.length; i++) {
      await Donnees.deleteOne({ _id: memeCle[i]._id });
    }

    if (existant) {
      existant.clientId     = clientId;          // normalise la casse
      existant.entreprise   = entreprise;
      existant.salaries     = salaries;
      existant.heures       = heures;
      existant.chantiers    = chantiers;
      existant.previsionnel = previsionnel;
      existant.updatedAt    = new Date();
      await existant.save();
    } else {
      await Donnees.create({
        clientId, entreprise, salaries, heures, chantiers, previsionnel, updatedAt: new Date()
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Sauvegarder une seule clé (ex: juste "heures") ──
router.patch("/:cle", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const { cle }  = req.params;
    const clesAutorisees = ["entreprise", "salaries", "heures", "chantiers", "previsionnel"];
    if (!clesAutorisees.includes(cle))
      return res.status(400).json({ ok: false, message: "Clé non autorisée" });

    await Donnees.findOneAndUpdate(
      { clientId },
      { $set: { [cle]: req.body.valeur, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
