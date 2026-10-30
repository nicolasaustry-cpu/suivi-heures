import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import Saisie from "../models/saisies.js";
import OrdreMobile from "../models/ordremobile.js";
import Licence from "../models/licence.js";
import AgendaRdv from "../models/agenda.js";

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
      agendaDirigeant: !!(doc.entreprise && doc.entreprise.agendaDirigeant),   // option page Entreprise
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

/* ── Coordonnées d'un chantier (mobile) ──
   Gérant / administratif : création, modification, effacement.
   Salarié simple : CRÉATION uniquement, sur un chantier qui n'a encore aucune
   coordonnée (cas du chantier ajouté sur place, adresse proposée par le GPS du
   téléphone). Il ne peut ni modifier ni effacer une fiche existante. La fiche
   créée garde la trace de son origine (origine « mobile », auteur, date). */
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
    const habilite = !!(sal.administratif || sal.gerant);

    const coords = doc.coordonneesChantiers || {};
    const clean = {
      adresse: String(c.adresse || "").slice(0, 500),
      ville:   String(c.ville   || "").slice(0, 200),
      mobile:  String(c.mobile  || "").slice(0, 40),
      fixe:    String(c.fixe    || "").slice(0, 40),
      email:   String(c.email   || "").trim().slice(0, 120)
    };
    const vide = !clean.adresse && !clean.ville && !clean.mobile && !clean.fixe && !clean.email;
    if (!habilite) {
      const ex = coords[chantier];
      const exVide = !ex || (!ex.adresse && !ex.ville && !ex.mobile && !ex.fixe && !ex.email);
      if (vide)
        return res.status(403).json({ ok: false, message: "Effacement des coordonnées réservé aux administratifs et gérants." });
      if (!exVide)
        return res.status(403).json({ ok: false, message: "Ce chantier a déjà des coordonnées : seul un administratif ou un gérant peut les modifier." });
      clean.origine = "mobile";
      clean.auteur  = `${sal.prenom || ""} ${sal.nom || ""}`.trim().slice(0, 80);
      clean.le      = new Date().toISOString();
    }
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

/* ── Déplacer / supprimer un chantier du PLANNING (Vue équipe : mobile ou PC) ──
   CORRECTIF « changement de date non pérenne » : la Vue équipe ne modifiait que
   le planning LOCAL du navigateur puis comptait sur sync.js pour l'envoyer. Or
   sur téléphone (gérant connecté par code employé, sans jeton licence) sync.js
   n'envoie rien : le déplacement n'atteignait jamais le serveur et disparaissait
   au rafraîchissement suivant.
   Cette route fait l'opération CÔTÉ SERVEUR, de façon CIBLÉE : seules les deux
   cases concernées sont écrites ($set / $unset sur heures.<clé>), le reste du
   planning n'est jamais réécrit (aucun écrasement des modifications faites
   ailleurs entre-temps).
   Auth : code employé + gerantId (gérant ou administratif) OU jeton licence (PC).
   body : { action:'deplacer'|'supprimer', salIdS, dateS (YYYY-MM-DD), nom,
            salIdT, dateT (pour deplacer) } */
const _RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const _RE_SALID = /^[A-Za-z0-9-]+$/;

router.post("/planning-modifier", async (req, res) => {
  try {
    const action = String(req.body.action || "");
    const salIdS = String(req.body.salIdS ?? "").trim();
    const dateS  = String(req.body.dateS  || "").trim();
    const nom    = String(req.body.nom    || "").trim();
    const salIdT = String(req.body.salIdT ?? "").trim();
    const dateT  = String(req.body.dateT  || "").trim();

    if (!["deplacer", "supprimer"].includes(action))
      return res.status(400).json({ ok: false, message: "Action invalide" });
    if (!_RE_SALID.test(salIdS) || !_RE_DATE.test(dateS) || !nom)
      return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    if (action === "deplacer" && (!_RE_SALID.test(salIdT) || !_RE_DATE.test(dateT)))
      return res.status(400).json({ ok: false, message: "Destination invalide" });

    const Donnees = (await import("../models/donnees.js")).default;
    const codeEmp = (req.body.codeEmploye || "").trim().toUpperCase();
    let doc = null;

    if (codeEmp) {
      const _r = await resoudreEntrepriseParCode(Donnees, codeEmp);
      if (_r.err) return res.status(_r.err[0]).json({ ok: false, message: _r.err[1] });
      doc = _r.doc;
      const dem = (doc.salaries || []).find(s => String(s.id) === String(req.body.gerantId));
      if (!dem) return res.status(401).json({ ok: false, message: "Demandeur inconnu" });
      if (!dem.administratif && !dem.gerant)
        return res.status(403).json({ ok: false, message: "Action réservée aux administratifs et gérants" });
    } else {
      const jwt = (await import("jsonwebtoken")).default;
      let token = req.headers.authorization?.split(" ")[1];
      if (!token && req.body._token) token = req.body._token;
      if (!token) return res.status(401).json({ ok: false, message: "Accès refusé : aucun token" });
      let clientId;
      try { clientId = String(jwt.verify(token, process.env.JWT_SECRET).clientId || "").toUpperCase(); }
      catch { return res.status(400).json({ ok: false, message: "Token invalide ou expiré" }); }
      const docs = await Donnees.find({});
      doc = docs.find(d => _U(d.clientId) === clientId) || null;
      if (!doc) return res.status(403).json({ ok: false, message: "Entreprise introuvable" });
    }

    // On relit le planning À JOUR du serveur (pas celui du navigateur).
    const heures = doc.heures || {};
    const safeS = dateS.replace(/-/g, "_");
    let cleS = null;
    for (let i = 1; i <= 5; i++) {
      const k = salIdS + safeS + "ch" + i, e = heures[k];
      if (e && String(e.chantier || "").trim() === nom) { cleS = k; break; }
    }
    if (!cleS) for (let i = 1; i <= 5; i++) {      // repli insensible à la casse
      const k = salIdS + safeS + "ch" + i, e = heures[k];
      if (e && _U(e.chantier) === _U(nom)) { cleS = k; break; }
    }
    if (!cleS)
      return res.status(409).json({ ok: false, perime: true,
        message: "Ce chantier a été modifié ou déplacé entre-temps. Rafraîchissez la vue." });

    if (action === "supprimer") {
      await Donnees.updateOne({ _id: doc._id },
        { $unset: { ["heures." + cleS]: "" }, $set: { updatedAt: new Date() } });
      return res.json({ ok: true, cleSource: cleS });
    }

    if (salIdS === salIdT && dateS === dateT) return res.json({ ok: true, cleSource: cleS, cleCible: cleS, entree: heures[cleS] });

    // Case libre (ou « TEMPS NON AFFECTE ») chez le salarié cible, ce jour-là
    const safeT = dateT.replace(/-/g, "_");
    let cleT = null;
    for (let i = 1; i <= 5; i++) {
      const k = salIdT + safeT + "ch" + i, e = heures[k];
      const n = String((e && e.chantier) || "").trim();
      if (!n || n.toUpperCase() === "TEMPS NON AFFECTE") { cleT = k; break; }
    }
    if (!cleT)
      return res.status(409).json({ ok: false, message: "La journée de ce salarié est pleine (5 chantiers)." });

    const entree = { ...(heures[cleS] || {}) };
    if (dateS !== dateT) delete entree.rdvNotifie;   // nouvelle date → rappel RDV re-déclenchable

    await Donnees.updateOne({ _id: doc._id }, {
      $set:   { ["heures." + cleT]: entree, updatedAt: new Date() },
      $unset: { ["heures." + cleS]: "" }
    });
    res.json({ ok: true, cleSource: cleS, cleCible: cleT, entree });
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
      // Rang du passage (1 = premier passage sur ce chantier ce jour-là, 2 = deuxième…).
      // Distingue deux visites du même chantier séparées par un autre chantier dans la
      // même journée : sans ce champ, elles fusionnaient en une seule entrée et la
      // seconde écrasait les heures de la première.
      chantier.occurrence = parseInt(chantier.occurrence, 10) || 1;
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
      // Chercher si CE passage précis (même nom, même rang) existe déjà ce jour-là.
      // Deux passages du même chantier (rangs 1 et 2) sont deux entrées distinctes.
      const idx = saisie.chantiers.findIndex(c =>
        (c.nom || "").trim() === (chantier.nom || "").trim() &&
        (parseInt(c.occurrence, 10) || 1) === chantier.occurrence
      );
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
          isPrevisionnel: chantier.isPrevisionnel != null ? chantier.isPrevisionnel : (existant.isPrevisionnel || false),
          occurrence:     chantier.occurrence
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

/* ═══════════════════════════════════════════════════════════════
   AGENDA DU DIRIGEANT (mobile, page agenda.html)
   ═══════════════════════════════════════════════════════════════
   Option activée sur la page Entreprise (entreprise.agendaDirigeant).
   Réservé au salarié marqué « gérant » ; auth par code employé + gerantId,
   comme les autres routes mobiles du gérant.

   Chaque rendez-vous est TOUJOURS envoyé au planning : une case par
   participant (Donnees.heures), écrite de façon CIBLÉE ($set / $unset sur
   heures.<clé>) pour ne jamais réécrire le reste du planning. La case porte
   agendaId : on la retrouve ainsi même après un déplacement dans le planning.

   RDV client : la case reçoit exclu + motifExclu « RDV client », le marquage
   déjà utilisé par le planning. Le temps reste payé (total du jour, paie)
   mais sort des heures productives, du prévisionnel et de la jauge, et les
   rapports le classent sous « RDV client », rattaché au chantier.
   ═══════════════════════════════════════════════════════════════ */
const NB_SLOTS_AGENDA = 60;                          // miroir de NB_SLOTS (planning.html)
const _RE_HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const TYPES_RDV = ["client", "visite", "chantier"];
const MOTIF_RDV_CLIENT = "RDV client";

function _minutes(hhmm) { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; }
/* « Visite client » est l'ancien libellé de « RDV client » (renommé le 08/10/2026). */
function _motifRdvClient(m) { const x = String(m || "").trim().toLowerCase(); return x === "rdv client" || x === "visite client"; }

/* Durée prévue du planning : au quart d'heure le plus proche, entre 0,25 et 10 h
   (mêmes valeurs que la liste « temps prévu » de planning.html). */
function _dureePlanning(debut, fin) {
  const h = (_minutes(fin) - _minutes(debut)) / 60;
  return Math.min(10, Math.max(0.25, Math.round(h * 4) / 4));
}

/* Auth commune : entreprise par code employé, demandeur gérant, option active. */
async function _authAgenda(req) {
  const Donnees = (await import("../models/donnees.js")).default;
  const _r = await resoudreEntrepriseParCode(Donnees, req.body.codeEmploye);
  if (_r.err) return { err: _r.err };
  const doc = _r.doc;
  const ger = (doc.salaries || []).find(s => String(s.id) === String(req.body.gerantId));
  if (!ger) return { err: [401, "Demandeur inconnu"] };
  if (!ger.gerant) return { err: [403, "Agenda réservé au dirigeant"] };
  if (!(doc.entreprise && doc.entreprise.agendaDirigeant))
    return { err: [403, "L'agenda du dirigeant n'est pas activé (page Entreprise)"] };
  return { Donnees, doc, ger };
}

/* Clés du planning portant ce rendez-vous (toutes dates / tous salariés). */
function _clesDuRdv(heures, rdvId) {
  return Object.keys(heures || {}).filter(k => heures[k] && heures[k].agendaId === rdvId);
}

/* Case libre (ou « TEMPS NON AFFECTE », recalculé ensuite par le planning)
   d'un salarié à une date, en ignorant les clés déjà réservées. */
function _caseLibre(heures, salId, date, reservees) {
  const pre = String(salId) + date.replace(/-/g, "_") + "ch";
  for (let i = 1; i <= NB_SLOTS_AGENDA; i++) {
    const k = pre + i;
    if (reservees.has(k)) continue;
    const n = String((heures[k] && heures[k].chantier) || "").trim();
    if (!n || n.toUpperCase() === "TEMPS NON AFFECTE") return k;
  }
  return null;
}

/* Contenu de la case planning d'un rendez-vous. */
function _entreePlanning(rdv, ancienne) {
  const e = {
    chantier:  rdv.titre,
    heures:    _dureePlanning(rdv.debut, rdv.fin),
    rdv:       rdv.debut,
    rdvAuteur: "gerant",
    agendaId:  rdv.rdvId,
    agendaType: rdv.type
  };
  if (rdv.note) e.note = rdv.note;                         // note du jour → visible sur le mobile du salarié
  if (rdv.type === "client") { e.exclu = true; e.motifExclu = MOTIF_RDV_CLIENT; }
  // Exclusion posée à la main dans le planning pour un autre motif (SAV, Fournisseur…) :
  // conservée tant que le RDV n'est pas un RDV client (cas des RDV repris du planning).
  else if (ancienne && ancienne.exclu && ancienne.motifExclu && !_motifRdvClient(ancienne.motifExclu)) {
    e.exclu = true; e.motifExclu = ancienne.motifExclu;
  }
  // Le délai de rappel propre au RDV posé depuis le planning est conservé ;
  // le rappel est re-déclenchable si l'heure ou la date a changé.
  if (ancienne) {
    if (ancienne.rdvDelai != null) e.rdvDelai = ancienne.rdvDelai;
    if (ancienne.rdvNotifie != null && ancienne.rdv === rdv.debut) e.rdvNotifie = ancienne.rdvNotifie;
  }
  return e;
}

/* Sépare « 18 avenue Bollée\n72000 Le Mans » en adresse / ville. */
function _decouperLieu(lieu) {
  const lignes = String(lieu || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lignes.length) return null;
  return { adresse: lignes[0].slice(0, 500), ville: lignes.slice(1).join(", ").slice(0, 200) };
}

function _rdvPublic(r) {
  return {
    id: r.rdvId, date: r.date, debut: r.debut, fin: r.fin, titre: r.titre, type: r.type,
    lieu: r.lieu || "", tel: r.tel || "", salaries: r.salaries || [], note: r.note || ""
  };
}

/* ── Liste : rendez-vous + planning du gérant sur une période ──
   body : { codeEmploye, gerantId, du, au } (YYYY-MM-DD, 62 jours max) */
router.post("/agenda/liste", async (req, res) => {
  try {
    const a = await _authAgenda(req);
    if (a.err) return res.status(a.err[0]).json({ ok: false, message: a.err[1] });
    const du = String(req.body.du || ""), au = String(req.body.au || "");
    if (!_RE_DATE.test(du) || !_RE_DATE.test(au) || au < du)
      return res.status(400).json({ ok: false, message: "Période invalide" });
    if ((new Date(au) - new Date(du)) / 86400000 > 62)
      return res.status(400).json({ ok: false, message: "Période trop longue" });

    const gidL = String(a.ger.id);
    // Agenda du gérant : les RDV qu'il a créés, ou ceux où il est participant
    // (un RDV posé dans le planning d'un autre salarié n'y figure pas).
    const rdvs = (await AgendaRdv.find({ clientId: a.doc.clientId, date: { $gte: du, $lte: au } })
      .sort({ date: 1, debut: 1 }).lean())
      .filter(r => String(r.gerantId || "") === gidL || (r.salaries || []).map(String).includes(gidL));

    // Planning du gérant (hors cases issues de l'agenda, déjà représentées par leur RDV)
    const heures = a.doc.heures || {};
    const gid = String(a.ger.id);
    const planning = [];
    for (const k of Object.keys(heures)) {
      const m = k.match(/^(.+?)(\d{4})_(\d{2})_(\d{2})ch(\d+)$/);
      if (!m || m[1] !== gid) continue;
      const date = `${m[2]}-${m[3]}-${m[4]}`;
      if (date < du || date > au) continue;
      const e = heures[k];
      const nom = String((e && e.chantier) || "").trim();
      if (!nom || e.agendaId || nom.toUpperCase() === "TEMPS NON AFFECTE" || nom.toLowerCase() === "absence") continue;
      planning.push({ date, chantier: nom, heures: parseFloat(e.heures) || 0, rdv: e.rdv || "", rang: parseInt(m[5], 10) });
    }
    planning.sort((x, y) => (x.date + String(x.rang).padStart(3, "0")).localeCompare(y.date + String(y.rang).padStart(3, "0")));

    res.json({ ok: true, rdvs: rdvs.map(_rdvPublic), planning, coordonneesChantiers: a.doc.coordonneesChantiers || {} });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Créer ou modifier un rendez-vous (et sa présence au planning) ──
   body : { codeEmploye, gerantId, rdv: { id?, date, debut, fin, titre, type, lieu, salaries[], note } } */
router.post("/agenda/enregistrer", async (req, res) => {
  try {
    const a = await _authAgenda(req);
    if (a.err) return res.status(a.err[0]).json({ ok: false, message: a.err[1] });
    const { Donnees, doc } = a;
    const b = req.body.rdv || {};

    const rdv = {
      rdvId: String(b.id || "").trim(),
      date:  String(b.date || "").trim(),
      debut: String(b.debut || "").trim(),
      fin:   String(b.fin || "").trim(),
      titre: String(b.titre || "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 120),
      type:  TYPES_RDV.includes(b.type) ? b.type : "client",
      lieu:  String(b.lieu || "").trim().slice(0, 600),
      tel:   String(b.tel || "").replace(/[^\d+ .()-]/g, "").trim().slice(0, 40),
      note:  String(b.note || "").trim().slice(0, 2000),
      salaries: []
    };
    if (!rdv.titre) return res.status(400).json({ ok: false, message: "Le titre (nom du chantier) est obligatoire" });
    if (rdv.titre === "TEMPS NON AFFECTE" || rdv.titre === "ABSENCE")
      return res.status(400).json({ ok: false, message: "Ce nom est réservé par le planning" });
    if (!_RE_DATE.test(rdv.date)) return res.status(400).json({ ok: false, message: "Date invalide" });
    if (!_RE_HEURE.test(rdv.debut) || !_RE_HEURE.test(rdv.fin))
      return res.status(400).json({ ok: false, message: "Heure invalide" });
    if (_minutes(rdv.fin) <= _minutes(rdv.debut))
      return res.status(400).json({ ok: false, message: "L'heure de fin doit suivre l'heure de début" });

    // Participants : salariés existants uniquement, sans doublon
    const ids = new Set((doc.salaries || []).map(s => String(s.id)));
    const vus = new Set();
    for (const x of (Array.isArray(b.salaries) ? b.salaries : [])) {
      const id = String(x);
      if (ids.has(id) && !vus.has(id)) { vus.add(id); rdv.salaries.push(id); }
    }
    if (!rdv.salaries.length) return res.status(400).json({ ok: false, message: "Choisissez au moins une personne" });

    let existant = null;
    if (rdv.rdvId) {
      existant = await AgendaRdv.findOne({ clientId: doc.clientId, rdvId: rdv.rdvId });
      if (!existant) return res.status(404).json({ ok: false, message: "Rendez-vous introuvable (supprimé entre-temps ?)" });
    } else {
      rdv.rdvId = "ag" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }

    // ── Planning : on retire les anciennes cases du RDV puis on pose les nouvelles ──
    const heures = doc.heures || {};
    const anciennes = _clesDuRdv(heures, rdv.rdvId);
    const parSal = {};                                   // salId -> ancienne case (réutilisée si même date)
    for (const k of anciennes) {
      const m = k.match(/^(.+?)(\d{4})_(\d{2})_(\d{2})ch\d+$/);
      if (m && `${m[2]}-${m[3]}-${m[4]}` === rdv.date && !parSal[m[1]]) parSal[m[1]] = k;
    }
    const aEcrire = {}, reservees = new Set();
    const pleins = [];
    for (const sid of rdv.salaries) {
      let k = parSal[sid] || null;
      if (!k) k = _caseLibre(heures, sid, rdv.date, reservees);
      if (!k) { pleins.push(sid); continue; }
      reservees.add(k);
      aEcrire[k] = _entreePlanning(rdv, heures[k] && heures[k].agendaId === rdv.rdvId ? heures[k] : null);
    }
    if (pleins.length) {
      const noms = pleins.map(id => { const s = doc.salaries.find(x => String(x.id) === id); return s ? s.prenom : id; });
      return res.status(409).json({ ok: false, message: `Journée pleine au planning pour : ${noms.join(", ")}` });
    }
    const $set = { updatedAt: new Date() }, $unset = {};
    for (const k of Object.keys(aEcrire)) $set["heures." + k] = aEcrire[k];
    for (const k of anciennes) if (!aEcrire[k]) $unset["heures." + k] = "";

    // ── Coordonnées du chantier : créées depuis le lieu et le téléphone saisis,
    //    mises à jour s'ils ont changé (fixe et e-mail conservés). Le gérant y est
    //    habilité. Le salarié les retrouve sur la carte du chantier de sa saisie.
    const lieu = _decouperLieu(rdv.lieu);
    if (lieu || rdv.tel) {
      const coords = doc.coordonneesChantiers || {};
      const ex = coords[rdv.titre] || {};
      const nv = { ...ex };
      if (lieu) { nv.adresse = lieu.adresse; nv.ville = lieu.ville; }
      if (rdv.tel) nv.mobile = rdv.tel;
      if (nv.adresse !== ex.adresse || (nv.ville || "") !== (ex.ville || "") || (nv.mobile || "") !== (ex.mobile || "")) {
        coords[rdv.titre] = nv;
        $set.coordonneesChantiers = coords;
      }
    }

    const maj = { $set };
    if (Object.keys($unset).length) maj.$unset = $unset;
    await Donnees.updateOne({ _id: doc._id }, maj);

    const champs = {
      date: rdv.date, debut: rdv.debut, fin: rdv.fin, titre: rdv.titre, type: rdv.type,
      lieu: rdv.lieu, tel: rdv.tel, salaries: rdv.salaries, note: rdv.note, majLe: new Date()
    };
    let enr;
    if (existant) { Object.assign(existant, champs); enr = await existant.save(); }
    else enr = await AgendaRdv.create({ clientId: doc.clientId, rdvId: rdv.rdvId, gerantId: String(a.ger.id), ...champs });

    res.json({ ok: true, rdv: _rdvPublic(enr), cases: Object.keys(aEcrire) });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Reprise des RDV déjà posés dans le planning ──
   Crée dans l'agenda un rendez-vous pour chaque heure de RDV saisie au planning
   AVANT la mise en place de l'agenda, depuis 4 mois en arrière (RDV à venir
   compris). Les cases d'un même chantier, même jour, même heure chez plusieurs
   salariés deviennent UN rendez-vous avec plusieurs participants.
   SEULS les RDV affectés au gérant sont repris : un groupe n'est retenu que
   s'il contient une case sur la ligne d'un salarié « gérant » (les autres
   salariés du même RDV deviennent participants). Les RDV posés uniquement
   pour des techniciens restent dans le planning, hors agenda.
   Le planning n'est PAS modifié, sauf l'ajout du lien agendaId / agendaType
   sur les cases reprises (écriture ciblée heures.<clé>.agendaId).
   - type « RDV client » si la case porte le motif RDV client, sinon « Chantier »
   - fin = heure de RDV + temps prévu de la case (1 h si aucun)
   - cases déjà liées à l'agenda : ignorées (la reprise peut être relancée sans doublon)
   - RDV Reservio : ignorés (ils restent gérés par la synchronisation Reservio)
   Auth : code employé + gerantId (mobile) OU jeton licence (page Entreprise, PC).
   body : { mois? (1 à 12, défaut 4) } */
router.post("/agenda/reprendre", async (req, res) => {
  try {
    let Donnees, doc;
    if (req.body.codeEmploye) {
      const a = await _authAgenda(req);
      if (a.err) return res.status(a.err[0]).json({ ok: false, message: a.err[1] });
      ({ Donnees, doc } = a);
    } else {
      const jwt = (await import("jsonwebtoken")).default;
      let token = req.headers.authorization?.split(" ")[1];
      if (!token && req.body._token) token = req.body._token;
      if (!token) return res.status(401).json({ ok: false, message: "Accès refusé : aucun token" });
      let clientId;
      try { clientId = _U(jwt.verify(token, process.env.JWT_SECRET).clientId); }
      catch { return res.status(400).json({ ok: false, message: "Token invalide ou expiré" }); }
      Donnees = (await import("../models/donnees.js")).default;
      doc = (await Donnees.find({})).find(d => _U(d.clientId) === clientId) || null;
      if (!doc) return res.status(403).json({ ok: false, message: "Entreprise introuvable" });
      if (!(doc.entreprise && doc.entreprise.agendaDirigeant))
        return res.status(403).json({ ok: false, message: "L'agenda du dirigeant n'est pas activé" });
    }
    const gerants = new Set((doc.salaries || []).filter(s => s.gerant).map(s => String(s.id)));

    const mois = Math.min(12, Math.max(1, parseInt(req.body.mois, 10) || 4));
    const dep = new Date(); dep.setMonth(dep.getMonth() - mois);
    const depuis = dep.getFullYear() + "-" + String(dep.getMonth() + 1).padStart(2, "0") + "-" + String(dep.getDate()).padStart(2, "0");

    const heures = doc.heures || {};
    const ids = new Set((doc.salaries || []).map(s => String(s.id)));
    const groupes = new Map();          // "date|TITRE|HH:MM" -> { date, titre, debut, cles[], sal[], hMax, client, note }
    let reservio = 0, dejaLies = 0;
    for (const k of Object.keys(heures)) {
      const m = k.match(/^(.+?)(\d{4})_(\d{2})_(\d{2})ch\d+$/);
      if (!m) continue;
      const e = heures[k];
      if (!e || !e.rdv) continue;
      const date = `${m[2]}-${m[3]}-${m[4]}`;
      if (date < depuis || !ids.has(m[1])) continue;
      const titre = String(e.chantier || "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 120);
      if (!titre || titre === "TEMPS NON AFFECTE" || titre === "ABSENCE") continue;
      if (e.agendaId) { dejaLies++; continue; }
      if (e.reservioUid) { reservio++; continue; }
      const hm = String(e.rdv).trim().match(/^(\d{1,2})[:hH](\d{2})/);
      if (!hm || +hm[1] > 23 || +hm[2] > 59) continue;
      const debut = String(+hm[1]).padStart(2, "0") + ":" + hm[2];
      if (_minutes(debut) > 23 * 60 + 50) continue;
      const cle = `${date}|${titre}|${debut}`;
      let g = groupes.get(cle);
      if (!g) { g = { date, titre, debut, cles: [], sal: [], hMax: 0, client: false, note: "" }; groupes.set(cle, g); }
      g.cles.push(k);
      if (!g.sal.includes(m[1])) g.sal.push(m[1]);
      g.hMax = Math.max(g.hMax, parseFloat(e.heures) || 0);
      if (e.exclu && _motifRdvClient(e.motifExclu)) g.client = true;
      if (!g.note && e.note) g.note = String(e.note).trim().slice(0, 2000);
    }

    const coords = doc.coordonneesChantiers || {};
    const aCreer = [], $set = {};
    let n = 0, nbCases = 0;
    let horsGerant = 0;
    for (const g of groupes.values()) {
      const gerantId = g.sal.find(id => gerants.has(id));
      if (!gerantId) { horsGerant += g.cles.length; continue; }   // RDV de techniciens seuls : non repris
      const rdvId = "ag" + Date.now().toString(36) + (n++).toString(36) + Math.random().toString(36).slice(2, 6);
      const deb = _minutes(g.debut);
      const fin = Math.min(23 * 60 + 55, deb + (g.hMax > 0 ? Math.round(g.hMax * 60 / 5) * 5 : 60));
      const c = coords[g.titre];
      const lieu = c ? [c.adresse, c.ville].map(x => String(x || "").trim()).filter(Boolean).join("\n") : "";
      const type = g.client ? "client" : "chantier";
      aCreer.push({
        clientId: doc.clientId, rdvId, gerantId, date: g.date, debut: g.debut,
        fin: String(Math.floor(fin / 60)).padStart(2, "0") + ":" + String(fin % 60).padStart(2, "0"),
        titre: g.titre, type, lieu, tel: c ? String(c.mobile || c.fixe || "").slice(0, 40) : "", salaries: g.sal, note: g.note, creeLe: new Date(), majLe: new Date()
      });
      for (const k of g.cles) { $set[`heures.${k}.agendaId`] = rdvId; $set[`heures.${k}.agendaType`] = type; nbCases++; }
    }

    if (aCreer.length) {
      await AgendaRdv.insertMany(aCreer);
      try {
        $set.updatedAt = new Date();
        await Donnees.updateOne({ _id: doc._id }, { $set });
      } catch (e) {
        // Le planning n'a pas pu être lié : on retire les rendez-vous créés (pas de doublon à la relance)
        await AgendaRdv.deleteMany({ clientId: doc.clientId, rdvId: { $in: aCreer.map(r => r.rdvId) } });
        throw e;
      }
    }
    res.json({ ok: true, depuis, crees: aCreer.length, cases: nbCases, horsGerant, dejaLies, reservio });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Supprimer un rendez-vous (et ses cases au planning) ──
   body : { codeEmploye, gerantId, id } */
router.post("/agenda/supprimer", async (req, res) => {
  try {
    const a = await _authAgenda(req);
    if (a.err) return res.status(a.err[0]).json({ ok: false, message: a.err[1] });
    const id = String(req.body.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, message: "Paramètres manquants" });

    const cles = _clesDuRdv(a.doc.heures || {}, id);
    if (cles.length) {
      const $unset = {};
      cles.forEach(k => { $unset["heures." + k] = ""; });
      await a.Donnees.updateOne({ _id: a.doc._id }, { $unset, $set: { updatedAt: new Date() } });
    }
    await AgendaRdv.deleteOne({ clientId: a.doc.clientId, rdvId: id });
    res.json({ ok: true, casesRetirees: cles.length });
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

/* ── Récupérer les saisies d'un mois ──
   Option « ?sansPhotos=1 » : les photos des notes ne quittent pas la base (projection).
   Utilisée par le Bordereau (bev.html), qui n'en a pas besoin : 12 Mo → quelques dizaines
   de Ko pour un mois chargé. Sans l'option, réponse inchangée pour les autres pages. */
router.get("/:mois", verifyToken, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const mois     = req.params.mois; // "YYYY-MM"
    const sansPhotos = req.query.sansPhotos === "1";
    const requete  = Saisie.find({
      clientId,
      date: { $regex: `^${mois}` }
    }).sort({ date: 1, salarieNom: 1 });
    const saisies  = sansPhotos ? await requete.select("-chantiers.photos").lean() : await requete;
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

/* ── Ajouter un chantier à une saisie EXISTANTE (patron, depuis le PC) ── */
router.post("/:id/chantier", verifyToken, async (req, res) => {
  try {
    const saisie = await Saisie.findById(req.params.id);
    if (!saisie) return res.status(404).json({ ok: false, message: "Saisie introuvable" });
    if (saisie.clientId !== req.user.clientId)
      return res.status(403).json({ ok: false, message: "Accès refusé" });

    const body = req.body || {};
    const nom = String(body.nom || '').trim();
    if (!nom) return res.status(400).json({ ok: false, message: "Le nom du chantier est obligatoire" });

    const c = {
      nom,
      heureArrivee: body.heureArrivee ? String(body.heureArrivee) : '',
      heureDepart:  body.heureDepart  ? String(body.heureDepart)  : '',
      deplacement:  parseInt(body.deplacement) || 0,
      pause:        parseInt(body.pause) || 0,
      dureeMin: 0
    };
    if (c.heureArrivee && c.heureDepart) {
      const [h1, m1] = c.heureArrivee.split(':').map(Number);
      const [h2, m2] = c.heureDepart.split(':').map(Number);
      c.dureeMin = Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1) - (c.pause || 0));
    }

    saisie.chantiers.push(c);
    saisie.totalMin = saisie.chantiers.reduce((sum, x) => sum + (x.dureeMin || 0) + (x.deplacement || 0), 0);
    saisie.updatedAt = new Date();
    await saisie.save();
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Créer une intervention depuis le PC pour un salarié/jour qui n'a AUCUNE saisie ce jour-là ──
   (patron uniquement). Si une saisie existe déjà pour ce salarié+date, le chantier y est simplement
   ajouté au lieu d'en créer une seconde. */
router.post("/nouvelle-pc", verifyToken, async (req, res) => {
  try {
    const clientId = req.user.clientId;
    const body = req.body || {};
    const { date, salarieNom } = body;
    const salarieId = Number(body.salarieId);
    const nom = String(body.nom || '').trim();
    if (!date || !salarieId) return res.status(400).json({ ok: false, message: "Date et salarié obligatoires" });
    if (!nom) return res.status(400).json({ ok: false, message: "Le nom du chantier est obligatoire" });

    const c = {
      nom,
      heureArrivee: body.heureArrivee ? String(body.heureArrivee) : '',
      heureDepart:  body.heureDepart  ? String(body.heureDepart)  : '',
      deplacement:  parseInt(body.deplacement) || 0,
      pause:        parseInt(body.pause) || 0,
      dureeMin: 0
    };
    if (c.heureArrivee && c.heureDepart) {
      const [h1, m1] = c.heureArrivee.split(':').map(Number);
      const [h2, m2] = c.heureDepart.split(':').map(Number);
      c.dureeMin = Math.max(0, (h2 * 60 + m2) - (h1 * 60 + m1) - (c.pause || 0));
    }

    let saisie = await Saisie.findOne({ clientId, salarieId, date });
    if (saisie) {
      saisie.chantiers.push(c);
    } else {
      saisie = new Saisie({ clientId, salarieId, salarieNom: salarieNom || '', date, chantiers: [c] });
    }
    saisie.totalMin = saisie.chantiers.reduce((sum, x) => sum + (x.dureeMin || 0) + (x.deplacement || 0), 0);
    saisie.updatedAt = new Date();
    await saisie.save();
    res.json({ ok: true, saisie });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
