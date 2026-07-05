import express from "express";
import crypto from "crypto";
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js";
import Signature from "../models/signature.js";

const router = express.Router();

/*
 * Signature électronique simple (SES) d'un contrat de licence.
 *  - L'admin crée une demande (conditions figées) → renvoie un lien unique.
 *  - Le client ouvre le lien (public), lit le contrat, coche « Lu et approuvé »,
 *    tape son nom et signe → le serveur enregistre le dossier de preuve.
 */

// Empreinte SHA-256 des conditions figées (garantit l'intégrité du contrat).
// La version du gabarit ("v1") est incluse : si le modèle de contrat évolue,
// l'empreinte change et reste traçable.
function empreinteContrat(c = {}) {
  const canon = [
    "SUIVHEURES-CONTRAT-LICENCE-v1",
    c.raisonSociale, c.formeJuridique, c.capital, c.siren, c.greffe, c.adresseSiege,
    c.representantCivilite, c.representantNom, c.representantQualite,
    c.formule, c.effectif, c.forfaitHT, c.forfaitTTC, c.fraisOuvertureHT, c.fraisOuvertureTTC,
    c.villeSignature, c.dateContrat
  ].join("|");
  return crypto.createHash("sha256").update(canon, "utf8").digest("hex");
}

// Adresse IP réelle du signataire (Railway place un proxy devant l'app).
function ipReelle(req) {
  return (req.headers["x-forwarded-for"] || "").split(",")[0].trim()
    || req.socket?.remoteAddress
    || "";
}

// ─────────────────────────────────────────────────────────────
//  CÔTÉ ADMIN (protégé)
// ─────────────────────────────────────────────────────────────

// ── Lister les demandes de signature ──
router.get("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const demandes = await Signature.find().sort({ creeLe: -1 });
    res.json({ ok: true, demandes });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Créer une demande de signature (conditions figées) ──
router.post("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { contrat = {}, signataire = {}, codeClient = "" } = req.body;
    if (!contrat.raisonSociale)
      return res.status(400).json({ ok: false, message: "Raison sociale du client requise" });
    if (!signataire.nom)
      return res.status(400).json({ ok: false, message: "Nom du signataire requis" });

    const demande = new Signature({
      codeClient,
      contrat,
      signataire: { nom: signataire.nom, email: signataire.email || "" },
      documentHash: empreinteContrat(contrat),   // figée dès la création
      creePar: req.user?.nom || req.user?.codeClient || "admin"
    });
    await demande.save();

    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    const lien  = `${proto}://${req.get("host")}/signer/${demande.token}`;
    res.status(201).json({ ok: true, token: demande.token, lien, demande });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  CÔTÉ CLIENT (public — le jeton de 48 caractères fait office de secret)
// ─────────────────────────────────────────────────────────────

// ── Récupérer le contrat à afficher pour signature ──
router.get("/:token", async (req, res) => {
  try {
    const d = await Signature.findOne({ token: req.params.token });
    if (!d) return res.status(404).json({ ok: false, message: "Lien de signature inconnu" });

    // Expiration à la volée
    let statut = d.statut;
    if (statut === "en_attente" && d.expireLe && d.expireLe < new Date()) statut = "expire";

    res.json({
      ok: true,
      statut,
      contrat: d.contrat,
      signataire: { nom: d.signataire?.nom || "" },
      documentHash: d.documentHash,
      signeLe: d.preuve?.signeLe || null
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Enregistrer la signature (constitue le dossier de preuve) ──
router.post("/:token/signer", async (req, res) => {
  try {
    const d = await Signature.findOne({ token: req.params.token });
    if (!d) return res.status(404).json({ ok: false, message: "Lien de signature inconnu" });

    if (d.statut !== "en_attente")
      return res.status(409).json({ ok: false, message: "Ce contrat n'est plus en attente de signature" });
    if (d.expireLe && d.expireLe < new Date()) {
      d.statut = "expire"; await d.save();
      return res.status(410).json({ ok: false, message: "Le délai de signature est dépassé" });
    }

    const nomTape = (req.body.nomTape || "").trim();
    if (!req.body.consentement)
      return res.status(400).json({ ok: false, message: "Vous devez cocher « Lu et approuvé »" });
    if (!nomTape)
      return res.status(400).json({ ok: false, message: "Veuillez saisir votre nom" });

    d.statut = "signe";
    d.preuve = {
      nomTape,
      consentement: true,
      signeLe: new Date(),
      ip: ipReelle(req),
      userAgent: (req.headers["user-agent"] || "").slice(0, 400)
    };
    // On refige l'empreinte à partir des conditions stockées (source de vérité serveur)
    d.documentHash = empreinteContrat(d.contrat);
    await d.save();

    res.json({ ok: true, signeLe: d.preuve.signeLe, documentHash: d.documentHash });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Refuser de signer ──
router.post("/:token/refuser", async (req, res) => {
  try {
    const d = await Signature.findOne({ token: req.params.token });
    if (!d) return res.status(404).json({ ok: false, message: "Lien de signature inconnu" });
    if (d.statut !== "en_attente")
      return res.status(409).json({ ok: false, message: "Ce contrat n'est plus en attente" });

    d.statut = "refuse";
    await d.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
