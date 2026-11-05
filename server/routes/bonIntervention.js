// ─────────────────────────────────────────────────────────────
// routes/bonIntervention.js — Bons d'intervention remplis (mobile)
// ─────────────────────────────────────────────────────────────
// Auth mobile uniquement (codeEmploye + salarieId), même schéma que
// routes/documents.js. Protégé par l'activation de la fonctionnalité
// (entreprise.bonsInterventionActifs), vérifiée côté serveur en plus
// du masquage du menu côté client.
//
// Endpoints (POST, l'auth passe par le corps) :
//   POST /api/bons-intervention/masques  { codeEmploye, salarieId }
//        → liste des masques ACTIFS du client (pour le choix sur mobile)
//   POST /api/bons-intervention          { codeEmploye, salarieId, chantier,
//                                           masqueId, dateIntervention, reponses }
//        → enregistre un bon rempli
//
// Côté bureau (PC, auth par token comme routes/masqueIntervention.js) :
//   GET    /api/bons-intervention/pc            → liste (sans photos/signatures)
//   GET    /api/bons-intervention/pc/:id        → bon complet + champs
//   GET    /api/bons-intervention/pc/:id/pdf    → PDF du bon
//   POST   /api/bons-intervention/pc/:id/envoyer { a, copie, message } → e-mail + PDF joint
//   DELETE /api/bons-intervention/pc/:id        → supprimer un bon
//   POST   /api/bons-intervention/pc/exemple    → crée le masque + le bon d'exemple (rapport Organilog)
// ─────────────────────────────────────────────────────────────

import express from "express";
import Donnees from "../models/donnees.js";
import MasqueIntervention from "../models/masqueIntervention.js";
import BonIntervention, { prochainNumeroBon } from "../models/bonIntervention.js";
import { verifyToken } from "../middleware/authMiddleware.js";
import Equipement, { cleClient, libelleEquipement } from "../models/equipement.js";
import { genererPdfBon } from "../services/pdfBon.js";
import { NOM_MASQUE_EXEMPLE, CHAMPS_EXEMPLE, BON_EXEMPLE } from "../data/exempleBonOrganilog.js";

const router = express.Router();

const U = s => String(s == null ? "" : s).trim().toUpperCase();

/* Résout le contexte mobile (codeEmploye + salarieId). Renvoie
   { clientId, entreprise, salarieId, salarieNom } ou { err: [code, message] }. */
export async function resoudreContexteMobile(req) {
  const codeEmp = U(req.body.codeEmploye);
  if (!codeEmp) return { err: [400, "Code employé manquant"] };

  const docs = await Donnees.find({});
  const correspondants = docs.filter(d => U(d.entreprise?.codeEmploye) === codeEmp);
  if (correspondants.length === 0) return { err: [403, "Code employé invalide"] };
  if (correspondants.length > 1) {
    console.error(`[ANTI-MÉLANGE] Code employé « ${codeEmp} » partagé par plusieurs entreprises. Accès refusé.`);
    return { err: [409, "Ce code employé est utilisé par plusieurs entreprises. Contactez votre administrateur."] };
  }
  const doc = correspondants[0];
  const sal = (doc.salaries || []).find(s => String(s.id) === String(req.body.salarieId));
  if (!sal) return { err: [401, "Salarié inconnu"] };

  if (!doc.entreprise?.bonsInterventionActifs) {
    return { err: [409, "Fonctionnalité non activée pour ce compte (page Entreprise)"], inactif: true };
  }

  return {
    clientId: U(doc.clientId),
    salarieId: String(req.body.salarieId),
    salarieNom: `${sal.prenom || ""} ${sal.nom || ""}`.trim()
  };
}

// ── Liste des masques actifs du client (pour le choix sur mobile) ──
router.post("/masques", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });

    const masques = await MasqueIntervention
      .find({ clientId: ctx.clientId, actif: true }, "nom champs")
      .sort({ nom: 1 });
    res.json({ ok: true, masques });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Enregistrer un bon rempli ──
router.post("/", async (req, res) => {
  try {
    const ctx = await resoudreContexteMobile(req);
    if (ctx.err) return res.status(ctx.err[0]).json({ ok: false, message: ctx.err[1] });

    const chantier = String(req.body.chantier || "").trim();
    if (!chantier) return res.status(400).json({ ok: false, message: "Chantier manquant" });

    const masqueId = req.body.masqueId;
    if (!masqueId) return res.status(400).json({ ok: false, message: "Masque manquant" });

    const masque = await MasqueIntervention.findById(masqueId);
    if (!masque || U(masque.clientId) !== ctx.clientId)
      return res.status(404).json({ ok: false, message: "Masque introuvable" });

    const reponses = (req.body.reponses && typeof req.body.reponses === "object") ? req.body.reponses : {};

    // Vérifie les champs obligatoires du masque
    for (const champ of masque.champs || []) {
      if (!champ.obligatoire) continue;
      const v = reponses[champ.id];
      const vide = v === undefined || v === null || v === "" ||
        (Array.isArray(v) && v.length === 0);
      if (vide) return res.status(400).json({ ok: false, message: `Le champ "${champ.libelle}" est obligatoire` });
    }

    // Équipement du parc client (facultatif) : doit appartenir au client du chantier
    let equipementId = null, equipement = null;
    if (req.body.equipementId) {
      let e = null;
      try { e = await Equipement.findById(req.body.equipementId).lean(); } catch (_) { e = null; }
      if (!e || U(e.clientId) !== ctx.clientId || e.clientCle !== cleClient(chantier))
        return res.status(404).json({ ok: false, message: "Équipement introuvable pour ce client" });
      equipementId = e._id;
      equipement = copieEquipement(e);
    }

    const bon = await BonIntervention.create({
      clientId: ctx.clientId,
      numero: await prochainNumeroBon(ctx.clientId),
      equipementId,
      equipement,
      chantier,
      masqueId: masque._id,
      masqueNom: masque.nom,
      masqueChamps: (masque.toObject().champs || []),
      salarieId: ctx.salarieId,
      salarieNom: ctx.salarieNom,
      dateIntervention: String(req.body.dateIntervention || "").trim(),
      reponses,
      creeLe: new Date()
    });

    res.json({ ok: true, id: bon._id });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ═════════════════════════════════════════════════════════════
//  CÔTÉ BUREAU (PC)
// ═════════════════════════════════════════════════════════════

/* « Fonctionnalité non activée » répond 409 et non 403 : sync.js déconnecte
   l'utilisateur sur tout 401/403 d'une route /api/, ce qui n'a pas lieu d'être
   ici (la session est valide, seule l'option est désactivée). */
/* Contexte PC : token + fonctionnalité activée. Renvoie { clientId, doc } ou envoie l'erreur. */
async function contextePC(req, res) {
  const clientId = U(req.user?.clientId);
  const doc = await Donnees.findOne({ clientId }, "entreprise coordonneesChantiers");
  if (!doc?.entreprise?.bonsInterventionActifs) {
    res.status(409).json({ ok: false, inactif: true, message: "Les bons d'intervention ne sont pas activés pour votre entreprise. Activez-les sur la page Entreprise." });
    return null;
  }
  return { clientId, doc };
}

/* Bon du client (404 si absent ou appartenant à un autre client). */
async function chargerBon(req, res, clientId) {
  let bon = null;
  try { bon = await BonIntervention.findById(req.params.id); } catch (e) { bon = null; }
  if (!bon) { res.status(404).json({ ok: false, message: "Bon introuvable" }); return null; }
  if (U(bon.clientId) !== clientId) { res.status(404).json({ ok: false, message: "Bon introuvable" }); return null; }
  return bon;
}

/* Champs à utiliser pour afficher un bon : la copie figée au remplissage,
   ou à défaut (bons enregistrés avant cette évolution) le masque actuel. */
async function champsDuBon(bon) {
  if (Array.isArray(bon.masqueChamps) && bon.masqueChamps.length) return bon.masqueChamps;
  const m = await MasqueIntervention.findById(bon.masqueId).lean();
  return m?.champs || [];
}

/* Numérote les bons enregistrés avant la numérotation, dans l'ordre de création. */
async function numeroterAnciens(clientId) {
  const sansNum = await BonIntervention.find({ clientId, $or: [{ numero: "" }, { numero: { $exists: false } }] }, "_id creeLe")
    .sort({ creeLe: 1 });
  for (const b of sansNum) {
    const numero = await prochainNumeroBon(clientId, b.creeLe);
    await BonIntervention.updateOne({ _id: b._id }, { $set: { numero } });
  }
}

/* Copie figée d'un équipement, conservée dans le bon. */
function copieEquipement(e) {
  return {
    type: e.type || "", marque: e.marque || "", modele: e.modele || "", numeroSerie: e.numeroSerie || "",
    emplacement: e.emplacement || "", fluide: e.fluide || "", chargeKg: e.chargeKg ?? null,
    libelle: libelleEquipement(e)
  };
}

const nomFichier = bon => `Bon-intervention-${bon.numero || bon._id}.pdf`;

async function pdfDuBon(bon, doc) {
  const coords = doc.coordonneesChantiers || {};
  return genererPdfBon({
    bon,
    champs: await champsDuBon(bon),
    entreprise: { nom: doc.entreprise?.nom || "" },
    coord: coords[U(bon.chantier)] || {}
  });
}

// ── Liste des bons (légère : sans réponses, donc sans photos ni signatures) ──
router.get("/pc", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    await numeroterAnciens(ctx.clientId);
    const bons = await BonIntervention
      .find({ clientId: ctx.clientId }, "numero chantier masqueNom salarieNom dateIntervention envois creeLe equipementId equipement.libelle")
      .sort({ creeLe: -1 })
      .limit(2000)
      .lean();
    res.json({ ok: true, bons });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Bon d'exemple : masque « Rapport d'intervention (exemple) » + bon rempli ──
// Sans effet si l'exemple existe déjà (renvoie le bon existant).
router.post("/pc/exemple", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const clientId = ctx.clientId;

    let masque = await MasqueIntervention.findOne({ clientId, nom: NOM_MASQUE_EXEMPLE });
    if (!masque) {
      masque = await MasqueIntervention.create({
        clientId, nom: NOM_MASQUE_EXEMPLE, actif: true, champs: CHAMPS_EXEMPLE,
        creeLe: new Date(), modifieLe: new Date()
      });
    }

    // Équipement d'exemple dans le parc du client (créé une seule fois)
    const clientCle = cleClient(BON_EXEMPLE.chantier);
    let equip = await Equipement.findOne({ clientId, clientCle, marque: BON_EXEMPLE.equipement.marque, modele: BON_EXEMPLE.equipement.modele });
    if (!equip) equip = await Equipement.create({ clientId, clientCle, clientNom: BON_EXEMPLE.chantier, ...BON_EXEMPLE.equipement, creePar: "bureau" });

    const existant = await BonIntervention.findOne({ clientId, masqueId: masque._id, chantier: BON_EXEMPLE.chantier }, "_id numero equipementId");
    if (existant) {
      // Bon d'exemple créé avant le parc d'équipements : on le rattache à l'équipement
      if (!existant.equipementId) {
        await BonIntervention.updateOne({ _id: existant._id },
          { $set: { equipementId: equip._id, equipement: copieEquipement(equip.toObject()) } });
      }
      return res.json({ ok: true, id: existant._id, numero: existant.numero, dejaPresent: true });
    }

    // Coordonnées du chantier d'exemple, seulement si la fiche n'existe pas déjà
    const coords = ctx.doc.coordonneesChantiers || {};
    if (!coords[BON_EXEMPLE.chantier]) {
      coords[BON_EXEMPLE.chantier] = BON_EXEMPLE.coord;
      await Donnees.updateOne({ _id: ctx.doc._id }, { $set: { coordonneesChantiers: coords } });
    }

    const bon = await BonIntervention.create({
      clientId,
      numero: await prochainNumeroBon(clientId, new Date(BON_EXEMPLE.dateIntervention)),
      chantier: BON_EXEMPLE.chantier,
      masqueId: masque._id,
      masqueNom: masque.nom,
      masqueChamps: masque.toObject().champs,
      equipementId: equip._id,
      equipement: copieEquipement(equip.toObject()),
      salarieId: "",
      salarieNom: BON_EXEMPLE.salarieNom,
      dateIntervention: BON_EXEMPLE.dateIntervention,
      reponses: BON_EXEMPLE.reponses,
      creeLe: new Date(`${BON_EXEMPLE.dateIntervention}T12:00:00+02:00`)
    });
    res.json({ ok: true, id: bon._id, numero: bon.numero });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Un bon complet ──
router.get("/pc/:id", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    const coords = ctx.doc.coordonneesChantiers || {};
    res.json({ ok: true, bon, champs: await champsDuBon(bon), coord: coords[U(bon.chantier)] || null });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── PDF du bon ──
router.get("/pc/:id/pdf", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    const pdf = await pdfDuBon(bon, ctx.doc);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${nomFichier(bon)}"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Envoi du bon au client par e-mail (PDF en pièce jointe, via Resend) ──
const EMAIL_OK = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const echapper = s => String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

router.post("/pc/:id/envoyer", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;

    const a = String(req.body.a || "").trim().toLowerCase();
    const copie = String(req.body.copie || "").trim().toLowerCase();
    const message = String(req.body.message || "").slice(0, 3000);
    if (!EMAIL_OK(a)) return res.status(400).json({ ok: false, message: "Adresse e-mail du destinataire invalide" });
    if (copie && !EMAIL_OK(copie)) return res.status(400).json({ ok: false, message: "Adresse e-mail de copie invalide" });

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) return res.status(503).json({ ok: false, message: "Envoi d'e-mails non configuré sur le serveur (RESEND_API_KEY)" });
    const from = process.env.MAIL_FROM || process.env.SMTP_FROM || "contact@volitis.net";

    const entNom = ctx.doc.entreprise?.nom || "Suiv'Heures";
    const pdf = await pdfDuBon(bon, ctx.doc);
    const dateTxt = (/^(\d{4})-(\d{2})-(\d{2})$/.exec(bon.dateIntervention || "") || []).slice(1).reverse().join("/");
    const sujet = `Bon d'intervention n° ${bon.numero} — ${bon.chantier}${dateTxt ? " — " + dateTxt : ""}`;
    const corps = message.trim() ||
      `Bonjour,\n\nVeuillez trouver ci-joint le bon d'intervention n° ${bon.numero}${dateTxt ? " du " + dateTxt : ""}.\n\nCordialement,\n${entNom}`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e293b;line-height:1.55;">${echapper(corps).replace(/\n/g, "<br>")}</div>`;

    const payload = {
      from: `${entNom.replace(/[<>"]/g, "")} <${from}>`,
      to: [a],
      subject: sujet,
      text: corps,
      html,
      attachments: [{ filename: nomFichier(bon), content: pdf.toString("base64") }]
    };
    if (copie) { payload.cc = [copie]; payload.reply_to = copie; }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ ok: false, message: `L'envoi a échoué (${r.status}) ${detail}`.trim() });
    }

    const envoi = { a, copie, le: new Date() };
    await BonIntervention.updateOne({ _id: bon._id }, { $push: { envois: envoi } });
    res.json({ ok: true, envoi });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Supprimer un bon ──
router.delete("/pc/:id", verifyToken, async (req, res) => {
  try {
    const ctx = await contextePC(req, res); if (!ctx) return;
    const bon = await chargerBon(req, res, ctx.clientId); if (!bon) return;
    await bon.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
