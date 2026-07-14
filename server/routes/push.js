import express from "express";
import PushSubscription from "../models/pushSubscription.js";
import NotifReglage from "../models/notifReglage.js";
import { envoyerNotif } from "../services/pushSender.js";

const router = express.Router();

/* Anti-mélange : résolution STRICTE de l'entreprise par code employé.
   Si le code correspond à plusieurs entreprises, on refuse au lieu de deviner. */
const _U = s => String(s == null ? "" : s).trim().toUpperCase();
async function resoudreEntrepriseParCode(Donnees, codeEmploye) {
  const code = _U(codeEmploye);
  if (!code) return { err: [400, "Code employé manquant"] };
  const docs = await Donnees.find({});
  const correspondants = docs.filter(d => _U(d.entreprise?.codeEmploye) === code);
  if (correspondants.length === 0) return { err: [403, "Code employé invalide"] };
  if (correspondants.length > 1) {
    console.error(`[ANTI-MÉLANGE] Code employé « ${code} » partagé par plusieurs entreprises. Accès refusé.`);
    return { err: [409, "Ce code employé est utilisé par plusieurs entreprises. Contactez votre administrateur."] };
  }
  return { doc: correspondants[0] };
}

/* ───────────────────────────────────────────────────────────────
   Notifications push (Web Push / VAPID) — abonnement.

   Contexte MOBILE : le salarié est identifié par son code employé
   (+ salarieId), comme les autres routes mobiles (/rdv, /envoyer…).
   On en déduit le clientId via le document Donnees, puis on enregistre
   l'abonnement renvoyé par le navigateur.

   Aucun envoi de notification ici : seulement l'enregistrement et
   l'exposition de la clé publique. L'envoi des rappels viendra ensuite.
   ─────────────────────────────────────────────────────────────── */

/* ── Clé publique VAPID : le navigateur en a besoin pour s'abonner ──
   La clé est PUBLIQUE par nature, on peut la servir sans authentification. */
router.get("/vapid-public-key", (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY || "";
  if (!key) return res.status(500).json({ ok: false, message: "Clé VAPID publique non configurée sur le serveur" });
  res.json({ ok: true, key });
});

/* ── Enregistrer un abonnement (mobile : code employé + salarieId) ── */
router.post("/subscribe", async (req, res) => {
  try {
    const codeEmp   = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId = req.body.salarieId;
    const sub       = req.body.subscription;

    if (!codeEmp || salarieId == null || !sub || !sub.endpoint || !sub.keys)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    if (!sub.keys.p256dh || !sub.keys.auth)
      return res.status(400).json({ ok: false, message: "Abonnement incomplet" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ ok: false, message: _r.err[1] });
    const doc = _r.doc;
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal) return res.status(401).json({ ok: false, message: "Salarié inconnu" });

    // Upsert par endpoint : pas de doublon si réabonnement ; réattribution
    // propre si un autre salarié s'abonne depuis le même appareil.
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      {
        clientId:  doc.clientId,
        salarieId: Number(salarieId),
        endpoint:  sub.endpoint,
        p256dh:    sub.keys.p256dh,
        auth:      sub.keys.auth,
        userAgent: (req.headers["user-agent"] || "").slice(0, 300),
        updatedAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Désabonnement : supprime l'abonnement par son endpoint ──
   L'endpoint est une URL opaque propre à l'appareil ; on le traite
   comme un jeton suffisant pour identifier l'abonnement à retirer. */
router.post("/unsubscribe", async (req, res) => {
  try {
    const endpoint = req.body.endpoint || (req.body.subscription && req.body.subscription.endpoint);
    if (!endpoint) return res.status(400).json({ ok: false, message: "Endpoint manquant" });
    await PushSubscription.deleteOne({ endpoint });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Notification de TEST : envoie immédiatement une notification au
   salarié qui la demande, sur tous ses appareils abonnés. Permet de
   vérifier la chaîne d'envoi (serveur → service de push → téléphone). ── */
router.post("/test", async (req, res) => {
  try {
    const codeEmp   = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId = req.body.salarieId;
    if (!codeEmp || salarieId == null)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ ok: false, message: _r.err[1] });
    const doc = _r.doc;
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal) return res.status(401).json({ ok: false, message: "Salarié inconnu" });

    const r = await envoyerNotif(doc.clientId, salarieId, {
      titre: "Suiv'Heures — test",
      corps: "✅ Vos notifications fonctionnent !",
      url:   "/saisie.html",
      tag:   "test"
    });

    if (r.envoyes === 0)
      return res.json({ ok: true, envoyes: 0, message: "Aucun appareil abonné (ou envoi impossible)" });
    res.json({ ok: true, envoyes: r.envoyes });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Délai de rappel RDV (minutes AVANT l'heure du RDV), par entreprise ──
   Deux contextes d'authentification :
   - MOBILE (code employé) : lecture libre ; écriture réservée au GÉRANT.
   - LICENCE/desktop (token Bearer ou _token) : lecture + écriture (patron).
   Sans delaiMin → LECTURE ; avec delaiMin → ÉCRITURE. ── */
router.post("/delai", async (req, res) => {
  try {
    const codeEmp = (req.body.codeEmploye || "").trim().toUpperCase();
    const aDelai  = req.body.delaiMin !== undefined && req.body.delaiMin !== null && req.body.delaiMin !== "";

    let clientId = null;
    let autoriseEcriture = false;

    if (codeEmp) {
      // ── Contexte MOBILE : code employé ──
      const Donnees = (await import("../models/donnees.js")).default;
      const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
      if (_r.err) return res.status(_r.err[0]).json({ ok: false, message: _r.err[1] });
      const doc = _r.doc;
      if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });
      clientId = doc.clientId;
      if (aDelai) {
        const sal = (doc.salaries || []).find(s => String(s.id) === String(req.body.salarieId));
        if (!sal) return res.status(401).json({ ok: false, message: "Salarié inconnu" });
        if (!sal.gerant) return res.status(403).json({ ok: false, message: "Réglage réservé au gérant" });
        autoriseEcriture = true;
      }
    } else {
      // ── Contexte LICENCE (patron PC) : token ──
      const jwt = (await import("jsonwebtoken")).default;
      let token = req.headers.authorization?.split(" ")[1];
      if (!token && req.body._token) token = req.body._token;
      if (!token) return res.status(401).json({ ok: false, message: "Accès refusé : aucun token" });
      try {
        clientId = jwt.verify(token, process.env.JWT_SECRET).clientId;
      } catch {
        return res.status(400).json({ ok: false, message: "Token invalide ou expiré" });
      }
      autoriseEcriture = true; // le détenteur du token (patron) peut régler le défaut
    }

    if (!clientId) return res.status(403).json({ ok: false, message: "Client introuvable" });

    // ── Écriture ──
    if (aDelai) {
      if (!autoriseEcriture) return res.status(403).json({ ok: false, message: "Action non autorisée" });
      let v = parseInt(req.body.delaiMin, 10);
      if (isNaN(v)) return res.status(400).json({ ok: false, message: "Délai invalide" });
      v = Math.max(0, Math.min(1440, v));

      await NotifReglage.findOneAndUpdate(
        { clientId },
        { clientId, delaiRdvMin: v, updatedAt: new Date() },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      return res.json({ ok: true, delaiMin: v });
    }

    // ── Lecture ──
    const reg = await NotifReglage.findOne({ clientId });
    res.json({ ok: true, delaiMin: reg ? reg.delaiRdvMin : 45 });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
