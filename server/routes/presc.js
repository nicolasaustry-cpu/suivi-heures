import express from "express";
import jwt from "jsonwebtoken";
import { verifyToken } from "../middleware/authMiddleware.js";
import Licence from "../models/licence.js";

const router = express.Router();

// Réserve l'accès au rôle "prescripteur"
function verifyPresc(req, res, next) {
  if (req.user?.role !== "prescripteur")
    return res.status(403).json({ message: "Accès réservé aux prescripteurs" });
  next();
}

// ── Lister UNIQUEMENT les clients rattachés à ce prescripteur ──
router.get("/licences", verifyToken, verifyPresc, async (req, res) => {
  try {
    const presId = (req.user.presId || "").toUpperCase();
    /* Projection : on ne renvoie QUE les champs affichés par la console.
       Sans elle, le document entier partait dans le navigateur du
       prescripteur — dont le champ `notes`, qui contient les remarques
       internes sur le client. Les colonnes masquées de la console le sont
       par une simple règle CSS : elles n'ont jamais protégé la donnée.
       Sont aussi écartés `logoPartenaire` (une image en base64 par ligne,
       inutile ici et lourde) et `marquePartenaire`. */
    const CHAMPS = "codeClient nomClient email origine statut type actif dateExpiration datePaiement";
    const licences = await Licence.find({ prescripteur: presId }, CHAMPS).sort({ dateActivation: -1 });
    res.json({ ok: true, licences, nom: req.user.nom || "" });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Démarrer la consultation d'un client (lecture seule) ──
// Vérifie côté serveur que le client appartient bien à ce prescripteur,
// puis délivre un jeton client de consultation.
router.post("/consulter", verifyToken, verifyPresc, async (req, res) => {
  try {
    const presId = (req.user.presId || "").toUpperCase();
    const code   = (req.body.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ ok: false, message: "Code manquant" });

    const licence = await Licence.findOne({ codeClient: code });
    if (!licence) return res.status(404).json({ ok: false, message: "Client inconnu" });
    if ((licence.prescripteur || "").toUpperCase() !== presId)
      return res.status(403).json({ ok: false, message: "Ce client ne vous est pas rattaché" });

    const token = jwt.sign(
      { clientId: code, nomClient: licence.nomClient, role: "client", type: licence.type, lectureSeule: true },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({ ok: true, token, clientId: code, nomClient: licence.nomClient, type: licence.type });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
