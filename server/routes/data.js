import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import Donnees from "../models/donnees.js";

const router = express.Router();

/* ── Verrouillage des PIN salariés ──
   Règle : un PIN déjà posé (non vide) est IMMUABLE via les sauvegardes normales.
   On conserve la valeur stockée quelle que soit la valeur entrante (vide OU
   différente) → une session boguée ou une course au chargement ne peut plus
   ni effacer ni modifier un PIN. Un PIN vide accepte une première pose
   (4 chiffres) ; sinon il reste vide. Seule la route /reset-pin (patron) peut
   changer un PIN déjà posé. */
function appliquerVerrouPins(entrants, existants) {
  const parId = new Map();
  (existants || []).forEach(s => { if (s && s.id != null) parId.set(String(s.id), s); });
  return (entrants || []).map(s => {
    if (!s || s.id == null) return s;
    const anc       = parId.get(String(s.id));
    const pinStocke = anc && anc.pin ? String(anc.pin).trim() : "";
    if (pinStocke) return { ...s, pin: pinStocke };          // verrouillé : on garde l'existant
    const pinEntrant = s.pin ? String(s.pin).trim() : "";
    return { ...s, pin: /^\d{4}$/.test(pinEntrant) ? pinEntrant : "" }; // première pose
  });
}

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

/* ── Note de chantier (PC, via token licence) : ajoute une ligne datée/signée ──
   Écriture CIBLÉE ($set sur le seul champ notesChantiers) : n'affecte jamais
   salaries/heures (anti-écrasement, cf. incident). */
function _ligneNoteData(auteur, texte) {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  const sig = auteur ? ` – ${auteur}` : "";
  return `[${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}${sig}] ${texte}`;
}

router.post("/note-chantier", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const chantier = (req.body.chantier || "").trim().toUpperCase();
    const texte    = (req.body.texte || "").toString().trim();
    const auteur   = (req.body.auteur || "Gérant").toString().trim().slice(0, 40);

    if (!chantier || !texte) return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    if (texte.length > 2000)  return res.status(400).json({ ok: false, message: "Note trop longue" });

    let doc = await Donnees.findOne({ clientId });
    if (!doc) {
      const tous = await Donnees.find({});
      doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId) || null;
    }
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const ligne = _ligneNoteData(auteur, texte);
    const notes = doc.notesChantiers || {};
    notes[chantier] = notes[chantier] ? (notes[chantier] + "\n" + ligne) : ligne;

    await Donnees.updateOne(
      { _id: doc._id },
      { $set: { notesChantiers: notes, updatedAt: new Date() } }
    );
    res.json({ ok: true, chantier, note: notes[chantier] });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Sauvegarder toutes les données du client ──
router.post("/", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const attendu  = (req.body.clientIdAttendu || "").toUpperCase();
    if (attendu && attendu !== clientId) {
      return res.status(409).json({ ok: false, message: "Incohérence client : sauvegarde refusée (anti-mélange)" });
    }
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
      const ancsSalaries    = existant.salaries || [];
      existant.clientId     = clientId;          // normalise la casse
      existant.entreprise   = entreprise;
      existant.salaries     = appliquerVerrouPins(salaries, ancsSalaries);
      existant.heures       = heures;
      existant.chantiers    = chantiers;
      existant.previsionnel = previsionnel;
      existant.updatedAt    = new Date();
      existant.markModified("salaries");
      await existant.save();
    } else {
      await Donnees.create({
        clientId, entreprise,
        salaries: appliquerVerrouPins(salaries, []),
        heures, chantiers, previsionnel, updatedAt: new Date()
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Réinitialiser le PIN d'un salarié (patron, jeton licence) ──
// Seule voie autorisée pour changer/effacer un PIN déjà posé (verrouillé).
// body: { salarieId, pin }  → pin = 4 chiffres (nouveau) ou "" (effacement).
router.post("/reset-pin", verifyToken, async (req, res) => {
  try {
    const clientId  = (req.user.clientId || "").toUpperCase();
    const salarieId = req.body.salarieId;
    const pin       = (req.body.pin || "").toString().trim();
    if (salarieId == null)
      return res.status(400).json({ ok: false, message: "salarieId manquant" });
    if (pin && !/^\d{4}$/.test(pin))
      return res.status(400).json({ ok: false, message: "PIN invalide (4 chiffres)" });

    const tous = await Donnees.find({});
    const doc  = tous.find(d => (d.clientId || "").toUpperCase() === clientId);
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal) return res.status(404).json({ ok: false, message: "Salarié introuvable" });

    sal.pin = pin;                     // "" = effacement, sinon nouveau PIN
    doc.markModified("salaries");
    doc.updatedAt = new Date();
    await doc.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Sauvegarder une seule clé (ex: juste "heures") ──
router.patch("/:cle", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const attendu  = (req.body.clientIdAttendu || "").toUpperCase();
    if (attendu && attendu !== clientId) {
      return res.status(409).json({ ok: false, message: "Incohérence client : sauvegarde refusée (anti-mélange)" });
    }
    const { cle }  = req.params;
    const clesAutorisees = ["entreprise", "salaries", "heures", "chantiers", "previsionnel"];
    if (!clesAutorisees.includes(cle))
      return res.status(400).json({ ok: false, message: "Clé non autorisée" });

    let valeur = req.body.valeur;
    // Verrou PIN aussi par cette voie : on ne peut ni effacer ni changer un PIN posé.
    if (cle === "salaries") {
      const tous = await Donnees.find({});
      const doc  = tous.find(d => (d.clientId || "").toUpperCase() === clientId);
      valeur = appliquerVerrouPins(valeur, doc ? (doc.salaries || []) : []);
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

export default router;
