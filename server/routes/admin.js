import express from "express";
import jwt from "jsonwebtoken";
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js";
import Licence from "../models/licence.js";
import Donnees from "../models/donnees.js";
import Prescripteur from "../models/prescripteur.js";
import Communication from "../models/communication.js";
import { construireMailCommunication, envoyerMailsCommunication } from "../services/mail.js";

const router = express.Router();

/* ── Ouvrir un client en consultation ──────────────────────────────────
   Jusqu'ici la console appelait /api/auth/login avec le seul code client et
   recevait un jeton client ORDINAIRE : un administrateur en consultation
   pouvait donc écrire chez son client, la lecture seule n'étant qu'un
   affichage du navigateur. Cette route délivre un jeton marqué lectureSeule,
   exactement comme /api/presc/consulter, que le middleware refuse ensuite
   sur toute écriture. Symétrie voulue : les deux consultations se comportent
   désormais pareil. */
router.post("/consulter", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const code = String(req.body?.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ ok: false, message: "Code client manquant" });

    const licence = await Licence.findOne({ codeClient: code });
    if (!licence) return res.status(404).json({ ok: false, message: "Client introuvable" });

    const token = jwt.sign(
      { clientId: code, nomClient: licence.nomClient, role: "client", type: licence.type, lectureSeule: true },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({ ok: true, token, clientId: code, nomClient: licence.nomClient, type: licence.type });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Lister toutes les licences ──
router.get("/licences", verifyToken, verifyAdmin, async (req, res) => {
  const licences = await Licence.find().sort({ dateActivation: -1 });
  // Nombre de salariés par licence (base de facturation) : lu depuis les données du client
  const donnees = await Donnees.find({}, { clientId: 1, salaries: 1 });
  const nbByClient = {};
  donnees.forEach(d => {
    nbByClient[(d.clientId || "").toUpperCase()] = Array.isArray(d.salaries) ? d.salaries.length : 0;
  });
  const out = licences.map(l => {
    const o = l.toObject();
    o.nbSalaries = nbByClient[(l.codeClient || "").toUpperCase()] || 0;
    return o;
  });
  res.json({ ok: true, licences: out });
});

// ── Créer une licence ──
router.post("/licences", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { codeClient, nomClient, email, dateExpiration, notes, type, prescripteur, marquePartenaire, logoPartenaire, statut, datePaiement } = req.body;
    if (!codeClient || !dateExpiration)
      return res.status(400).json({ ok: false, message: "Code et date d'expiration requis" });

    const licence = new Licence({
      codeClient: codeClient.toUpperCase().trim(),
      nomClient, email, notes,
      type: type || "standard",
      origine: "manuel",
      statut: statut || "client",
      datePaiement: datePaiement ? new Date(datePaiement) : null,
      prescripteur: (prescripteur || "").toUpperCase().trim(),
      dateExpiration: new Date(dateExpiration),
      marquePartenaire: !!marquePartenaire,
      logoPartenaire: logoPartenaire || "",
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

    const { nomClient, email, dateExpiration, notes, type, prescripteur, marquePartenaire, logoPartenaire, statut, datePaiement } = req.body;
    if (nomClient)              licence.nomClient      = nomClient;
    if (email)               licence.email          = email;
    if (dateExpiration)      licence.dateExpiration = new Date(dateExpiration);
    if (notes !== undefined) licence.notes          = notes;
    if (type)                   licence.type           = type;
    if (statut)                 licence.statut         = statut;
    if (datePaiement !== undefined) licence.datePaiement = datePaiement ? new Date(datePaiement) : null;
    if (prescripteur !== undefined) licence.prescripteur = (prescripteur || "").toUpperCase().trim();
    if (marquePartenaire !== undefined) licence.marquePartenaire = !!marquePartenaire;
    if (logoPartenaire !== undefined)   licence.logoPartenaire   = logoPartenaire || "";
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

// ════════════════ COMMUNICATION CLIENTS (mails groupés) ════════════════

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMAGE_OK = /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/=]+$/;

// Lit et contrôle le contenu du mail envoyé par la console
function lireContenu(body) {
  const sujet       = String(body?.sujet || "").trim();
  const message     = String(body?.message || "").trim();
  const boutonTexte = String(body?.boutonTexte || "").trim().slice(0, 60);
  const boutonUrl   = String(body?.boutonUrl || "").trim().slice(0, 500);
  const image       = String(body?.image || "");
  if (!sujet)   return { erreur: "Objet du mail manquant" };
  if (!message) return { erreur: "Message vide" };
  if (image && !IMAGE_OK.test(image)) return { erreur: "Image invalide" };
  if (boutonUrl && !/^https?:\/\//i.test(boutonUrl)) return { erreur: "Le lien du bouton doit commencer par https://" };
  return { sujet: sujet.slice(0, 200), message: message.slice(0, 20000), boutonTexte, boutonUrl, image };
}

function urlImage(id) {
  const appUrl = (process.env.APP_URL || "https://suivi-heures.volitis.net").replace(/\/+$/, "");
  return `${appUrl}/api/admin/communication/${id}/image`;
}

// ── Image d'une communication (PUBLIQUE : chargée par la messagerie du destinataire) ──
router.get("/communication/:id/image", async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(req.params.id)) return res.status(404).end();
    const c = await Communication.findById(req.params.id, { image: 1 });
    const m = c && c.image && c.image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!m) return res.status(404).end();
    res.set("Content-Type", m[1]);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(Buffer.from(m[2], "base64"));
  } catch {
    res.status(404).end();
  }
});

// ── Aperçu du mail (rien n'est envoyé ni enregistré) ──
router.post("/communication/apercu", verifyToken, verifyAdmin, (req, res) => {
  const c = lireContenu(req.body);
  if (c.erreur) return res.status(400).json({ ok: false, message: c.erreur });
  const mail = construireMailCommunication({
    ...c, nomClient: String(req.body?.nomExemple || "Entreprise Exemple"), imageUrl: c.image || ""
  });
  res.json({ ok: true, sujet: mail.sujet, html: mail.html });
});

// ── Envoi d'un mail de test à une seule adresse ──
router.post("/communication/test", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const c = lireContenu(req.body);
    if (c.erreur) return res.status(400).json({ ok: false, message: c.erreur });
    const email = String(req.body?.emailTest || "").trim();
    if (!EMAIL_OK.test(email)) return res.status(400).json({ ok: false, message: "Adresse de test invalide" });

    const doc = await Communication.create({ ...c, test: true, cible: { test: email } });
    const mail = construireMailCommunication({ ...c, nomClient: "Entreprise Exemple", imageUrl: c.image ? urlImage(doc._id) : "" });
    const [r] = await envoyerMailsCommunication([{ email, ...mail }]);
    doc.destinataires = [{ code: "TEST", nom: "Test", email, ok: r.ok, erreur: r.erreur || "" }];
    doc.nbEnvoyes = r.ok ? 1 : 0; doc.nbEchecs = r.ok ? 0 : 1;
    await doc.save();
    if (!r.ok) return res.status(502).json({ ok: false, message: r.erreur });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Envoi réel aux licences cochées ──
// La console envoie la liste des CODES clients retenus ; les adresses sont
// relues ici en base (on ne fait jamais confiance à des e-mails venus du navigateur).
router.post("/communication/envoyer", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const c = lireContenu(req.body);
    if (c.erreur) return res.status(400).json({ ok: false, message: c.erreur });
    const codes = Array.isArray(req.body?.codes)
      ? [...new Set(req.body.codes.map(x => String(x || "").trim().toUpperCase()).filter(Boolean))]
      : [];
    if (!codes.length)     return res.status(400).json({ ok: false, message: "Aucun destinataire" });
    if (codes.length > 1000) return res.status(400).json({ ok: false, message: "Trop de destinataires en un seul envoi (1000 max)" });

    const licences = await Licence.find({ codeClient: { $in: codes } }, { codeClient: 1, nomClient: 1, email: 1 });

    // Une seule fois par adresse (un même e-mail peut porter plusieurs licences)
    const vus = new Set();
    const cibles = [];
    const ignores = [];
    licences.forEach(l => {
      const email = String(l.email || "").trim();
      if (!EMAIL_OK.test(email)) { ignores.push({ code: l.codeClient, nom: l.nomClient, email, ok: false, erreur: "Adresse absente ou invalide" }); return; }
      const cle = email.toLowerCase();
      if (vus.has(cle)) return;
      vus.add(cle);
      cibles.push({ code: l.codeClient, nom: l.nomClient || "", email });
    });
    if (!cibles.length) return res.status(400).json({ ok: false, message: "Aucune adresse e-mail valide parmi les destinataires" });

    const doc = await Communication.create({ ...c, test: false, cible: req.body?.cible || {} });
    const imageUrl = c.image ? urlImage(doc._id) : "";
    const mails = cibles.map(t => ({ email: t.email, ...construireMailCommunication({ ...c, nomClient: t.nom, imageUrl }) }));
    const resultats = await envoyerMailsCommunication(mails);

    doc.destinataires = [
      ...cibles.map((t, i) => ({ ...t, ok: !!resultats[i]?.ok, erreur: resultats[i]?.erreur || "" })),
      ...ignores
    ];
    doc.nbEnvoyes = resultats.filter(r => r.ok).length;
    doc.nbEchecs  = doc.destinataires.length - doc.nbEnvoyes;
    await doc.save();

    // Copie de contrôle : UN seul mail à l'administrateur (pas une copie par
    // client), identique à ce qu'a reçu le premier destinataire, précédé d'un
    // bandeau rappelant la liste des clients touchés.
    let copie = null;
    const copieA = String(req.body?.copieA || "").trim();
    if (EMAIL_OK.test(copieA)) {
      const recus = doc.destinataires.filter(d => d.ok);
      const quand = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });
      const liste = recus.map(d => `${d.nom || d.code} (${d.email})`);
      const m = construireMailCommunication({ ...c, nomClient: cibles[0].nom, imageUrl });
      const esc = x => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const bandeau = `<div style="max-width:600px;margin:0 auto 14px;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:12px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#78350f;">
        <b>Copie de contrôle</b> — envoyé le ${quand} à <b>${recus.length}</b> client${recus.length > 1 ? "s" : ""}${doc.nbEchecs ? ` (${doc.nbEchecs} échec${doc.nbEchecs > 1 ? "s" : ""})` : ""}.<br>
        <span style="color:#92400e;">${liste.map(esc).join(" · ")}</span></div>`;
      const html = m.html.replace(/(<td align="center">)/, `$1${bandeau}`);
      const text = `[Copie de contrôle — envoyé le ${quand} à ${recus.length} client(s)]\n${liste.join("\n")}\n\n----------\n\n${m.text}`;
      const [r] = await envoyerMailsCommunication([{ email: copieA, sujet: "[Copie] " + m.sujet, html, text }]);
      copie = { email: copieA, ok: r.ok, erreur: r.erreur || "" };
      doc.cible = { ...(doc.cible || {}), copieA };
      doc.markModified("cible");
      await doc.save();
    }

    res.json({
      ok: true,
      envoyes: doc.nbEnvoyes,
      echecs: doc.destinataires.filter(d => !d.ok),
      copie
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Historique des envois réels (sans l'image, trop lourde pour la liste) ──
router.get("/communication/historique", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const liste = await Communication.find({ test: false }, { image: 0, message: 0 })
      .sort({ date: -1 }).limit(50);
    res.json({ ok: true, envois: liste });
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
