import express from "express";
import jwt from "jsonwebtoken";
import { verifyToken } from "../middleware/authMiddleware.js";
import Licence from "../models/licence.js";
import Donnees from "../models/donnees.js";

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

    /* Nombre de salariés, comme la console admin : c'est la longueur du
       tableau `salaries` des données du client, et non un champ de la licence.
       Sans cet enrichissement la colonne affichait 0 pour tout le monde.
       À la différence de la route admin, on ne charge QUE les clients de ce
       prescripteur. La comparaison est insensible à la casse : les documents
       Donnees n'ont pas tous leur clientId en majuscules. */
    const codes = licences.map(l => l.codeClient).filter(Boolean);
    const motifs = codes.map(c => new RegExp("^" + c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i"));
    const donnees = motifs.length
      ? await Donnees.find({ clientId: { $in: motifs } }, { clientId: 1, salaries: 1 })
      : [];
    const nbParClient = {};
    donnees.forEach(d => {
      nbParClient[(d.clientId || "").toUpperCase()] = Array.isArray(d.salaries) ? d.salaries.length : 0;
    });
    const out = licences.map(l => {
      const o = l.toObject();
      o.nbSalaries = nbParClient[(l.codeClient || "").toUpperCase()] || 0;
      return o;
    });

    res.json({ ok: true, licences: out, nom: req.user.nom || "" });
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
