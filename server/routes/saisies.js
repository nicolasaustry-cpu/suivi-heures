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

    // ⚠️ Ne JAMAIS renvoyer les PIN au client. On les strippe avant envoi.
    const salariesSansPin = (doc.salaries || []).map(s => {
      const { pin, ...reste } = s.toObject ? s.toObject() : s;
      return reste;
    });

    res.json({
      ok: true,
      clientId:     doc.clientId,
      salaries:     salariesSansPin,
      previsionnel: doc.previsionnel || {},
      heures:       doc.heures       || {}
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Authentification PIN salarié (par code employé, sans token licence) ──
   Vérification serveur en clair. Les PIN restent en clair côté MongoDB
   mais ne sont jamais envoyés au navigateur (cf. route /connect). */
router.post("/auth-pin", async (req, res) => {
  try {
    const codeEmp   = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId = req.body.salarieId;
    const pin       = (req.body.pin || "").toString().trim();

    if (!codeEmp || !salarieId || !pin)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    if (!/^\d{4}$/.test(pin))
      return res.status(400).json({ ok: false, message: "PIN invalide" });

    const Donnees = (await import("../models/donnees.js")).default;
    const docs = await Donnees.find({});
    const doc  = docs.find(d => (d.entreprise?.codeEmploye || "").trim().toUpperCase() === codeEmp);
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal || !sal.pin) return res.status(401).json({ ok: false, message: "PIN incorrect" });
    if (String(sal.pin) !== pin) return res.status(401).json({ ok: false, message: "PIN incorrect" });

    res.json({ ok: true, salarieId: sal.id, nom: `${sal.prenom} ${sal.nom}` });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Envoyer un chantier (avec code employé) ──
   Upsert par nom : si le chantier existe déjà pour ce jour/salarié, on le met à jour
   (permet la saisie progressive : arrivée seule, puis départ, etc.) */
/* Assainit les photos d'un chantier : images data-URL uniquement, ≤ ~675 Ko chacune, 3 max.
   Renvoie null si rien n'a été envoyé (pour ne pas écraser l'existant à la fusion). */
function assainirPhotos(p) {
  if (p == null) return null;
  if (!Array.isArray(p)) return [];
  return p
    .filter(x => typeof x === "string" && x.startsWith("data:image/") && x.length <= 900000)
    .slice(0, 3);
}

router.post("/envoyer", async (req, res) => {
  try {
    const { codeEmploye, salarieId, salarieNom, date, chantier } = req.body;
    const codeEmp = (codeEmploye || "").trim().toUpperCase();
    if (chantier) chantier.photos = assainirPhotos(chantier.photos);

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
      saisie = new Saisie({
        clientId: doc.clientId, salarieId, salarieNom, date,
        chantiers: [chantier],
        totalMin: (chantier.dureeMin || 0) + (chantier.deplacement || 0),
        statut: "envoyee"
      });
    } else {
      // Chercher si un chantier de même nom existe déjà ce jour-là
      const idx = saisie.chantiers.findIndex(c => (c.nom || "").trim() === (chantier.nom || "").trim());
      if (idx >= 0) {
        // Fusionner : on ne remplace que les champs fournis (non vides)
        const existant = saisie.chantiers[idx];
        saisie.chantiers[idx] = {
          nom:            chantier.nom            || existant.nom,
          heureArrivee:   chantier.heureArrivee   || existant.heureArrivee || "",
          heureDepart:    chantier.heureDepart    || existant.heureDepart  || "",
          dureeMin:       chantier.dureeMin       != null ? chantier.dureeMin       : (existant.dureeMin       || 0),
          deplacement:    chantier.deplacement    != null ? chantier.deplacement    : (existant.deplacement    || 0),
          pause:          chantier.pause          != null ? chantier.pause          : (existant.pause          || 0),
          note:           chantier.note           != null ? chantier.note           : (existant.note           || ""),
          photos:         chantier.photos         != null ? chantier.photos         : (existant.photos         || []),
          isPrevisionnel: chantier.isPrevisionnel != null ? chantier.isPrevisionnel : (existant.isPrevisionnel || false)
        };
      } else {
        saisie.chantiers.push(chantier);
      }
      saisie.totalMin = saisie.chantiers.reduce((s, c) => s + (c.dureeMin || 0) + (c.deplacement || 0), 0);
      saisie.updatedAt = new Date();
    }

    await saisie.save();
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Récupérer les saisies déjà envoyées d'un salarié pour une date donnée
   (route mobile : utilise le code employé, pas de token licence) ── */
router.post("/mobile-day", async (req, res) => {
  try {
    const codeEmp   = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId = req.body.salarieId;
    const date      = req.body.date; // "YYYY-MM-DD"

    if (!codeEmp || !salarieId || !date)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });

    const Donnees = (await import("../models/donnees.js")).default;
    const docs = await Donnees.find({});
    const doc  = docs.find(d => (d.entreprise?.codeEmploye || "").trim().toUpperCase() === codeEmp);
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    const saisie = await Saisie.findOne({ clientId: doc.clientId, salarieId, date });
    res.json({ ok: true, saisie: saisie || null });
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

/* ── Liste des mois (YYYY-MM) ayant au moins une saisie pour ce client.
   ⚠ DOIT être déclarée AVANT /:mois (sinon Express matchera /:mois avec mois="mois-list") */
router.get("/mois-list", verifyToken, async (req, res) => {
  try {
    const saisies = await Saisie.find({ clientId: req.user.clientId }, "date").lean();
    const mois = new Set();
    saisies.forEach(s => {
      if (typeof s.date === 'string' && s.date.length >= 7) {
        mois.add(s.date.substring(0, 7));  // 'YYYY-MM'
      }
    });
    res.json({ ok: true, mois: [...mois].sort() });
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

/* ── Modifier un chantier d'une saisie (patron uniquement) ── */
router.patch("/:id/chantier/:idx", verifyToken, async (req, res) => {
  try {
    const saisie = await Saisie.findById(req.params.id);
    if (!saisie) return res.status(404).json({ ok: false, message: "Saisie introuvable" });
    if (saisie.clientId !== req.user.clientId)
      return res.status(403).json({ ok: false, message: "Accès refusé" });

    const idx = parseInt(req.params.idx);
    if (isNaN(idx) || idx < 0 || idx >= saisie.chantiers.length)
      return res.status(400).json({ ok: false, message: "Index chantier invalide" });

    const c = saisie.chantiers[idx];
    const body = req.body || {};
    if (body.nom != null)          c.nom          = String(body.nom).trim();
    if (body.heureArrivee != null) c.heureArrivee = String(body.heureArrivee);
    if (body.heureDepart != null)  c.heureDepart  = String(body.heureDepart);
    if (body.deplacement != null)  c.deplacement  = parseInt(body.deplacement) || 0;
    if (body.pause != null)        c.pause        = parseInt(body.pause) || 0;

    // Recalculer dureeMin (pause déduite) si les heures changent
    if (c.heureArrivee && c.heureDepart) {
      const [h1, m1] = c.heureArrivee.split(':').map(Number);
      const [h2, m2] = c.heureDepart.split(':').map(Number);
      c.dureeMin = Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1) - (c.pause || 0));
    } else {
      c.dureeMin = 0;
    }

    // Recalculer totalMin de la saisie
    saisie.totalMin = saisie.chantiers.reduce((sum, x) => sum + (x.dureeMin || 0) + (x.deplacement || 0), 0);
    saisie.updatedAt = new Date();
    await saisie.save();
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Supprimer un chantier d'une saisie (patron uniquement).
   Si c'est le dernier chantier, supprime toute la saisie. ── */
router.delete("/:id/chantier/:idx", verifyToken, async (req, res) => {
  try {
    const saisie = await Saisie.findById(req.params.id);
    if (!saisie) return res.status(404).json({ ok: false, message: "Saisie introuvable" });
    if (saisie.clientId !== req.user.clientId)
      return res.status(403).json({ ok: false, message: "Accès refusé" });

    const idx = parseInt(req.params.idx);
    if (isNaN(idx) || idx < 0 || idx >= saisie.chantiers.length)
      return res.status(400).json({ ok: false, message: "Index chantier invalide" });

    saisie.chantiers.splice(idx, 1);

    if (saisie.chantiers.length === 0) {
      // Plus aucun chantier : on supprime la saisie complète
      await saisie.deleteOne();
      return res.json({ ok: true, supprimee: true });
    }

    // Recalculer totalMin
    saisie.totalMin = saisie.chantiers.reduce((sum, x) => sum + (x.dureeMin || 0) + (x.deplacement || 0), 0);
    saisie.updatedAt = new Date();
    await saisie.save();
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Marquer / démarquer une note comme « réalisée »
router.post("/note-statut", verifyToken, async (req, res) => {
  try {
    const clientId  = req.user.clientId;
    const { date, chantier } = req.body;
    const salarieId = Number(req.body.salarieId);
    const faite = !!req.body.faite;
    if (!date || !chantier || !salarieId)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    const saisie = await Saisie.findOne({ clientId, salarieId, date });
    if (!saisie) return res.status(404).json({ ok: false, message: "Saisie introuvable" });
    const c = (saisie.chantiers || []).find(x => x.nom === chantier);
    if (!c) return res.status(404).json({ ok: false, message: "Chantier introuvable" });
    c.noteFaite = faite;
    saisie.markModified("chantiers");
    await saisie.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Supprimer une note : vide le texte + photos, conserve les heures du chantier
router.post("/note-supprimer", verifyToken, async (req, res) => {
  try {
    const clientId  = req.user.clientId;
    const { date, chantier } = req.body;
    const salarieId = Number(req.body.salarieId);
    if (!date || !chantier || !salarieId)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    const saisie = await Saisie.findOne({ clientId, salarieId, date });
    if (!saisie) return res.status(404).json({ ok: false, message: "Saisie introuvable" });
    const c = (saisie.chantiers || []).find(x => x.nom === chantier);
    if (!c) return res.status(404).json({ ok: false, message: "Chantier introuvable" });
    c.note = "";
    c.photos = [];
    c.noteFaite = false;
    saisie.markModified("chantiers");
    await saisie.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
