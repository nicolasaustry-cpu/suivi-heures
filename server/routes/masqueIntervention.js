// ─────────────────────────────────────────────────────────────
// routes/masqueIntervention.js — Masques de bons d'intervention (espace client)
// ─────────────────────────────────────────────────────────────
// Un masque définit la structure d'un bon d'intervention (liste de champs).
// Le client crée/modifie/supprime ses propres masques depuis son espace de
// gestion (PC), avec le même schéma d'auth que routes/data.js.
//
// Endpoints :
//   GET    /api/masques-intervention       → liste des masques du client
//   POST   /api/masques-intervention       → créer un masque
//   PUT    /api/masques-intervention/:id   → modifier un masque
//   DELETE /api/masques-intervention/:id   → supprimer un masque
// ─────────────────────────────────────────────────────────────

import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import MasqueIntervention from "../models/masqueIntervention.js";
import Donnees from "../models/donnees.js";
import { MODELES as MODELES_CERFA, listeModeles } from "../cerfa/index.js";
import { MODELES_MASQUES } from "../data/modelesMasques.js";

const router = express.Router();

const TYPES_CHAMPS = ["texte", "case", "liste", "cases_multiples", "photo", "signature", "datetime"];
const AUTOS_VALIDES = ["", "date", "heureDebut", "heureFin", "duree"];
const MAX_CHAMPS = 60;

/* Bloque l'accès si le client n'a pas activé la fonctionnalité depuis la
   page Entreprise (entreprisedata.bonsInterventionActifs). Sécurité côté
   serveur en complément du masquage du menu côté client. */
async function verifierFonctionActive(req, res, next) {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const doc = await Donnees.findOne({ clientId }, "entreprise");
    if (!doc?.entreprise?.bonsInterventionActifs) {
      // 409 et non 403 : sync.js déconnecte sur tout 401/403 d'une route /api/.
      return res.status(409).json({ ok: false, inactif: true, message: "Les bons d'intervention ne sont pas activés pour votre entreprise. Activez-les sur la page Entreprise." });
    }
    next();
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
}

/* Valide et nettoie un tableau de champs envoyé par le client.
   Renvoie { champs } ou { err: message }. */
function assainirChamps(brut) {
  if (!Array.isArray(brut)) return { err: "Liste de champs invalide" };
  if (brut.length > MAX_CHAMPS) return { err: `Trop de champs (max ${MAX_CHAMPS})` };

  const vus = new Set();
  const champs = [];
  for (const c of brut) {
    const id = String(c?.id || "").trim();
    const libelle = String(c?.libelle || "").trim().slice(0, 200);
    const type = String(c?.type || "").trim();
    if (!id || !libelle) return { err: "Champ incomplet (id ou libellé manquant)" };
    if (vus.has(id)) return { err: `Identifiant de champ en double : ${id}` };
    if (!TYPES_CHAMPS.includes(type)) return { err: `Type de champ invalide : ${type}` };

    const auto = String(c?.auto || "");
    if (type === "datetime" && !AUTOS_VALIDES.includes(auto))
      return { err: `Valeur "auto" invalide pour le champ ${id}` };

    let options = [];
    if (type === "liste" || type === "cases_multiples") {
      options = Array.isArray(c?.options)
        ? c.options.map(o => String(o).trim().slice(0, 100)).filter(Boolean).slice(0, 50)
        : [];
      if (!options.length) return { err: `Le champ "${libelle}" doit avoir au moins une option` };
    }

    vus.add(id);
    champs.push({
      id,
      libelle,
      type,
      obligatoire: !!c?.obligatoire,
      dictee: type === "texte" ? !!c?.dictee : false,
      signataire: type === "signature" ? (c?.signataire === "client" ? "client" : "salarie") : "salarie",
      options,
      auto: type === "datetime" ? auto : ""
    });
  }
  return { champs };
}

const cerfaValide = v => (MODELES_CERFA[String(v || "")] ? String(v) : "");

// ── CERFA proposables sur un masque ──
router.get("/cerfa-modeles", verifyToken, verifierFonctionActive, (req, res) => {
  res.json({ ok: true, modeles: listeModeles() });
});

// ── Masques prêts à l'emploi (catalogue) ──
router.get("/modeles-prets", verifyToken, verifierFonctionActive, (req, res) => {
  res.json({ ok: true, modeles: MODELES_MASQUES.map(m => ({ code: m.code, nom: m.nom, description: m.description, nbChamps: m.champs.length, cerfa: m.cerfa || "" })) });
});

// ── Ajouter un masque depuis le catalogue (copie modifiable) ──
router.post("/depuis-modele", verifyToken, verifierFonctionActive, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const modele = MODELES_MASQUES.find(m => m.code === String(req.body.code || ""));
    if (!modele) return res.status(404).json({ ok: false, message: "Modèle inconnu" });
    const { champs, err } = assainirChamps(modele.champs);
    if (err) return res.status(500).json({ ok: false, message: err });
    // Nom unique : « Entretien … (2) » si le client l'a déjà ajouté
    const existants = new Set((await MasqueIntervention.find({ clientId }, "nom").lean()).map(m => m.nom));
    let nom = modele.nom, k = 2;
    while (existants.has(nom)) nom = `${modele.nom} (${k++})`;
    const masque = await MasqueIntervention.create({
      clientId, nom, champs, actif: true, cerfa: cerfaValide(modele.cerfa), creeLe: new Date(), modifieLe: new Date()
    });
    res.json({ ok: true, masque });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Liste des masques du client ──
router.get("/", verifyToken, verifierFonctionActive, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const masques = await MasqueIntervention.find({ clientId }).sort({ creeLe: -1 });
    res.json({ ok: true, masques });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Créer un masque ──
router.post("/", verifyToken, verifierFonctionActive, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const nom = String(req.body.nom || "").trim().slice(0, 150);
    if (!nom) return res.status(400).json({ ok: false, message: "Nom du masque requis" });

    const { champs, err } = assainirChamps(req.body.champs || []);
    if (err) return res.status(400).json({ ok: false, message: err });

    const masque = await MasqueIntervention.create({
      clientId, nom, champs, actif: true, cerfa: cerfaValide(req.body.cerfa), creeLe: new Date(), modifieLe: new Date()
    });
    res.json({ ok: true, masque });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Modifier un masque (nom, champs, actif) ──
router.put("/:id", verifyToken, verifierFonctionActive, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const masque = await MasqueIntervention.findById(req.params.id);
    if (!masque) return res.status(404).json({ ok: false, message: "Masque introuvable" });
    if ((masque.clientId || "").toUpperCase() !== clientId)
      return res.status(404).json({ ok: false, message: "Masque introuvable" });

    if (req.body.nom !== undefined) {
      const nom = String(req.body.nom || "").trim().slice(0, 150);
      if (!nom) return res.status(400).json({ ok: false, message: "Nom du masque requis" });
      masque.nom = nom;
    }
    if (req.body.champs !== undefined) {
      const { champs, err } = assainirChamps(req.body.champs);
      if (err) return res.status(400).json({ ok: false, message: err });
      masque.champs = champs;
      masque.markModified("champs");
    }
    if (req.body.actif !== undefined) masque.actif = !!req.body.actif;
    if (req.body.cerfa !== undefined) masque.cerfa = cerfaValide(req.body.cerfa);

    masque.modifieLe = new Date();
    await masque.save();
    res.json({ ok: true, masque });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Supprimer un masque ──
router.delete("/:id", verifyToken, verifierFonctionActive, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const masque = await MasqueIntervention.findById(req.params.id);
    if (!masque) return res.json({ ok: true, supprime: false });
    if ((masque.clientId || "").toUpperCase() !== clientId)
      return res.status(404).json({ ok: false, message: "Masque introuvable" });

    await masque.deleteOne();
    res.json({ ok: true, supprime: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
