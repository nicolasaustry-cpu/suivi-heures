import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import Donnees from "../models/donnees.js";
import Licence from "../models/licence.js";
import Saisie from "../models/saisies.js";
import OrdreMobile from "../models/ordremobile.js";

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
    // Marque blanche : flag + logo du prescripteur, livrés à chaque chargement
    const licence = await Licence.findOne({ codeClient: clientId });
    res.json({
      ok: true,
      data: doc,
      marquePartenaire: licence ? !!licence.marquePartenaire : false,
      logoPartenaire:   licence ? (licence.logoPartenaire || "") : ""
    });
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

/* Assainit les photos d'un chantier : images data-URL uniquement, ≤ ~675 Ko chacune, 3 max.
   Renvoie null si rien n'a été fourni (pour ne pas écraser l'existant). */
function _assainirPhotosData(p) {
  if (p == null) return null;
  if (!Array.isArray(p)) return [];
  return p
    .filter(x => typeof x === "string" && x.startsWith("data:image/") && x.length <= 900000)
    .slice(0, 3);
}

router.post("/note-chantier", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const chantier = (req.body.chantier || "").trim().toUpperCase();
    const mode     = (req.body.mode || "ajouter").toString();
    const texteRaw = (req.body.texte || "").toString();
    const auteur   = (req.body.auteur || "Gérant").toString().trim().slice(0, 40);
    const photos   = _assainirPhotosData(req.body.photos);   // null = non fourni ; [] = effacer ; [...] = remplacer

    if (!chantier) return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    if (texteRaw.length > 10000) return res.status(400).json({ ok: false, message: "Note trop longue" });

    let doc = await Donnees.findOne({ clientId });
    if (!doc) {
      const tous = await Donnees.find({});
      doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId) || null;
    }
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const update = { updatedAt: new Date() };
    const notes  = doc.notesChantiers || {};

    if (mode === "remplacer") {
      // Remplace tout le bloc (modif / suppression ligne par ligne côté client).
      const bloc = texteRaw.replace(/\s+$/g, "");
      if (bloc.trim()) notes[chantier] = bloc;
      else delete notes[chantier];            // plus aucune ligne → on retire la note
      update.notesChantiers = notes;
    } else {
      // Ajout d'une ligne datée/signée (comportement existant).
      const texte = texteRaw.trim();
      if (!texte && photos === null)
        return res.status(400).json({ ok: false, message: "Note ou photo requise" });
      if (texte) {
        const ligne = _ligneNoteData(auteur, texte);
        notes[chantier] = notes[chantier] ? (notes[chantier] + "\n" + ligne) : ligne;
        update.notesChantiers = notes;
      }
    }

    // Photos : on REMPLACE le jeu de photos du chantier (si un tableau est fourni)
    const np = doc.notesChantiersPhotos || {};
    let notePhotos = np[chantier] || [];
    if (photos !== null) {
      if (photos.length) np[chantier] = photos;
      else delete np[chantier];
      update.notesChantiersPhotos = np;
      notePhotos = photos;
    }

    await Donnees.updateOne(
      { _id: doc._id },
      { $set: update }
    );
    res.json({ ok: true, chantier, note: notes[chantier] || "", photos: notePhotos });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Coordonnées d'un chantier (PC, via token licence) : écriture ciblée ──
router.post("/coordonnees-chantier", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const chantier = (req.body.chantier || "").trim().toUpperCase();
    const c = req.body.coordonnees || {};
    if (!chantier) return res.status(400).json({ ok: false, message: "Paramètres manquants" });

    let doc = await Donnees.findOne({ clientId });
    if (!doc) {
      const tous = await Donnees.find({});
      doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId) || null;
    }
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const coords = doc.coordonneesChantiers || {};
    const clean = {
      adresse: String(c.adresse || "").slice(0, 500),
      ville:   String(c.ville   || "").slice(0, 200),
      mobile:  String(c.mobile  || "").slice(0, 40),
      fixe:    String(c.fixe    || "").slice(0, 40)
    };
    const vide = !clean.adresse && !clean.ville && !clean.mobile && !clean.fixe;
    if (vide) delete coords[chantier]; else coords[chantier] = clean;

    await Donnees.updateOne({ _id: doc._id }, { $set: { coordonneesChantiers: coords, updatedAt: new Date() } });
    res.json({ ok: true, chantier, coordonnees: coords[chantier] || null });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Renommer un chantier PARTOUT (historique inclus) : opération transversale ──
router.post("/renommer-chantier", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const U = s => String(s == null ? "" : s).trim().toUpperCase();
    const ancien  = U(req.body.ancien);
    const nouveau = U(req.body.nouveau);
    if (!ancien || !nouveau) return res.status(400).json({ ok: false, message: "Ancien et nouveau nom requis" });
    if (ancien === nouveau)  return res.status(400).json({ ok: false, message: "Le nouveau nom est identique à l'ancien" });

    let doc = await Donnees.findOne({ clientId });
    if (!doc) {
      const tous = await Donnees.find({});
      doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId) || null;
    }
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const rapport = { heures: 0, previsionnel: 0, notes: false, coordonnees: false, chantiers: false, saisies: 0, ordreMobile: 0 };

    // 1) Heures du planning
    const heures = doc.heures || {};
    for (const k of Object.keys(heures)) {
      const e = heures[k];
      if (e && U(e.chantier) === ancien) { e.chantier = nouveau; rapport.heures++; }
    }

    // 2) Prévisionnel : { "YYYY-MM": { chantiers: [{ client, hPrevues, ... }] } }
    const prev = doc.previsionnel || {};
    for (const mois of Object.keys(prev)) {
      const dm = prev[mois];
      if (!dm || !Array.isArray(dm.chantiers)) continue;
      const cibles = dm.chantiers.filter(c => U(c.client) === ancien);
      if (!cibles.length) continue;
      const dejaNouveau = dm.chantiers.find(c => U(c.client) === nouveau);
      if (dejaNouveau) { // fusion des heures prévues du mois
        cibles.forEach(c => { dejaNouveau.hPrevues = (parseFloat(dejaNouveau.hPrevues) || 0) + (parseFloat(c.hPrevues) || 0); });
        dm.chantiers = dm.chantiers.filter(c => U(c.client) !== ancien);
      } else {
        cibles.forEach(c => { c.client = nouveau; });
      }
      rapport.previsionnel += cibles.length;
    }

    // 3) Notes (fusion si le nouveau nom a déjà des notes)
    const notes = doc.notesChantiers || {};
    if (notes[ancien] != null) {
      notes[nouveau] = notes[nouveau] ? (notes[nouveau] + "\n" + notes[ancien]) : notes[ancien];
      delete notes[ancien];
      rapport.notes = true;
      doc.notesChantiers = notes;
    }

    // 4) Coordonnées (on conserve celles du nouveau si elles existent déjà)
    const coords = doc.coordonneesChantiers || {};
    if (coords[ancien] != null) {
      if (coords[nouveau] == null) coords[nouveau] = coords[ancien];
      delete coords[ancien];
      rapport.coordonnees = true;
      doc.coordonneesChantiers = coords;
    }

    // 5) Liste des chantiers (tableau de noms, dédupliqué)
    if (Array.isArray(doc.chantiers)) {
      const avant = JSON.stringify(doc.chantiers);
      const vus = new Set();
      doc.chantiers = doc.chantiers
        .map(c => (U(c) === ancien ? nouveau : c))
        .filter(c => { const u = U(c); if (vus.has(u)) return false; vus.add(u); return true; });
      rapport.chantiers = (JSON.stringify(doc.chantiers) !== avant);
    }

    doc.markModified("heures");
    doc.markModified("previsionnel");
    doc.markModified("notesChantiers");
    doc.markModified("coordonneesChantiers");
    doc.markModified("chantiers");
    doc.updatedAt = new Date();
    await doc.save();

    // 6) Saisies (heures réalisées)
    const saisies = await Saisie.find({ clientId: doc.clientId });
    for (const s of saisies) {
      let modif = false;
      (s.chantiers || []).forEach(ch => { if (U(ch.nom) === ancien) { ch.nom = nouveau; modif = true; } });
      if (modif) { s.markModified("chantiers"); s.updatedAt = new Date(); await s.save(); rapport.saisies++; }
    }

    // 7) Ordre mobile des chantiers
    const om = await OrdreMobile.findOne({ clientId: doc.clientId });
    if (om && om.ordres) {
      let modif = false;
      for (const k of Object.keys(om.ordres)) {
        const arr = om.ordres[k];
        if (!Array.isArray(arr)) continue;
        const vus = new Set(); const nouv = [];
        arr.forEach(n => {
          if (U(n) === ancien) modif = true;
          const v = (U(n) === ancien) ? nouveau : n;
          const u = U(v);
          if (!vus.has(u)) { vus.add(u); nouv.push(v); }
        });
        om.ordres[k] = nouv;
      }
      if (modif) { om.markModified("ordres"); om.updatedAt = new Date(); await om.save(); rapport.ordreMobile = 1; }
    }

    res.json({ ok: true, ancien, nouveau, rapport });
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
