// ─────────────────────────────────────────────────────────────
// routes/documents.js — PDF joints à un chantier (note de chantier)
// ─────────────────────────────────────────────────────────────
// Stockage dans une collection dédiée (documentchantiers), séparée du
// document `donnees` : la synchro et la sauvegarde quotidienne ne sont pas
// alourdies. Un PDF n'est transféré que lorsqu'on l'ouvre.
//
// Authentification, deux contextes (comme les notes/coordonnées) :
//   • PC  : jeton de licence (Authorization: Bearer …)
//   • Mobile : codeEmploye + salarieId (le salarié doit exister ; ajouter /
//     supprimer sont réservés aux administratifs et gérants).
//
// Endpoints (tous en POST, l'auth mobile passe par le corps) :
//   POST /api/documents/liste     { auth…, chantier }            → métadonnées (sans le PDF)
//   POST /api/documents/ajouter   { auth…, chantier, nom, dataBase64 }
//   POST /api/documents/contenu   { auth…, id }                  → le PDF (base64)
//   POST /api/documents/supprimer { auth…, id }
// ─────────────────────────────────────────────────────────────

import express from "express";
import DocumentChantier from "../models/documentchantier.js";

const router = express.Router();

const TAILLE_MAX = 2 * 1024 * 1024;            // 2 Mo (fichier binaire)
const BASE64_MAX = Math.ceil(TAILLE_MAX / 3) * 4 + 100;

const U = s => String(s == null ? "" : s).trim().toUpperCase();

/* Résout l'entreprise + l'auteur à partir de l'auth (mobile OU jeton licence).
   Renvoie { clientId, auteur } ou { err: [code, message] }. */
async function resoudreContexte(req, { ecriture = false } = {}) {
  const codeEmp = U(req.body.codeEmploye);
  if (codeEmp) {
    const Donnees = (await import("../models/donnees.js")).default;
    const docs = await Donnees.find({});
    const doc  = docs.find(d => U(d.entreprise?.codeEmploye) === codeEmp);
    if (!doc) return { err: [403, "Code employé invalide"] };
    const sal = (doc.salaries || []).find(s => String(s.id) === String(req.body.salarieId));
    if (!sal) return { err: [401, "Salarié inconnu"] };
    if (ecriture && !sal.administratif && !sal.gerant)
      return { err: [403, "Action réservée aux administratifs et gérants"] };
    return { clientId: U(doc.clientId), auteur: `${sal.prenom || ""} ${sal.nom || ""}`.trim() };
  }
  // Contexte PC : jeton de licence
  const jwt = (await import("jsonwebtoken")).default;
  let token = req.headers.authorization?.split(" ")[1];
  if (!token && req.body._token) token = req.body._token;
  if (!token) return { err: [401, "Accès refusé : aucun token"] };
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET);
    return { clientId: U(p.clientId), auteur: p.nomClient || "Gérant" };
  } catch {
    return { err: [400, "Token invalide ou expiré"] };
  }
}

// ── Lister les PDF d'un chantier (métadonnées seulement) ──
router.post("/liste", async (req, res) => {
  try {
    const ctx = await resoudreContexte(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });
    const chantier = U(req.body.chantier);
    if (!chantier) return res.status(400).json({ ok: false, message: "Chantier manquant" });

    const docs = await DocumentChantier
      .find({ clientId: ctx.clientId, chantier }, "nom mime taille auteur uploadedAt")
      .sort({ uploadedAt: -1 });

    res.json({ ok: true, documents: docs.map(d => ({
      id: d._id, nom: d.nom, mime: d.mime, taille: d.taille, auteur: d.auteur, uploadedAt: d.uploadedAt
    })) });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Joindre un PDF ──
router.post("/ajouter", async (req, res) => {
  try {
    const ctx = await resoudreContexte(req, { ecriture: true });
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });

    const chantier = U(req.body.chantier);
    if (!chantier) return res.status(400).json({ ok: false, message: "Chantier manquant" });

    // Accepte une data-URL (data:application/pdf;base64,…) ou du base64 brut
    let brut = String(req.body.dataBase64 || "");
    const m = brut.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    let mime = "application/pdf";
    if (m) { if (m[1]) mime = m[1]; brut = m[3]; }
    brut = brut.replace(/\s/g, "");

    if (!brut) return res.status(400).json({ ok: false, message: "Fichier manquant" });
    if (mime !== "application/pdf")
      return res.status(415).json({ ok: false, message: "Seuls les fichiers PDF sont acceptés" });
    if (brut.length > BASE64_MAX)
      return res.status(413).json({ ok: false, message: "PDF trop volumineux (max 2 Mo)" });
    // Validation base64 stricte
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(brut))
      return res.status(400).json({ ok: false, message: "Fichier invalide" });

    const taille = Math.floor(brut.length * 3 / 4);
    const nom = String(req.body.nom || "document.pdf").trim().slice(0, 180) || "document.pdf";

    const doc = await DocumentChantier.create({
      clientId: ctx.clientId, chantier, nom, mime, taille, data: brut, auteur: ctx.auteur
    });

    res.json({ ok: true, document: { id: doc._id, nom: doc.nom, mime: doc.mime, taille: doc.taille, auteur: doc.auteur, uploadedAt: doc.uploadedAt } });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Ouvrir un PDF (renvoie le base64) ──
router.post("/contenu", async (req, res) => {
  try {
    const ctx = await resoudreContexte(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });
    const id = req.body.id;
    if (!id) return res.status(400).json({ ok: false, message: "Identifiant manquant" });

    const doc = await DocumentChantier.findById(id);
    if (!doc) return res.status(404).json({ ok: false, message: "Document introuvable" });
    if (U(doc.clientId) !== ctx.clientId)
      return res.status(403).json({ ok: false, message: "Accès refusé" });

    res.json({ ok: true, nom: doc.nom, mime: doc.mime, dataBase64: doc.data });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Supprimer un PDF ──
router.post("/supprimer", async (req, res) => {
  try {
    const ctx = await resoudreContexte(req, { ecriture: true });
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });
    const id = req.body.id;
    if (!id) return res.status(400).json({ ok: false, message: "Identifiant manquant" });

    const doc = await DocumentChantier.findById(id);
    if (!doc) return res.json({ ok: true, supprime: false });
    if (U(doc.clientId) !== ctx.clientId)
      return res.status(403).json({ ok: false, message: "Accès refusé" });

    await doc.deleteOne();
    res.json({ ok: true, supprime: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
