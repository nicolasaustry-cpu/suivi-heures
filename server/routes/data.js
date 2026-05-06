import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Exemple de route protégée
router.get("/private", verifyToken, (req, res) => {
  res.json({
    message: "Bienvenue sur la route protégée !",
    user: req.user
  });
});
import Licence from "../models/licence.js";

// Vérification d'une licence
router.post("/verifyLicence", async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ valid: false, message: "Aucun code fourni" });

  const licence = await Licence.findOne({ codeClient: code });
  if (!licence) return res.status(404).json({ valid: false, message: "Licence inconnue" });
  if (!licence.actif) return res.status(403).json({ valid: false, message: "Licence désactivée" });

  const now = new Date();
  if (now > licence.dateExpiration) {
    return res.status(403).json({ valid: false, message: "Licence expirée" });
  }

  res.json({
    valid: true,
    message: "Licence valide jusqu’au " + licence.dateExpiration.toLocaleDateString("fr-FR")
  });
});

export default router;
