import express from "express";
import PushSubscription from "../models/pushSubscription.js";
import { envoyerNotif } from "../services/pushSender.js";

const router = express.Router();

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
    const docs = await Donnees.find({});
    const doc  = docs.find(d => (d.entreprise?.codeEmploye || "").trim().toUpperCase() === codeEmp);
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
    const docs = await Donnees.find({});
    const doc  = docs.find(d => (d.entreprise?.codeEmploye || "").trim().toUpperCase() === codeEmp);
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

export default router;
