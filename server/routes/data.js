import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import Donnees from "../models/donnees.js";
import Licence from "../models/licence.js";
import Saisie from "../models/saisies.js";
import OrdreMobile from "../models/ordremobile.js";
import Henrri from "../models/henrri.js";

const router = express.Router();

/* ── Verrouillage des PIN salariés ──
   Règle : un PIN déjà posé (non vide) est IMMUABLE via les sauvegardes normales.
   On conserve la valeur stockée quelle que soit la valeur entrante (vide OU
   différente) → une session boguée ou une course au chargement ne peut plus
   ni effacer ni modifier un PIN. Un PIN vide accepte une première pose
   (4 chiffres) ; sinon il reste vide. Seule la route /reset-pin (patron) peut
   changer un PIN déjà posé. */
function appliquerVerrouPins(entrants, existants) {
  const parId = new Map();
  (existants || []).forEach(s => { if (s && s.id != null) parId.set(String(s.id), s); });
  return (entrants || []).map(s => {
    if (!s || s.id == null) return s;
    const anc       = parId.get(String(s.id));
    const pinStocke = anc && anc.pin ? String(anc.pin).trim() : "";
    if (pinStocke) return { ...s, pin: pinStocke };          // verrouillé : on garde l'existant
    const pinEntrant = s.pin ? String(s.pin).trim() : "";
    return { ...s, pin: /^\d{4}$/.test(pinEntrant) ? pinEntrant : "" }; // première pose
  });
}

/* ═══════════════════════════════════════════════════════════════
   FUSION MULTI-POSTES — anti-écrasement entre sessions ouvertes
   ═══════════════════════════════════════════════════════════════
   Problème corrigé : POST / remplaçait TOUT le planning par celui du poste
   qui sauvegardait. Avec plusieurs PC ouverts pour le même client, un poste
   resté sur un planning ancien effaçait, à sa première modification, ce qui
   avait été fait ailleurs entre-temps (autre PC, téléphone).
   sync.js envoie désormais, en plus des données complètes, un objet
   « fusion » ne décrivant QUE ses propres modifications :
     heures / entreprise : { set:{ "clé": valeur }, unset:["clé"] }      (1 niveau)
     previsionnel        : { set:{ "a" | "a.b": valeur }, unset:[…] }     (2 niveaux)
     salaries            : { set:{ id: salarié }, unset:[id], ordre:[id] }
     chantiers           : { add:[…], remove:[…], ordre:[…] }
   heures / entreprise / previsionnel sont écrits case par case ($set/$unset
   en chemin pointé, atomique côté MongoDB) ; salariés et liste des chantiers
   sont recombinés à partir de l'état ACTUEL de la base.
   Un client ancien (sans « fusion ») garde le comportement historique. */
const _seg = k => typeof k === "string" && k !== "" && !k.includes(".") && k[0] !== "$";
const _estObj = v => v !== null && typeof v === "object" && !Array.isArray(v);

function fusionValide(f) {
  if (!_estObj(f)) return false;
  const ops = x => _estObj(x) && _estObj(x.set) && Array.isArray(x.unset);
  return ops(f.heures) && ops(f.entreprise) && ops(f.previsionnel)
      && _estObj(f.salaries) && _estObj(f.salaries.set) && Array.isArray(f.salaries.unset)
      && _estObj(f.chantiers) && Array.isArray(f.chantiers.add) && Array.isArray(f.chantiers.remove);
}

/* Traduit un bloc { set, unset } en opérations MongoDB sur « champ.chemin ».
   Renvoie false si un chemin est invalide (repli sur l'enregistrement complet). */
function operationsChemins(champ, bloc, profondeurMax, actuel, $set, $unset) {
  const valide = p => {
    if (typeof p !== "string") return null;
    const segs = p.split(".");
    return (segs.length <= profondeurMax && segs.every(_seg)) ? segs : null;
  };
  for (const [p, v] of Object.entries(bloc.set)) {
    const segs = valide(p);
    if (!segs) return false;
    // Parent absent ou non-objet en base : on écrit le parent complet (sinon MongoDB refuse).
    if (segs.length === 2 && actuel && actuel[segs[0]] != null && !_estObj(actuel[segs[0]])) return false;
    $set[champ + "." + p] = v;
  }
  for (const p of bloc.unset) {
    if (!valide(p)) return false;
    $unset[champ + "." + p] = "";
  }
  return true;
}

function _plain(v) { return v && typeof v.toObject === "function" ? v.toObject() : v; }

async function appliquerFusion(existant, body, clientId) {
  const f = body.fusion;
  const brut = _plain(existant) || {};
  const $set = {}, $unset = {};

  if (!operationsChemins("heures",       f.heures,       1, brut.heures,       $set, $unset)) return { ok: false, raison: "chemin heures invalide" };
  if (!operationsChemins("entreprise",   f.entreprise,   1, brut.entreprise,   $set, $unset)) return { ok: false, raison: "chemin entreprise invalide" };
  if (!operationsChemins("previsionnel", f.previsionnel, 2, brut.previsionnel, $set, $unset)) return { ok: false, raison: "chemin prévisionnel invalide" };

  // Chemins pointés impossibles si le champ racine n'est pas un objet en base.
  for (const ch of ["heures", "entreprise", "previsionnel"]) {
    if (brut[ch] != null && !_estObj(brut[ch])) return { ok: false, raison: `${ch} non objet en base` };
  }

  // Salariés : état actuel de la base + modifications de ce poste uniquement.
  const fs = f.salaries;
  if (Object.keys(fs.set).length || fs.unset.length) {
    const actuels = (brut.salaries || []).map(_plain);
    const retires = new Set(fs.unset.map(String));
    const parId = new Map();
    actuels.forEach(s => { if (s && s.id != null && !retires.has(String(s.id))) parId.set(String(s.id), s); });
    Object.entries(fs.set).forEach(([id, s]) => { if (s && String(s.id) === String(id)) parId.set(String(id), s); });
    const ordre = (Array.isArray(fs.ordre) ? fs.ordre : []).map(String);
    const rang = id => { const i = ordre.indexOf(id); return i === -1 ? Infinity : i; };
    const ids = [...parId.keys()];
    const posBase = new Map(ids.map((id, i) => [id, i]));
    const fusion = ids
      .sort((a, b) => {
        const ra = rang(a), rb = rang(b);
        if (ra !== rb) return ra === Infinity ? 1 : rb === Infinity ? -1 : ra - rb;
        return posBase.get(a) - posBase.get(b);
      })
      .map(id => parId.get(id));
    $set.salaries = appliquerVerrouPins(fusion, existant.salaries || []);
  }

  // Liste des chantiers : ajouts / retraits de ce poste, le reste vient de la base.
  const fc = f.chantiers;
  if (fc.add.length || fc.remove.length) {
    const cle = x => JSON.stringify(x);
    const retires = new Set(fc.remove.map(cle));
    const liste = (brut.chantiers || []).map(_plain).filter(x => !retires.has(cle(x)));
    const deja = new Set(liste.map(cle));
    fc.add.forEach(x => { if (!deja.has(cle(x))) { liste.push(x); deja.add(cle(x)); } });
    $set.chantiers = liste;
  }

  $set.clientId  = clientId;
  $set.updatedAt = new Date();
  const maj = { $set };
  if (Object.keys($unset).length) maj.$unset = $unset;
  // Collection native : écriture exacte des chemins, sans remodelage par le schéma.
  await Donnees.collection.updateOne({ _id: existant._id }, maj);
  return { ok: true };
}

// ── Charger toutes les données du client ──
router.get("/", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    let doc = await Donnees.findOne({ clientId });
    // Compatibilité : ancien document enregistré dans une autre casse
    if (!doc) {
      const tous = await Donnees.find({});
      doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId) || null;
    }
    if (!doc) doc = { entreprise: {}, salaries: [], heures: {}, chantiers: [], previsionnel: {} };
    // Marque blanche : flag + logo du prescripteur, livrés à chaque chargement
    const licence = await Licence.findOne({ codeClient: clientId });
    // Henrri : indique si la connexion est active, pour que le menu (sync.js)
    // puisse afficher ou masquer le lien « Clients » sans appel séparé.
    const henrri = await Henrri.findOne({ clientId });
    res.json({
      ok: true,
      data: doc,
      marquePartenaire: licence ? !!licence.marquePartenaire : false,
      logoPartenaire:   licence ? (licence.logoPartenaire || "") : "",
      henrriActif: henrri ? !!henrri.actif : false
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Note de chantier (PC, via token licence) : ajoute une ligne datée/signée ──
   Écriture CIBLÉE ($set sur le seul champ notesChantiers) : n'affecte jamais
   salaries/heures (anti-écrasement, cf. incident). */
function _ligneNoteData(auteur, texte) {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  const sig = auteur ? ` – ${auteur}` : "";
  return `[${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}${sig}] ${texte}`;
}

/* Assainit les photos d'un chantier : images data-URL uniquement, ≤ ~675 Ko chacune, 3 max.
   Renvoie null si rien n'a été fourni (pour ne pas écraser l'existant). */
function _assainirPhotosData(p) {
  if (p == null) return null;
  if (!Array.isArray(p)) return [];
  return p
    .filter(x => typeof x === "string" && x.startsWith("data:image/") && x.length <= 900000)
    .slice(0, 3);
}

router.post("/note-chantier", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const chantier = (req.body.chantier || "").trim().toUpperCase();
    const mode     = (req.body.mode || "ajouter").toString();
    const texteRaw = (req.body.texte || "").toString();
    const auteur   = (req.body.auteur || "Gérant").toString().trim().slice(0, 40);
    const photos   = _assainirPhotosData(req.body.photos);   // null = non fourni ; [] = effacer ; [...] = remplacer

    if (!chantier) return res.status(400).json({ ok: false, message: "Paramètres manquants" });
    if (texteRaw.length > 10000) return res.status(400).json({ ok: false, message: "Note trop longue" });

    let doc = await Donnees.findOne({ clientId });
    if (!doc) {
      const tous = await Donnees.find({});
      doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId) || null;
    }
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const update = { updatedAt: new Date() };
    const notes  = doc.notesChantiers || {};

    if (mode === "remplacer") {
      // Remplace tout le bloc (modif / suppression ligne par ligne côté client).
      const bloc = texteRaw.replace(/\s+$/g, "");
      if (bloc.trim()) notes[chantier] = bloc;
      else delete notes[chantier];            // plus aucune ligne → on retire la note
      update.notesChantiers = notes;
    } else {
      // Ajout d'une ligne datée/signée (comportement existant).
      const texte = texteRaw.trim();
      if (!texte && photos === null)
        return res.status(400).json({ ok: false, message: "Note ou photo requise" });
      if (texte) {
        const ligne = _ligneNoteData(auteur, texte);
        notes[chantier] = notes[chantier] ? (notes[chantier] + "\n" + ligne) : ligne;
        update.notesChantiers = notes;
      }
    }

    // Photos : on REMPLACE le jeu de photos du chantier (si un tableau est fourni)
    const np = doc.notesChantiersPhotos || {};
    let notePhotos = np[chantier] || [];
    if (photos !== null) {
      if (photos.length) np[chantier] = photos;
      else delete np[chantier];
      update.notesChantiersPhotos = np;
      notePhotos = photos;
    }

    await Donnees.updateOne(
      { _id: doc._id },
      { $set: update }
    );
    res.json({ ok: true, chantier, note: notes[chantier] || "", photos: notePhotos });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Coordonnées d'un chantier (PC, via token licence) : écriture ciblée ──
router.post("/coordonnees-chantier", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const chantier = (req.body.chantier || "").trim().toUpperCase();
    const c = req.body.coordonnees || {};
    if (!chantier) return res.status(400).json({ ok: false, message: "Paramètres manquants" });

    let doc = await Donnees.findOne({ clientId });
    if (!doc) {
      const tous = await Donnees.find({});
      doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId) || null;
    }
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const coords = doc.coordonneesChantiers || {};
    const clean = {
      adresse: String(c.adresse || "").slice(0, 500),
      ville:   String(c.ville   || "").slice(0, 200),
      mobile:  String(c.mobile  || "").slice(0, 40),
      fixe:    String(c.fixe    || "").slice(0, 40),
      email:   String(c.email   || "").trim().slice(0, 120)
    };
    const vide = !clean.adresse && !clean.ville && !clean.mobile && !clean.fixe && !clean.email;
    if (vide) delete coords[chantier]; else coords[chantier] = clean;

    await Donnees.updateOne({ _id: doc._id }, { $set: { coordonneesChantiers: coords, updatedAt: new Date() } });
    res.json({ ok: true, chantier, coordonnees: coords[chantier] || null });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Import en masse de fiches clients (page Clients, fichier Excel / CSV) ──
   Chaque client devient une fiche « coordonnées » indexée par son NOM en
   majuscules — le même stockage que les coordonnées de chantier : la fiche
   alimente ainsi la page Clients ET l'adresse affichée au planning dès qu'un
   chantier porte ce nom. Écriture ciblée et unique ($set coordonneesChantiers).
   body : { lignes:[{ nom, coordonnees:{adresse,ville,mobile,fixe,email} }], ecraser:bool }
   ecraser=false (défaut) : une fiche déjà renseignée n'est JAMAIS modifiée. */
router.post("/coordonnees-chantiers-import", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const lignes = Array.isArray(req.body.lignes) ? req.body.lignes : null;
    const ecraser = req.body.ecraser === true;
    if (!lignes || !lignes.length) return res.status(400).json({ ok: false, message: "Aucune ligne à importer" });
    if (lignes.length > 5000) return res.status(400).json({ ok: false, message: "Fichier trop volumineux (5 000 clients maximum par import)" });

    let doc = await Donnees.findOne({ clientId });
    if (!doc) {
      const tous = await Donnees.find({});
      doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId) || null;
    }
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const coords = doc.coordonneesChantiers || {};
    const vide = c => !c || (!c.adresse && !c.ville && !c.mobile && !c.fixe && !c.email);
    const rapport = { crees: 0, misAJour: 0, ignores: 0, invalides: 0 };
    const vus = new Set();
    for (const l of lignes) {
      const nom = String((l && l.nom) || "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, 150);
      const c = (l && l.coordonnees) || {};
      const clean = {
        adresse: String(c.adresse || "").slice(0, 500),
        ville:   String(c.ville   || "").slice(0, 200),
        mobile:  String(c.mobile  || "").slice(0, 40),
        fixe:    String(c.fixe    || "").slice(0, 40),
        email:   String(c.email   || "").trim().slice(0, 120)
      };
      if (!nom || nom.startsWith("$") || vide(clean) || vus.has(nom)) { rapport.invalides++; continue; }
      vus.add(nom);
      const existe = !vide(coords[nom]);
      if (existe && !ecraser) { rapport.ignores++; continue; }
      coords[nom] = { ...clean, origine: "import" };
      if (existe) rapport.misAJour++; else rapport.crees++;
    }

    if (rapport.crees || rapport.misAJour) {
      await Donnees.updateOne({ _id: doc._id }, { $set: { coordonneesChantiers: coords, updatedAt: new Date() } });
    }
    res.json({ ok: true, rapport, coordonnees: coords });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Renommer un chantier PARTOUT (historique inclus) : opération transversale ──
router.post("/renommer-chantier", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const U = s => String(s == null ? "" : s).trim().toUpperCase();
    const ancien  = U(req.body.ancien);
    const nouveau = U(req.body.nouveau);
    if (!ancien || !nouveau) return res.status(400).json({ ok: false, message: "Ancien et nouveau nom requis" });
    if (ancien === nouveau)  return res.status(400).json({ ok: false, message: "Le nouveau nom est identique à l'ancien" });

    let doc = await Donnees.findOne({ clientId });
    if (!doc) {
      const tous = await Donnees.find({});
      doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId) || null;
    }
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const rapport = { heures: 0, previsionnel: 0, notes: false, coordonnees: false, chantiers: false, saisies: 0, ordreMobile: 0 };

    // 1) Heures du planning
    const heures = doc.heures || {};
    for (const k of Object.keys(heures)) {
      const e = heures[k];
      if (e && U(e.chantier) === ancien) { e.chantier = nouveau; rapport.heures++; }
    }

    // 2) Prévisionnel : { "YYYY-MM": { chantiers: [{ client, hPrevues, ... }] } }
    const prev = doc.previsionnel || {};
    for (const mois of Object.keys(prev)) {
      const dm = prev[mois];
      if (!dm || !Array.isArray(dm.chantiers)) continue;
      const cibles = dm.chantiers.filter(c => U(c.client) === ancien);
      if (!cibles.length) continue;
      const dejaNouveau = dm.chantiers.find(c => U(c.client) === nouveau);
      if (dejaNouveau) { // fusion des heures prévues du mois
        cibles.forEach(c => { dejaNouveau.hPrevues = (parseFloat(dejaNouveau.hPrevues) || 0) + (parseFloat(c.hPrevues) || 0); });
        dm.chantiers = dm.chantiers.filter(c => U(c.client) !== ancien);
      } else {
        cibles.forEach(c => { c.client = nouveau; });
      }
      rapport.previsionnel += cibles.length;
    }

    // 3) Notes (fusion si le nouveau nom a déjà des notes)
    const notes = doc.notesChantiers || {};
    if (notes[ancien] != null) {
      notes[nouveau] = notes[nouveau] ? (notes[nouveau] + "\n" + notes[ancien]) : notes[ancien];
      delete notes[ancien];
      rapport.notes = true;
      doc.notesChantiers = notes;
    }

    // 4) Coordonnées (on conserve celles du nouveau si elles existent déjà)
    const coords = doc.coordonneesChantiers || {};
    if (coords[ancien] != null) {
      if (coords[nouveau] == null) coords[nouveau] = coords[ancien];
      delete coords[ancien];
      rapport.coordonnees = true;
      doc.coordonneesChantiers = coords;
    }

    // 5) Liste des chantiers (tableau de noms, dédupliqué)
    if (Array.isArray(doc.chantiers)) {
      const avant = JSON.stringify(doc.chantiers);
      const vus = new Set();
      doc.chantiers = doc.chantiers
        .map(c => (U(c) === ancien ? nouveau : c))
        .filter(c => { const u = U(c); if (vus.has(u)) return false; vus.add(u); return true; });
      rapport.chantiers = (JSON.stringify(doc.chantiers) !== avant);
    }

    doc.markModified("heures");
    doc.markModified("previsionnel");
    doc.markModified("notesChantiers");
    doc.markModified("coordonneesChantiers");
    doc.markModified("chantiers");
    doc.updatedAt = new Date();
    await doc.save();

    // 6) Saisies (heures réalisées)
    const saisies = await Saisie.find({ clientId: doc.clientId });
    for (const s of saisies) {
      let modif = false;
      (s.chantiers || []).forEach(ch => { if (U(ch.nom) === ancien) { ch.nom = nouveau; modif = true; } });
      if (modif) { s.markModified("chantiers"); s.updatedAt = new Date(); await s.save(); rapport.saisies++; }
    }

    // 7) Ordre mobile des chantiers
    const om = await OrdreMobile.findOne({ clientId: doc.clientId });
    if (om && om.ordres) {
      let modif = false;
      for (const k of Object.keys(om.ordres)) {
        const arr = om.ordres[k];
        if (!Array.isArray(arr)) continue;
        const vus = new Set(); const nouv = [];
        arr.forEach(n => {
          if (U(n) === ancien) modif = true;
          const v = (U(n) === ancien) ? nouveau : n;
          const u = U(v);
          if (!vus.has(u)) { vus.add(u); nouv.push(v); }
        });
        om.ordres[k] = nouv;
      }
      if (modif) { om.markModified("ordres"); om.updatedAt = new Date(); await om.save(); rapport.ordreMobile = 1; }
    }

    res.json({ ok: true, ancien, nouveau, rapport });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Sauvegarder toutes les données du client ──
router.post("/", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const attendu  = (req.body.clientIdAttendu || "").toUpperCase();
    if (attendu && attendu !== clientId) {
      return res.status(409).json({ ok: false, message: "Incohérence client : sauvegarde refusée (anti-mélange)" });
    }
    const { entreprise, salaries, heures, chantiers, previsionnel } = req.body;

    // ── ANTI-MÉLANGE (prévention à la source) ──
    // Le code employé identifie l'entreprise pour TOUTES les routes mobiles.
    // S'il est déjà utilisé par un AUTRE client, les salariés de l'un écriraient
    // dans le compte de l'autre. On refuse donc l'enregistrement du doublon.
    const codeEmpDemande = String(entreprise?.codeEmploye || "").trim().toUpperCase();
    if (codeEmpDemande) {
      const tousDocs = await Donnees.find({});
      const conflit = tousDocs.find(d =>
        String(d.entreprise?.codeEmploye || "").trim().toUpperCase() === codeEmpDemande &&
        String(d.clientId || "").toUpperCase() !== clientId
      );
      if (conflit) {
        return res.status(409).json({
          ok: false,
          message: `Le code accès mobile « ${codeEmpDemande} » est déjà utilisé par une autre entreprise. Choisissez-en un autre (risque de mélange des comptes).`
        });
      }
    }

    // Retrouver un document existant quelle que soit la casse de son clientId,
    // pour le mettre à jour EN PLACE et normaliser sa casse en majuscules.
    const tous = await Donnees.find({});
    const memeCle = tous.filter(d => (d.clientId || "").toUpperCase() === clientId);
    const existant = memeCle[0];
    // Nettoyer d'éventuels doublons de casse (on n'en garde qu'un seul)
    for (let i = 1; i < memeCle.length; i++) {
      await Donnees.deleteOne({ _id: memeCle[i]._id });
    }

    // ── Mode FUSION (sync.js ≥ sync10) : on n'applique QUE les cases modifiées
    //    par ce poste depuis sa dernière lecture ; tout le reste est conservé tel
    //    qu'il est en base (modifs faites entre-temps sur un autre PC / mobile).
    if (existant && fusionValide(req.body.fusion)) {
      const r = await appliquerFusion(existant, req.body, clientId);
      if (r.ok) return res.json({ ok: true, mode: "fusion" });
      console.warn(`[FUSION] ${clientId} : ${r.raison} → enregistrement complet`);
    }

    if (existant) {
      const ancsSalaries    = existant.salaries || [];
      existant.clientId     = clientId;          // normalise la casse
      existant.entreprise   = entreprise;
      existant.salaries     = appliquerVerrouPins(salaries, ancsSalaries);
      existant.heures       = heures;
      existant.chantiers    = chantiers;
      existant.previsionnel = previsionnel;
      existant.updatedAt    = new Date();
      existant.markModified("salaries");
      await existant.save();
    } else {
      await Donnees.create({
        clientId, entreprise,
        salaries: appliquerVerrouPins(salaries, []),
        heures, chantiers, previsionnel, updatedAt: new Date()
      });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Réinitialiser le PIN d'un salarié (patron, jeton licence) ──
// Seule voie autorisée pour changer/effacer un PIN déjà posé (verrouillé).
// body: { salarieId, pin }  → pin = 4 chiffres (nouveau) ou "" (effacement).
router.post("/reset-pin", verifyToken, async (req, res) => {
  try {
    const clientId  = (req.user.clientId || "").toUpperCase();
    const salarieId = req.body.salarieId;
    const pin       = (req.body.pin || "").toString().trim();
    if (salarieId == null)
      return res.status(400).json({ ok: false, message: "salarieId manquant" });
    if (pin && !/^\d{4}$/.test(pin))
      return res.status(400).json({ ok: false, message: "PIN invalide (4 chiffres)" });

    const tous = await Donnees.find({});
    const doc  = tous.find(d => (d.clientId || "").toUpperCase() === clientId);
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables" });

    const sal = (doc.salaries || []).find(s => String(s.id) === String(salarieId));
    if (!sal) return res.status(404).json({ ok: false, message: "Salarié introuvable" });

    sal.pin = pin;                     // "" = effacement, sinon nouveau PIN
    doc.markModified("salaries");
    doc.updatedAt = new Date();
    await doc.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Sauvegarder une seule clé (ex: juste "heures") ──
router.patch("/:cle", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const attendu  = (req.body.clientIdAttendu || "").toUpperCase();
    if (attendu && attendu !== clientId) {
      return res.status(409).json({ ok: false, message: "Incohérence client : sauvegarde refusée (anti-mélange)" });
    }
    const { cle }  = req.params;
    const clesAutorisees = ["entreprise", "salaries", "heures", "chantiers", "previsionnel"];
    if (!clesAutorisees.includes(cle))
      return res.status(400).json({ ok: false, message: "Clé non autorisée" });

    let valeur = req.body.valeur;
    // Verrou PIN aussi par cette voie : on ne peut ni effacer ni changer un PIN posé.
    if (cle === "salaries") {
      const tous = await Donnees.find({});
      const doc  = tous.find(d => (d.clientId || "").toUpperCase() === clientId);
      valeur = appliquerVerrouPins(valeur, doc ? (doc.salaries || []) : []);
    }

    await Donnees.findOneAndUpdate(
      { clientId },
      { $set: { [cle]: valeur, updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
