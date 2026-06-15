import express from "express";
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js";
import Licence from "../models/licence.js";
import Donnees from "../models/donnees.js";
import Prescripteur from "../models/prescripteur.js";

const router = express.Router();

// ── Lister toutes les licences ──
router.get("/licences", verifyToken, verifyAdmin, async (req, res) => {
  const licences = await Licence.find().sort({ dateActivation: -1 });
  res.json({ ok: true, licences });
});

// ── Créer une licence ──
router.post("/licences", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { codeClient, nomClient, email, dateExpiration, notes, type, prescripteur } = req.body;
    if (!codeClient || !dateExpiration)
      return res.status(400).json({ ok: false, message: "Code et date d'expiration requis" });

    const licence = new Licence({
      codeClient: codeClient.toUpperCase().trim(),
      nomClient, email, notes,
      type: type || "standard",
      prescripteur: (prescripteur || "").toUpperCase().trim(),
      dateExpiration: new Date(dateExpiration),
      actif: true
    });
    await licence.save();
    res.status(201).json({ ok: true, licence });
  } catch (err) {
    if (err.code === 11000)
      return res.status(400).json({ ok: false, message: "Ce code existe déjà" });
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Modifier une licence ──
router.put("/licences/:code", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const licence = await Licence.findOne({ codeClient: req.params.code.toUpperCase() });
    if (!licence) return res.status(404).json({ ok: false, message: "Licence introuvable" });

    const { nomClient, email, dateExpiration, notes, type, prescripteur } = req.body;
    if (nomClient)              licence.nomClient      = nomClient;
    if (email)               licence.email          = email;
    if (dateExpiration)      licence.dateExpiration = new Date(dateExpiration);
    if (notes !== undefined) licence.notes          = notes;
    if (type)                   licence.type           = type;
    if (prescripteur !== undefined) licence.prescripteur = (prescripteur || "").toUpperCase().trim();
    await licence.save();
    res.json({ ok: true, licence });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Activer / désactiver une licence ──
router.patch("/licences/:code/toggle", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const licence = await Licence.findOne({ codeClient: req.params.code.toUpperCase() });
    if (!licence) return res.status(404).json({ ok: false, message: "Licence introuvable" });
    licence.actif = !licence.actif;
    await licence.save();
    res.json({ ok: true, actif: licence.actif });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Supprimer une licence (et ses données) ──
router.delete("/licences/:code", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    await Licence.deleteOne({ codeClient: code });
    await Donnees.deleteOne({ clientId: code });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Stats ──
router.get("/stats", verifyToken, verifyAdmin, async (req, res) => {
  const total  = await Licence.countDocuments();
  const actifs = await Licence.countDocuments({ actif: true });
  const expires = await Licence.countDocuments({ dateExpiration: { $lt: new Date() } });
  res.json({ ok: true, total, actifs, expires });
});

// ── Export complet "fin de licence" d'un client (toutes les données) ──
router.get("/export/:code", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const licence = await Licence.findOne({ codeClient: code });
    let donnees = await Donnees.findOne({ clientId: code });
    // Compatibilité : document éventuellement enregistré dans une autre casse
    if (!donnees) {
      const tous = await Donnees.find({});
      donnees = tous.find(d => (d.clientId || "").toUpperCase() === code) || null;
    }
    // Planning réalisé : saisies du client, quelle que soit la casse du clientId
    const Saisie = (await import("../models/saisies.js")).default;
    let saisies = await Saisie.find({ clientId: code }).sort({ date: 1, salarieId: 1 });
    if (!saisies || saisies.length === 0) {
      const toutesSaisies = await Saisie.find({});
      saisies = toutesSaisies
        .filter(s => (s.clientId || "").toUpperCase() === code)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }

    res.json({
      ok: true,
      code,
      licence: licence ? {
        nomClient: licence.nomClient,
        email: licence.email,
        type: licence.type,
        dateExpiration: licence.dateExpiration,
        actif: licence.actif
      } : null,
      entreprise:   donnees?.entreprise   || {},
      salaries:     donnees?.salaries     || [],
      heures:       donnees?.heures       || {},   // planning prévisionnel (cases)
      chantiers:    donnees?.chantiers    || [],
      previsionnel: donnees?.previsionnel || {},
      saisies:      saisies || []                   // planning réalisé
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ════════════════ GESTION DES PRESCRIPTEURS ════════════════

// ── Lister les prescripteurs (sans le mot de passe) ──
router.get("/prescripteurs", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const presc = await Prescripteur.find().select("-motDePasse").sort({ dateCreation: -1 });
    res.json({ ok: true, prescripteurs: presc });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Créer un prescripteur ──
router.post("/prescripteurs", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { identifiant, motDePasse, nom } = req.body;
    if (!identifiant || !motDePasse)
      return res.status(400).json({ ok: false, message: "Identifiant et mot de passe requis" });
    const presc = new Prescripteur({ identifiant: identifiant.toUpperCase().trim(), motDePasse, nom: nom || "" });
    await presc.save();
    res.status(201).json({ ok: true, prescripteur: { identifiant: presc.identifiant, nom: presc.nom, actif: presc.actif } });
  } catch (err) {
    if (err.code === 11000)
      return res.status(400).json({ ok: false, message: "Cet identifiant existe déjà" });
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Modifier un prescripteur (nom et/ou mot de passe) ──
router.put("/prescripteurs/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const presc = await Prescripteur.findOne({ identifiant: req.params.id.toUpperCase() });
    if (!presc) return res.status(404).json({ ok: false, message: "Prescripteur introuvable" });
    const { nom, motDePasse } = req.body;
    if (nom !== undefined) presc.nom = nom;
    if (motDePasse)        presc.motDePasse = motDePasse;   // re-haché par le hook pre-save
    await presc.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Activer / désactiver un prescripteur ──
router.patch("/prescripteurs/:id/toggle", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const presc = await Prescripteur.findOne({ identifiant: req.params.id.toUpperCase() });
    if (!presc) return res.status(404).json({ ok: false, message: "Prescripteur introuvable" });
    presc.actif = !presc.actif;
    await presc.save();
    res.json({ ok: true, actif: presc.actif });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Supprimer un prescripteur ──
router.delete("/prescripteurs/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    await Prescripteur.deleteOne({ identifiant: req.params.id.toUpperCase() });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
