import express from "express";
import crypto from "crypto";
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js";
import Signature from "../models/signature.js";
import { envoyerMailSignatureVolitis, envoyerMailSignatureClient } from "../services/mail.js";

const router = express.Router();

/*
 * Signature électronique simple (SES) d'un contrat de licence.
 *  - L'admin crée une demande (conditions figées) → renvoie un lien unique.
 *  - OU le prospect passe commande lui-même (commander.html → POST /commande) :
 *    le serveur recalcule le prix, fige le contrat et renvoie le même type de lien.
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
//  COMMANDE EN LIGNE (public — appelée par commander.html)
// ─────────────────────────────────────────────────────────────

// Grille tarifaire (Annexe 1). Le prix est TOUJOURS recalculé ici :
// le navigateur n'envoie que la formule et l'effectif, jamais un montant.
const TVA = 0.20;
function tarifPlus(e) { if (e <= 4) return 8; if (e <= 8) return 7; if (e <= 15) return 6; return 5; }
const arrondi2 = n => Math.round(n * 100) / 100;

function conditionsFinancieres(formule, effectif) {
  const plus = formule === "Plus";
  const eff = plus ? effectif : 0;
  const forfaitHT = plus ? eff * tarifPlus(eff) * 6 : 90;   // Standard : 15 € HT × 6 mois
  return {
    formule: plus ? "Plus" : "Standard",
    effectif: eff,
    forfaitHT,
    forfaitTTC: arrondi2(forfaitHT * (1 + TVA)),
    fraisOuvertureHT: plus ? 150 : 0,
    fraisOuvertureTTC: plus ? 180 : 0
  };
}

// Texte nettoyé : sans caractères de contrôle, espaces superflus retirés, longueur bornée
const texte = (v, max = 200) => String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// SIREN valide = 9 chiffres + clé de Luhn (exception connue : La Poste, 356 000 000)
function sirenValide(siren) {
  if (!/^\d{9}$/.test(siren)) return false;
  if (siren === "356000000") return true;
  let somme = 0;
  for (let i = 0; i < 9; i++) {
    let n = Number(siren[i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    somme += n;
  }
  return somme % 10 === 0;
}

const emailValide = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

// Anti-abus : 5 commandes maximum par adresse IP et par heure (mémoire du serveur)
const _commandesParIp = new Map();
const LIMITE_COMMANDES = 5;
const FENETRE_MS = 60 * 60 * 1000;
function quotaAtteint(ip) {
  const maintenant = Date.now();
  const recents = (_commandesParIp.get(ip) || []).filter(t => maintenant - t < FENETRE_MS);
  _commandesParIp.set(ip, recents);
  return recents.length >= LIMITE_COMMANDES;
}
function noterCommande(ip) {
  if (_commandesParIp.size > 5000) _commandesParIp.clear();   // garde-fou mémoire
  (_commandesParIp.get(ip) || _commandesParIp.set(ip, []).get(ip)).push(Date.now());
}

// ── Créer une demande de signature depuis la page de commande ──
router.post("/commande", async (req, res) => {
  try {
    const ip = ipReelle(req);
    if (quotaAtteint(ip))
      return res.status(429).json({ ok: false, message: "Trop de commandes envoyées depuis cette connexion. Réessayez dans une heure ou écrivez à contact@volitis.net." });

    const b = req.body || {};
    const e = b.entreprise || {};

    const raisonSociale  = texte(e.raisonSociale);
    const sirenChiffres  = String(e.siren || "").replace(/\D/g, "");
    const representantNom = texte(e.representantNom, 120);
    const email          = texte(b.email, 160).toLowerCase();
    const formule        = b.formule === "Plus" ? "Plus" : (b.formule === "Standard" ? "Standard" : "");
    const effectif       = parseInt(b.effectif, 10);

    const manque = [];
    if (!raisonSociale) manque.push("la raison sociale");
    if (!sirenValide(sirenChiffres)) manque.push("un SIREN valide (9 chiffres)");
    if (!representantNom) manque.push("le nom du représentant");
    if (!emailValide(email)) manque.push("une adresse e-mail valide");
    if (!formule) manque.push("la formule");
    if (formule === "Plus" && !(effectif >= 1 && effectif <= 500)) manque.push("l'effectif (1 à 500 salariés)");
    if (manque.length)
      return res.status(400).json({ ok: false, message: "Merci d'indiquer " + manque.join(", ") + "." });

    // Code d'accès de l'espace d'essai, transmis par commander.html quand la commande
    // part de l'appli. Simple rattachement (lettres, chiffres, tirets) : il n'active rien.
    const codeClient = String(b.codeClient || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);

    const civ = texte(e.representantCivilite, 20);
    const greffe = texte(e.greffe, 120);
    const contrat = {
      raisonSociale,
      formeJuridique:       texte(e.formeJuridique, 80),
      capital:              texte(e.capital, 60),
      siren:                sirenChiffres.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3"),
      greffe,
      adresseSiege:         texte(e.adresseSiege, 300),
      representantCivilite: civ === "Madame" ? "Madame" : "Monsieur",
      representantNom,
      representantQualite:  texte(e.representantQualite, 80),
      ...conditionsFinancieres(formule, effectif),
      villeSignature:       texte(b.villeSignature, 120) || greffe,
      dateContrat:          new Date().toLocaleDateString("fr-CA", { timeZone: "Europe/Paris" }) // AAAA-MM-JJ
    };

    const demande = new Signature({
      source: "commande",
      codeClient,
      contrat,
      signataire: { nom: representantNom, email },
      documentHash: empreinteContrat(contrat),
      creePar: "commande en ligne"
    });
    await demande.save();
    noterCommande(ip);

    const proto = req.headers["x-forwarded-proto"] || req.protocol;
    res.status(201).json({
      ok: true,
      token: demande.token,
      lien: `/signer/${demande.token}`,
      lienComplet: `${proto}://${req.get("host")}/signer/${demande.token}`
    });
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
      signeLe: d.preuve?.signeLe || null,
      source: d.source || "admin",
      emailConfirmation: !!d.signataire?.email   // l'adresse elle-même n'est pas exposée
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

    res.json({
      ok: true,
      signeLe: d.preuve.signeLe,
      documentHash: d.documentHash,
      emailConfirmation: !!d.signataire?.email
    });

    // E-mails envoyés APRÈS la réponse : un échec d'envoi ne bloque jamais la signature.
    envoyerMailSignatureVolitis(d)
      .catch(err => console.warn("Mail de signature (Volitis) non envoyé :", err.message));
    if (d.signataire?.email) {
      envoyerMailSignatureClient(d)
        .catch(err => console.warn("Mail de signature (client) non envoyé :", err.message));
    }
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
