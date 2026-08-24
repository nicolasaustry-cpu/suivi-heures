import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import Saisie from "../models/saisies.js";
import OrdreMobile from "../models/ordremobile.js";
import Licence from "../models/licence.js";

const router = express.Router();

/* ═══════════════════════════════════════════════════════════════
   RÉSOLUTION STRICTE DE L'ENTREPRISE PAR CODE EMPLOYÉ
   ═══════════════════════════════════════════════════════════════
   FAILLE CORRIGÉE : les routes mobiles identifiaient l'entreprise en prenant
   « la PREMIÈRE trouvée » ayant ce code employé (docs.find). Or aucune contrainte
   n'impose l'unicité du code employé entre entreprises. Si deux clients partagent
   le même code, TOUS les salariés du second écrivaient dans le compte du premier
   → mélange de comptes silencieux.

   Désormais : si le code correspond à PLUSIEURS entreprises, on REFUSE (409)
   au lieu de deviner. Aucune écriture ne peut plus partir dans le mauvais compte.
   Renvoie { doc } ou { err: [code, message] }.
   ═══════════════════════════════════════════════════════════════ */
const _U = s => String(s == null ? "" : s).trim().toUpperCase();

async function resoudreEntrepriseParCode(Donnees, codeEmploye) {
  const code = _U(codeEmploye);
  if (!code) return { err: [400, "Code employé manquant"] };

  const docs = await Donnees.find({});
  const correspondants = docs.filter(d => _U(d.entreprise?.codeEmploye) === code);

  if (correspondants.length === 0) return { err: [403, "Code employé invalide"] };
  if (correspondants.length > 1) {
    // Ambiguïté : NE JAMAIS deviner. On bloque et on trace pour correction.
    const liste = correspondants.map(d => _U(d.clientId)).join(", ");
    console.error(`[ANTI-MÉLANGE] Code employé « ${code} » partagé par plusieurs entreprises : ${liste}. Accès refusé.`);
    return { err: [409, "Ce code employé est utilisé par plusieurs entreprises. Contactez votre administrateur (code à modifier)."] };
  }
  return { doc: correspondants[0] };
}

/* Ordre d'affichage mobile des chantiers (fixé par le gérant). { "<salId>_<date>": [noms] } */
async function getOrdresMobile(clientId) {
  try {
    const o = await OrdreMobile.findOne({ clientId });
    return (o && o.ordres) || {};
  } catch (_) { return {}; }
}

/* ── Connexion par code employé (sans token licence) ── */
router.post("/connect", async (req, res) => {
  try {
    const codeEmploye = (req.body.codeEmploye || "").trim().toUpperCase();
    if (!codeEmploye) return res.status(400).json({ ok: false, message: "Code employé manquant" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmploye);
    if (_r.err) return res.status(_r.err[0]).json({ ok: false, message: _r.err[1] });
    const doc = _r.doc;

    // ⚠️ Ne JAMAIS renvoyer les PIN au client. On les strippe avant envoi.
    const salariesSansPin = (doc.salaries || []).map(s => {
      const { pin, ...reste } = s.toObject ? s.toObject() : s;
      return reste;
    });

    const licence = await Licence.findOne({ codeClient: (doc.clientId || "").toUpperCase() });
    res.json({
      ok: true,
      clientId:     doc.clientId,
      salaries:     salariesSansPin,
      previsionnel: doc.previsionnel || {},
      heures:       doc.heures       || {},
      notesChantiers: doc.notesChantiers || {},
      coordonneesChantiers: doc.coordonneesChantiers || {},
      ordreMobile:  await getOrdresMobile(doc.clientId),
      marquePartenaire: licence ? !!licence.marquePartenaire : false,
      logoPartenaire:   licence ? (licence.logoPartenaire || "") : ""
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Authentification PIN salarié (par code employé, sans token licence) ──
   Vérification serveur en clair. Les PIN restent en clair côté MongoDB
   mais ne sont jamais envoyés au navigateur (cf. route /connect). */
router.post("/auth-pin", async (req, res) => {
  try {
    const codeEmp   = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId = req.body.salarieId;
    const pin       = (req.body.pin || "").toString().trim();

    if (!codeEmp || !salarieId || !pin)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    if (!/^\d{4}$/.test(pin))
      return res.status(400).json({ ok: false, message: "PIN invalide" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ message: _r.err[1] });
    const doc = _r.doc;
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal || !sal.pin) return res.status(401).json({ ok: false, message: "PIN incorrect" });
    if (String(sal.pin) !== pin) return res.status(401).json({ ok: false, message: "PIN incorrect" });

    res.json({ ok: true, salarieId: sal.id, nom: `${sal.prenom} ${sal.nom}`, administratif: !!sal.administratif, gerant: !!sal.gerant });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Note de chantier (mobile) : ajoute une ligne datée/signée au journal ──
   Réservé aux salariés administratifs et gérants. Écriture CIBLÉE ($set sur le
   seul champ notesChantiers) : n'affecte jamais salaries/heures (anti-écrasement). */
function _ligneNote(auteur, texte) {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  const sig = auteur ? ` – ${auteur}` : "";
  return `[${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}${sig}] ${texte}`;
}

router.post("/note-chantier", async (req, res) => {
  try {
    const codeEmp   = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId = req.body.salarieId;
    const chantier  = (req.body.chantier || "").trim().toUpperCase();
    const texte     = (req.body.texte || "").toString().trim();

    if (!codeEmp || !salarieId || !chantier || !texte)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    if (texte.length > 2000)
      return res.status(400).json({ ok: false, message: "Note trop longue" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ message: _r.err[1] });
    const doc = _r.doc;
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal) return res.status(401).json({ ok: false, message: "Salarié inconnu" });
    if (!sal.administratif && !sal.gerant)
      return res.status(403).json({ ok: false, message: "Action réservée aux administratifs et gérants" });

    const auteur = `${sal.prenom || ""} ${sal.nom || ""}`.trim();
    const ligne  = _ligneNote(auteur, texte);
    const notes  = doc.notesChantiers || {};
    notes[chantier] = notes[chantier] ? (notes[chantier] + "\n" + ligne) : ligne;

    await Donnees.updateOne(
      { _id: doc._id },
      { $set: { notesChantiers: notes, updatedAt: new Date() } }
    );
    res.json({ ok: true, chantier, note: notes[chantier] });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Coordonnées d'un chantier (mobile : gérant ou administratif) ── */
router.post("/coordonnees-chantier", async (req, res) => {
  try {
    const codeEmp   = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId = req.body.salarieId;
    const chantier  = (req.body.chantier || "").trim().toUpperCase();
    const c = req.body.coordonnees || {};
    if (!codeEmp || !salarieId || !chantier)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ message: _r.err[1] });
    const doc = _r.doc;
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });
    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal) return res.status(401).json({ ok: false, message: "Salarié inconnu" });
    if (!sal.administratif && !sal.gerant)
      return res.status(403).json({ ok: false, message: "Action réservée aux administratifs et gérants" });

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

/* ── Heure de RDV d'un chantier planifié (mobile : gérant ou administratif) ──
   Priorité gérant : un RDV posé par le gérant (ou ancien, sans auteur) ne peut
   pas être modifié par un administratif. */
router.post("/rdv", async (req, res) => {
  try {
    const codeEmp     = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId   = req.body.salarieId;                     // salarié CIBLÉ
    const gerantId    = req.body.gerantId;                      // demandeur (Vue équipe) — optionnel
    const date        = (req.body.date || "").trim();           // YYYY-MM-DD
    const chantier    = (req.body.chantier || "").trim();
    const rdv         = (req.body.rdv || "").trim();            // "HH:MM" ou "" pour effacer
    const rdvDelaiRaw = req.body.rdvDelai;                      // minutes (optionnel) ; "" ou absent = suit le défaut entreprise
    const creerChantier = req.body.creerChantier === true || req.body.creerChantier === "1";

    if (!salarieId || !date || !chantier)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    if (rdv && !/^\d{1,2}:\d{2}$/.test(rdv))
      return res.status(400).json({ ok: false, message: "Heure invalide" });

    const Donnees = (await import("../models/donnees.js")).default;
    const docs = await Donnees.find({});

    // ── Résolution de l'entreprise + autorisation du DEMANDEUR ──
    // Mobile : code employé (+ gerantId si on agit pour un autre salarié, ex. Vue équipe).
    // Desktop : token de licence (le patron agit en autorité gérant).
    let doc = null;
    let auteur = null;   // "gerant" | "admin"
    if (codeEmp) {
      const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
      if (_r.err) return res.status(_r.err[0]).json({ ok: false, message: _r.err[1] });
      doc = _r.doc;
      // Demandeur = gerantId si fourni (Vue équipe), sinon le salarié lui-même (compat mobile)
      const demandeurId = (gerantId != null && gerantId !== "") ? gerantId : salarieId;
      const dem = (doc.salaries || []).find(s => String(s.id) === String(demandeurId));
      if (!dem) return res.status(401).json({ ok: false, message: "Demandeur inconnu" });
      if (!dem.administratif && !dem.gerant)
        return res.status(403).json({ ok: false, message: "Action réservée aux administratifs et gérants" });
      auteur = dem.gerant ? "gerant" : "admin";
    } else {
      const jwt = (await import("jsonwebtoken")).default;
      let token = req.headers.authorization?.split(" ")[1];
      if (!token && req.body._token) token = req.body._token;
      if (!token) return res.status(401).json({ ok: false, message: "Accès refusé : aucun token" });
      let clientId;
      try { clientId = jwt.verify(token, process.env.JWT_SECRET).clientId; }
      catch { return res.status(400).json({ ok: false, message: "Token invalide ou expiré" }); }
      doc = docs.find(d => d.clientId === clientId);
      if (!doc) return res.status(403).json({ ok: false, message: "Entreprise introuvable" });
      auteur = "gerant"; // le patron pose en autorité gérant
    }

    const heures   = doc.heures || {};
    const safeDate = date.replace(/-/g, "_");
    const prefixe  = String(salarieId) + safeDate + "ch";
    let cle = null;
    for (let i = 1; i <= 5; i++) {
      const k = prefixe + i;
      const e = heures[k];
      if (e && (e.chantier || "").trim().toUpperCase() === chantier.toUpperCase()) { cle = k; break; }
    }
    // Créneau inexistant : on le crée si on POSE un RDV, ou si on demande explicitement
    // la création d'un chantier (creerChantier, ex. depuis la Vue équipe).
    if (!cle) {
      if (!rdv && !creerChantier)
        return res.json({ ok: true, chantier, rdv: "", rdvAuteur: "", rdvDelai: "" });
      for (let i = 1; i <= 5; i++) {
        const k = prefixe + i;
        const e = heures[k];
        if (!e || !((e.chantier || "").trim())) {
          heures[k] = e || { chantier: "", heures: 0 };
          heures[k].chantier = chantier;
          cle = k;
          break;
        }
      }
      if (!cle) return res.status(409).json({ ok: false, message: "Aucun créneau disponible (5 chantiers max ce jour)" });
    }

    const entry = heures[cle];
    // Priorité gérant : un RDV existant "gérant" (ou ancien sans auteur) est verrouillé pour l'admin
    const auteurExistant = entry.rdv ? (entry.rdvAuteur || "gerant") : "";
    if (auteur === "admin" && auteurExistant === "gerant")
      return res.status(403).json({ ok: false, verrou: true, message: "RDV posé par le gérant — non modifiable" });

    if (rdv) {
      entry.rdv = rdv;
      entry.rdvAuteur = auteur;
      // Délai spécifique à ce RDV (optionnel) : vide/absent = suit le défaut entreprise
      if (rdvDelaiRaw === undefined || rdvDelaiRaw === null || String(rdvDelaiRaw).trim() === "") {
        delete entry.rdvDelai;
      } else {
        const dv = parseInt(rdvDelaiRaw, 10);
        if (isNaN(dv)) delete entry.rdvDelai;
        else entry.rdvDelai = Math.max(0, Math.min(1440, dv));
      }
      delete entry.rdvNotifie;            // RDV modifié → rappel re-déclenchable
    } else if (!creerChantier) {
      // Effacement EXPLICITE du RDV (et non un simple ajout de chantier)
      delete entry.rdv;
      delete entry.rdvAuteur;
      delete entry.rdvDelai;
      delete entry.rdvNotifie;
    }
    // (creerChantier sans rdv : on n'altère pas un éventuel RDV existant)
    heures[cle] = entry;

    await Donnees.updateOne(
      { _id: doc._id },
      { $set: { heures: heures, updatedAt: new Date() } }
    );
    res.json({ ok: true, chantier, rdv: entry.rdv || "", rdvAuteur: entry.rdvAuteur || "", rdvDelai: (entry.rdvDelai != null ? entry.rdvDelai : "") });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Envoyer un chantier (avec code employé) ──
   Upsert par nom : si le chantier existe déjà pour ce jour/salarié, on le met à jour
   (permet la saisie progressive : arrivée seule, puis départ, etc.) */
/* Assainit les photos d'un chantier : images data-URL uniquement, ≤ ~675 Ko chacune.
   Plafond variable (8 pour le gérant, 3 pour les autres) — voir appel dans /envoyer.
   Renvoie null si rien n'a été envoyé (pour ne pas écraser l'existant à la fusion). */
function assainirPhotos(p, max = 3) {
  if (p == null) return null;
  if (!Array.isArray(p)) return [];
  return p
    .filter(x => typeof x === "string" && x.startsWith("data:image/") && x.length <= 900000)
    .slice(0, max);
}

/* Recalcule la durée (minutes, pause déduite) à partir des heures d'arrivée et de
   départ. Source de vérité : les horaires. Évite qu'une durée envoyée par le mobile
   (parfois 0 après une saisie progressive) reste figée alors que les heures sont bonnes. */
function recalcDuree(c) {
  if (!c) return;
  const a = String(c.heureArrivee || "").trim();
  const d = String(c.heureDepart || "").trim();
  if (a && d) {
    const [h1, m1] = a.split(":").map(Number);
    const [h2, m2] = d.split(":").map(Number);
    if (![h1, m1, h2, m2].some(Number.isNaN)) {
      c.dureeMin = Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1) - (parseInt(c.pause) || 0));
      return;
    }
  }
  c.dureeMin = 0;
}

router.post("/envoyer", async (req, res) => {
  try {
    const { codeEmploye, salarieId, salarieNom, date, chantier } = req.body;
    const codeEmp = (codeEmploye || "").trim().toUpperCase();

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ ok: false, message: _r.err[1] });
    const doc = _r.doc;

    if (chantier) {
      const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
      const maxPhotos = (sal && sal.gerant) ? 8 : 3;
      chantier.photos = assainirPhotos(chantier.photos, maxPhotos);
    }

    // Chercher la saisie du jour ou la créer
    let saisie = await Saisie.findOne({ clientId: doc.clientId, salarieId, date });

    if (!saisie) {
      recalcDuree(chantier);
      saisie = new Saisie({
        clientId: doc.clientId, salarieId, salarieNom, date,
        chantiers: [chantier],
        totalMin: (chantier.dureeMin || 0) + (chantier.deplacement || 0),
        statut: "envoyee"
      });
    } else {
      // Chercher si un chantier de même nom existe déjà ce jour-là
      const idx = saisie.chantiers.findIndex(c => (c.nom || "").trim() === (chantier.nom || "").trim());
      if (idx >= 0) {
        // Fusionner : on ne remplace que les champs fournis (non vides)
        const existant = saisie.chantiers[idx];
        saisie.chantiers[idx] = {
          nom:            chantier.nom            || existant.nom,
          heureArrivee:   chantier.heureArrivee   || existant.heureArrivee || "",
          heureDepart:    chantier.heureDepart    || existant.heureDepart  || "",
          dureeMin:       chantier.dureeMin       != null ? chantier.dureeMin       : (existant.dureeMin       || 0),
          deplacement:    chantier.deplacement    != null ? chantier.deplacement    : (existant.deplacement    || 0),
          pause:          chantier.pause          != null ? chantier.pause          : (existant.pause          || 0),
          note:           chantier.note           != null ? chantier.note           : (existant.note           || ""),
          photos:         chantier.photos         != null ? chantier.photos         : (existant.photos         || []),
          isPrevisionnel: chantier.isPrevisionnel != null ? chantier.isPrevisionnel : (existant.isPrevisionnel || false)
        };
        recalcDuree(saisie.chantiers[idx]);
      } else {
        recalcDuree(chantier);
        saisie.chantiers.push(chantier);
      }
      saisie.totalMin = saisie.chantiers.reduce((s, c) => s + (c.dureeMin || 0) + (c.deplacement || 0), 0);
      saisie.updatedAt = new Date();
    }

    await saisie.save();
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Pause déjeuner hors chantier (une par jour) ──
   Envoi dédié depuis le mobile. Ne touche QUE le champ pauseJournee de la
   saisie du jour ; ne modifie jamais les chantiers ni totalMin (la pause
   déjeuner n'est PAS du temps de travail). Crée la saisie du jour si le
   salarié pose sa pause avant d'avoir envoyé le moindre chantier. ── */
router.post("/pause", async (req, res) => {
  try {
    const { codeEmploye, salarieId, salarieNom, date } = req.body;
    const pauseJournee = Math.max(0, parseInt(req.body.pauseJournee) || 0);
    const codeEmp = (codeEmploye || "").trim().toUpperCase();
    if (!salarieId || !date) return res.status(400).json({ ok: false, message: "salarieId ou date manquant" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ ok: false, message: _r.err[1] });
    const doc = _r.doc;

    let saisie = await Saisie.findOne({ clientId: doc.clientId, salarieId, date });
    if (!saisie) {
      // Pause posée avant tout chantier : on crée une saisie du jour « vide » côté chantiers.
      saisie = new Saisie({
        clientId: doc.clientId, salarieId, salarieNom, date,
        chantiers: [], totalMin: 0, pauseJournee, statut: "envoyee"
      });
    } else {
      saisie.pauseJournee = pauseJournee; // 0 = pause supprimée
      saisie.updatedAt = new Date();
    }
    await saisie.save();
    res.json({ ok: true, pauseJournee: saisie.pauseJournee });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Supprimer un chantier AJOUTÉ d'une journée (route mobile : code employé,
   pas de token licence). Retire le chantier non prévisionnel correspondant ;
   si la journée n'a plus aucun chantier, supprime la saisie entière. ── */
router.post("/supprimer-chantier", async (req, res) => {
  try {
    const { codeEmploye, salarieId, date, nom } = req.body;
    const codeEmp = (codeEmploye || "").trim().toUpperCase();
    if (!nom || !date) return res.status(400).json({ ok: false, message: "Paramètres manquants" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ message: _r.err[1] });
    const doc = _r.doc;
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    const saisie = await Saisie.findOne({ clientId: doc.clientId, salarieId, date });
    if (!saisie) return res.json({ ok: true, supprimee: false });

    const cible = (nom || "").trim();
    const avant = saisie.chantiers.length;
    // On ne retire que le chantier AJOUTÉ (non prévisionnel) portant ce nom
    saisie.chantiers = saisie.chantiers.filter(
      c => !((c.nom || "").trim() === cible && !c.isPrevisionnel)
    );
    if (saisie.chantiers.length === avant) return res.json({ ok: true, supprimee: false });

    if (saisie.chantiers.length === 0) {
      // Plus aucun chantier : on ne supprime la saisie que s'il n'y a pas non plus
      // de pause déjeuner. Sinon on la conserve (vidée) pour ne pas perdre la pause.
      if (!saisie.pauseJournee) {
        await saisie.deleteOne();
        return res.json({ ok: true, supprimee: true, saisieSupprimee: true });
      }
      saisie.totalMin = 0;
      saisie.updatedAt = new Date();
      await saisie.save();
      return res.json({ ok: true, supprimee: true });
    }
    saisie.totalMin = saisie.chantiers.reduce((s, c) => s + (c.dureeMin || 0) + (c.deplacement || 0), 0);
    saisie.updatedAt = new Date();
    await saisie.save();
    res.json({ ok: true, supprimee: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Récupérer les saisies déjà envoyées d'un salarié pour une date donnée
   (route mobile : utilise le code employé, pas de token licence) ── */
router.post("/mobile-day", async (req, res) => {
  try {
    const codeEmp   = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId = req.body.salarieId;
    const date      = req.body.date; // "YYYY-MM-DD"

    if (!codeEmp || !salarieId || !date)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ message: _r.err[1] });
    const doc = _r.doc;
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    const saisie = await Saisie.findOne({ clientId: doc.clientId, salarieId, date });
    res.json({ ok: true, saisie: saisie || null, ordreMobile: await getOrdresMobile(doc.clientId) });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Vue équipe (mobile) : un salarié GÉRANT récupère les saisies du mois de
   toute l'entreprise + le planning à jour. Auth par code employé (sans token
   licence) ; l'accès est refusé si le salarié n'est pas marqué « gérant ». ── */
router.post("/equipe-mois", async (req, res) => {
  try {
    const codeEmp   = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId = req.body.salarieId;
    const mois      = (req.body.mois || "").trim(); // "YYYY-MM"

    if (!codeEmp || !salarieId || !/^\d{4}-\d{2}$/.test(mois))
      return res.status(400).json({ ok: false, message: "Paramètres manquants ou invalides" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ message: _r.err[1] });
    const doc = _r.doc;
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });

    // Le salarié doit exister ET être gérant ou administratif
    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal || (!sal.gerant && !sal.administratif))
      return res.status(403).json({ ok: false, message: "Accès réservé aux gérants et administratifs" });

    const saisies = await Saisie.find({
      clientId: doc.clientId,
      date: { $regex: `^${mois}` }
    }).sort({ date: 1, salarieNom: 1 });

    // Salariés sans PIN (sécurité) + planning à jour pour alimenter la grille
    const salariesSansPin = (doc.salaries || []).map(s => {
      const { pin, ...reste } = s.toObject ? s.toObject() : s;
      return reste;
    });

    res.json({ ok: true, saisies, salaries: salariesSansPin, heures: doc.heures || {}, notesChantiers: doc.notesChantiers || {}, coordonneesChantiers: doc.coordonneesChantiers || {}, ordreMobile: await getOrdresMobile(doc.clientId) });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Saisies (réalisé) d'UN salarié pour un mois — route mobile « self » (code employé).
   Permet au salarié de consulter son propre planning enrichi du réalisé. ── */
router.post("/mobile-mois", async (req, res) => {
  try {
    const codeEmp   = (req.body.codeEmploye || "").trim().toUpperCase();
    const salarieId = req.body.salarieId;
    const mois      = (req.body.mois || "").trim(); // "YYYY-MM"
    if (!codeEmp || !salarieId || !/^\d{4}-\d{2}$/.test(mois))
      return res.status(400).json({ ok: false, message: "Paramètres manquants ou invalides" });

    const Donnees = (await import("../models/donnees.js")).default;
    const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
    if (_r.err) return res.status(_r.err[0]).json({ message: _r.err[1] });
    const doc = _r.doc;
    if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });
    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal) return res.status(403).json({ ok: false, message: "Salarié inconnu" });

    const saisies = await Saisie.find({
      clientId: doc.clientId, salarieId, date: { $regex: `^${mois}` }
    }).sort({ date: 1 });
    res.json({ ok: true, saisies, ordreMobile: await getOrdresMobile(doc.clientId) });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Enregistrer l'ordre mobile des chantiers d'une journée. N'affecte PAS le
   planning PC. Auth : code employé gérant (mobile) OU token licence (patron PC). ── */
router.post("/ordre-mobile", async (req, res) => {
  try {
    const salarieId = req.body.salarieId;    // salarié cible
    const date      = (req.body.date || "").trim();
    const ordre     = Array.isArray(req.body.ordre) ? req.body.ordre.map(x => String(x)) : null;
    if (!salarieId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !ordre)
      return res.status(400).json({ ok: false, message: "Paramètres manquants ou invalides" });

    let clientId = null;
    const codeEmp = (req.body.codeEmploye || "").trim().toUpperCase();

    if (codeEmp) {
      // Contexte mobile : gérant authentifié par code employé
      const gerantId = req.body.gerantId;
      const Donnees = (await import("../models/donnees.js")).default;
      const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
      if (_r.err) return res.status(_r.err[0]).json({ message: _r.err[1] });
      const doc = _r.doc;
      if (!doc) return res.status(403).json({ ok: false, message: "Code employé invalide" });
      const gerant = (doc.salaries || []).find(s => String(s.id) === String(gerantId));
      if (!gerant || (!gerant.gerant && !gerant.administratif))
        return res.status(403).json({ ok: false, message: "Action réservée aux gérants et administratifs" });
      clientId = doc.clientId;
    } else {
      // Contexte licence (patron PC) : token Bearer
      const jwt = (await import("jsonwebtoken")).default;
      let token = req.headers.authorization?.split(" ")[1];
      if (!token && req.body._token) token = req.body._token;
      if (!token) return res.status(401).json({ ok: false, message: "Accès refusé : aucun token" });
      try {
        clientId = jwt.verify(token, process.env.JWT_SECRET).clientId;
      } catch {
        return res.status(400).json({ ok: false, message: "Token invalide ou expiré" });
      }
    }
    if (!clientId) return res.status(403).json({ ok: false, message: "Client introuvable" });

    let o = await OrdreMobile.findOne({ clientId });
    if (!o) o = new OrdreMobile({ clientId, ordres: {} });
    const ordres = o.ordres || {};
    ordres[String(salarieId) + "_" + date] = ordre;
    o.ordres = ordres;
    o.markModified("ordres");
    o.updatedAt = new Date();
    await o.save();

    res.json({ ok: true, ordres });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Authentification salarié par PIN ── */
router.post("/auth", verifyToken, async (req, res) => {
  try {
    const { salarieId, pin } = req.body;
    const Donnees = (await import("../models/donnees.js")).default;
    const doc = await Donnees.findOne({ clientId: req.user.clientId });
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const sal = (doc.salaries || []).find(s => s.id == salarieId);
    if (!sal) return res.status(404).json({ ok: false, message: "Salarié introuvable" });
    if (!sal.pin || sal.pin !== pin)
      return res.status(401).json({ ok: false, message: "Code PIN incorrect" });

    res.json({ ok: true, salarieId: sal.id, nom: `${sal.prenom} ${sal.nom}` });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Envoyer une saisie journalière ── */
router.post("/", verifyToken, async (req, res) => {
  try {
    const clientId  = req.user.clientId;
    const { salarieId, salarieNom, date, chantiers, totalMin } = req.body;

    const saisie = await Saisie.findOneAndUpdate(
      { clientId, salarieId, date },
      { clientId, salarieId, salarieNom, date, chantiers, totalMin, updatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Liste des mois (YYYY-MM) ayant au moins une saisie pour ce client.
   ⚠ DOIT être déclarée AVANT /:mois (sinon Express matchera /:mois avec mois="mois-list") */
router.get("/mois-list", verifyToken, async (req, res) => {
  try {
    const saisies = await Saisie.find({ clientId: req.user.clientId }, "date").lean();
    const mois = new Set();
    saisies.forEach(s => {
      if (typeof s.date === 'string' && s.date.length >= 7) {
        mois.add(s.date.substring(0, 7));  // 'YYYY-MM'
      }
    });
    res.json({ ok: true, mois: [...mois].sort() });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Carnet de chantier (gérant), lecture côté PC (token licence) ──
   notesChantiers n'était jusqu'ici renvoyé que par les routes mobiles
   (code employé) : /connect et /equipe-mois. Cette route l'expose aussi
   au token licence, pour un usage PC (fiche chantier imprimable).
   ⚠ Déclarée avant /:mois pour la même raison que /mois-list ci-dessus. */
router.get("/notes-chantiers", verifyToken, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const Donnees = (await import("../models/donnees.js")).default;
    const doc = await Donnees.findOne({ clientId });
    if (!doc) return res.status(404).json({ ok: false, message: "Entreprise introuvable" });
    res.json({ ok: true, notesChantiers: doc.notesChantiers || {} });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Agrégats d'une année, pour le tableau de bord ──
   GET /api/saisies/agrege/:annee
   → { ok, annee, mois: { "2026-07": { heures, interventions, trajets,
                                       deplacementMin, parChantier } } }

   Raison d'être : le tableau de bord a besoin des DURÉES de douze mois, pas
   du contenu des saisies. Or « GET /:mois » renvoie les documents complets,
   PHOTOS COMPRISES (plusieurs centaines de kilo-octets chacune) : douze
   appels représentaient des dizaines de mégaoctets pour n'utiliser que des
   sommes. La projection ci-dessous ne remonte que quatre champs, les photos
   et les notes ne quittent donc jamais la base.

   ⚠ CETTE ROUTE DOIT RESTER DÉCLARÉE AVANT « /:mois » : Express teste les
   routes dans l'ordre, et « /agrege/2026 » correspondrait sinon à « /:mois »
   avec mois="agrege". */
router.get("/agrege/:annee", verifyToken, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const annee = String(req.params.annee || "").trim();
    if (!/^\d{4}$/.test(annee))
      return res.status(400).json({ ok: false, message: "année invalide" });

    const saisies = await Saisie.find(
      { clientId, date: { $regex: `^${annee}-` } },
      { date: 1, "chantiers.nom": 1, "chantiers.dureeMin": 1, "chantiers.deplacement": 1 }
    ).lean();

    const mois = {};
    for (const s of saisies) {
      if (typeof s.date !== "string" || s.date.length < 7) continue;
      const ym = s.date.substring(0, 7);
      if (!mois[ym]) mois[ym] = { heures: 0, interventions: 0, trajets: 0, deplacementMin: 0, parChantier: {} };
      const m = mois[ym];
      for (const c of (s.chantiers || [])) {
        const nom = String(c.nom || "").trim().toUpperCase();
        if (!nom) continue;
        const h = (Number(c.dureeMin) || 0) / 60;
        const d = Number(c.deplacement) || 0;
        m.interventions += 1;
        m.heures += h;
        m.deplacementMin += d;
        if (d > 0) m.trajets += 1;
        m.parChantier[nom] = (m.parChantier[nom] || 0) + h;
      }
    }
    /* Arrondi au centième : évite de transporter des flottants à quinze décimales. */
    const r2 = (v) => Math.round(v * 100) / 100;
    for (const ym of Object.keys(mois)) {
      mois[ym].heures = r2(mois[ym].heures);
      for (const n of Object.keys(mois[ym].parChantier)) mois[ym].parChantier[n] = r2(mois[ym].parChantier[n]);
    }
    res.json({ ok: true, annee, mois });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Récupérer les saisies d'un mois ── */
router.get("/:mois", verifyToken, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const mois     = req.params.mois; // "YYYY-MM"
    const saisies  = await Saisie.find({
      clientId,
      date: { $regex: `^${mois}` }
    }).sort({ date: 1, salarieNom: 1 });
    res.json({ ok: true, saisies, ordreMobile: await getOrdresMobile(clientId) });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Récupérer les saisies d'un salarié pour un mois ── */
router.get("/:mois/:salarieId", verifyToken, async (req, res) => {
  try {
    const clientId  = req.user.clientId;
    const { mois, salarieId } = req.params;
    const saisies = await Saisie.find({
      clientId, salarieId: parseInt(salarieId),
      date: { $regex: `^${mois}` }
    }).sort({ date: 1 });
    res.json({ ok: true, saisies });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Valider une saisie (responsable) ── */
router.patch("/:id/valider", verifyToken, async (req, res) => {
  try {
    const saisie = await Saisie.findByIdAndUpdate(
      req.params.id,
      { statut: "validee" },
      { new: true }
    );
    if (!saisie) return res.status(404).json({ ok: false });
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Modifier un chantier d'une saisie (patron uniquement) ── */
router.patch("/:id/chantier/:idx", verifyToken, async (req, res) => {
  try {
    const saisie = await Saisie.findById(req.params.id);
    if (!saisie) return res.status(404).json({ ok: false, message: "Saisie introuvable" });
    if (saisie.clientId !== req.user.clientId)
      return res.status(403).json({ ok: false, message: "Accès refusé" });

    const idx = parseInt(req.params.idx);
    if (isNaN(idx) || idx < 0 || idx >= saisie.chantiers.length)
      return res.status(400).json({ ok: false, message: "Index chantier invalide" });

    const c = saisie.chantiers[idx];
    const body = req.body || {};
    if (body.nom != null)          c.nom          = String(body.nom).trim();
    if (body.heureArrivee != null) c.heureArrivee = String(body.heureArrivee);
    if (body.heureDepart != null)  c.heureDepart  = String(body.heureDepart);
    if (body.deplacement != null)  c.deplacement  = parseInt(body.deplacement) || 0;
    if (body.pause != null)        c.pause        = parseInt(body.pause) || 0;

    // Recalculer dureeMin (pause déduite) si les heures changent
    if (c.heureArrivee && c.heureDepart) {
      const [h1, m1] = c.heureArrivee.split(':').map(Number);
      const [h2, m2] = c.heureDepart.split(':').map(Number);
      c.dureeMin = Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1) - (c.pause || 0));
    } else {
      c.dureeMin = 0;
    }

    // Recalculer totalMin de la saisie
    saisie.totalMin = saisie.chantiers.reduce((sum, x) => sum + (x.dureeMin || 0) + (x.deplacement || 0), 0);
    saisie.updatedAt = new Date();
    await saisie.save();
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Supprimer un chantier d'une saisie (patron uniquement).
   Si c'est le dernier chantier, supprime toute la saisie. ── */
router.delete("/:id/chantier/:idx", verifyToken, async (req, res) => {
  try {
    const saisie = await Saisie.findById(req.params.id);
    if (!saisie) return res.status(404).json({ ok: false, message: "Saisie introuvable" });
    if (saisie.clientId !== req.user.clientId)
      return res.status(403).json({ ok: false, message: "Accès refusé" });

    const idx = parseInt(req.params.idx);
    if (isNaN(idx) || idx < 0 || idx >= saisie.chantiers.length)
      return res.status(400).json({ ok: false, message: "Index chantier invalide" });

    saisie.chantiers.splice(idx, 1);

    if (saisie.chantiers.length === 0) {
      // Plus aucun chantier : on supprime la saisie complète
      await saisie.deleteOne();
      return res.json({ ok: true, supprimee: true });
    }

    // Recalculer totalMin
    saisie.totalMin = saisie.chantiers.reduce((sum, x) => sum + (x.dureeMin || 0) + (x.deplacement || 0), 0);
    saisie.updatedAt = new Date();
    await saisie.save();
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Marquer / démarquer une note comme « réalisée »
router.post("/note-statut", verifyToken, async (req, res) => {
  try {
    const clientId  = req.user.clientId;
    const { date, chantier } = req.body;
    const salarieId = Number(req.body.salarieId);
    const faite = !!req.body.faite;
    if (!date || !chantier || !salarieId)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    const saisie = await Saisie.findOne({ clientId, salarieId, date });
    if (!saisie) return res.status(404).json({ ok: false, message: "Saisie introuvable" });
    const c = (saisie.chantiers || []).find(x => x.nom === chantier);
    if (!c) return res.status(404).json({ ok: false, message: "Chantier introuvable" });
    c.noteFaite = faite;
    saisie.markModified("chantiers");
    await saisie.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Supprimer une note : vide le texte + photos, conserve les heures du chantier
router.post("/note-supprimer", verifyToken, async (req, res) => {
  try {
    const clientId  = req.user.clientId;
    const { date, chantier } = req.body;
    const salarieId = Number(req.body.salarieId);
    if (!date || !chantier || !salarieId)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    const saisie = await Saisie.findOne({ clientId, salarieId, date });
    if (!saisie) return res.status(404).json({ ok: false, message: "Saisie introuvable" });
    const c = (saisie.chantiers || []).find(x => x.nom === chantier);
    if (!c) return res.status(404).json({ ok: false, message: "Chantier introuvable" });
    c.note = "";
    c.photos = [];
    c.noteFaite = false;
    saisie.markModified("chantiers");
    await saisie.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Éditer le texte et/ou les photos d'une note (existante ou à créer sur une
// intervention qui n'en avait pas encore) : remplace intégralement note+photos.
router.post("/note-modifier", verifyToken, async (req, res) => {
  try {
    const clientId  = req.user.clientId;
    const { date, chantier } = req.body;
    const salarieId = Number(req.body.salarieId);
    const note = typeof req.body.note === 'string' ? req.body.note : '';
    const photos = Array.isArray(req.body.photos)
      ? req.body.photos.filter(p => typeof p === 'string' && p.startsWith('data:image/'))
      : [];
    if (!date || !chantier || !salarieId)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    const saisie = await Saisie.findOne({ clientId, salarieId, date });
    if (!saisie) return res.status(404).json({ ok: false, message: "Saisie introuvable" });
    const c = (saisie.chantiers || []).find(x => x.nom === chantier);
    if (!c) return res.status(404).json({ ok: false, message: "Chantier introuvable" });
    c.note = note;
    c.photos = photos;
    saisie.markModified("chantiers");
    await saisie.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
