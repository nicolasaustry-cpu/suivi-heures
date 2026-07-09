// ─────────────────────────────────────────────────────────────
// routes/restauration.js — Outil de restauration d'un client
// ─────────────────────────────────────────────────────────────
// Deux opérations, protégées par le mot de passe administrateur
// (process.env.ADMIN_PASSWORD) :
//
//   POST /api/restauration/liste
//        body: { motDePasse, clientId }
//        → liste les instantanés de donnees_history (source "donnees")
//          pour ce client, du plus récent au plus ancien, avec un aperçu
//          (nb d'heures, salariés, noms de chantiers) pour reconnaître
//          la bonne sauvegarde À L'ŒIL.
//
//   POST /api/restauration/restaurer
//        body: { motDePasse, clientId, backupAt }   (backupAt = ISO exact d'un instantané)
//        → 1) sauvegarde de sécurité de l'ÉTAT ACTUEL du document (dans
//             donnees_history, motif "avant-restauration"),
//          2) réécrit le document live avec les données de l'instantané choisi.
//
// Aucune dépendance aux modèles : accès natif à la base (résilient au schéma).
// ─────────────────────────────────────────────────────────────

import express from "express";
import mongoose from "mongoose";

const router = express.Router();

const COLL_LIVE = "donnees";
const COLL_HIST = "donnees_history";

// Champs de données restaurés (on ne touche jamais _id ni clientId d'identité)
const CHAMPS_DONNEES = [
  "entreprise", "salaries", "heures", "chantiers",
  "previsionnel", "notesChantiers", "notesChantiersPhotos", "coordonneesChantiers"
];

function db() { return mongoose.connection.db; }
function connexionOK() { return mongoose.connection.readyState === 1 && !!db(); }
function U(s) { return (s == null ? "" : String(s)).trim().toUpperCase(); }
function motDePasseOK(mdp) {
  const attendu = process.env.ADMIN_PASSWORD || "";
  return attendu && String(mdp || "") === attendu;
}

// Aperçu lisible d'un document de données (pour reconnaître la bonne sauvegarde)
function apercuDonnees(d) {
  d = d || {};
  const heures = d.heures || {};
  const clesH = Object.keys(heures);
  // noms de chantiers distincts vus dans le planning
  const chantiersVus = new Set();
  clesH.forEach(k => {
    const e = heures[k];
    const nom = e && e.chantier ? String(e.chantier).trim() : "";
    if (nom) chantiersVus.add(nom.toUpperCase());
  });
  (Array.isArray(d.chantiers) ? d.chantiers : []).forEach(c => {
    const nom = String(c || "").trim();
    if (nom) chantiersVus.add(nom.toUpperCase());
  });
  const salaries = Array.isArray(d.salaries) ? d.salaries : [];
  return {
    entrepriseNom: (d.entreprise && d.entreprise.nom) || "",
    codeEmploye:   U(d.entreprise && d.entreprise.codeEmploye),
    nbHeures:      clesH.length,
    nbSalaries:    salaries.length,
    salaries:      salaries.slice(0, 30).map(s => `${(s.prenom||"").trim()} ${(s.nom||"").trim()}`.trim()).filter(Boolean),
    chantiers:     [...chantiersVus].slice(0, 25),
    updatedAt:     d.updatedAt || null
  };
}

// ── Lister les sauvegardes disponibles d'un client ──
router.post("/liste", async (req, res) => {
  try {
    if (!connexionOK()) return res.status(503).json({ ok: false, message: "Base non connectée, réessaie dans un instant." });
    if (!motDePasseOK(req.body.motDePasse)) return res.status(401).json({ ok: false, message: "Mot de passe administrateur incorrect." });

    const clientId = U(req.body.clientId);
    if (!clientId) return res.status(400).json({ ok: false, message: "clientId manquant." });

    const hist = db().collection(COLL_HIST);
    const docs = await hist.find({ clientId, source: COLL_LIVE })
                           .sort({ backupAt: -1 })
                           .toArray();

    // État actuel (live) pour comparaison en tête de liste
    const live = await db().collection(COLL_LIVE).findOne({ clientId });
    const liveApercu = live ? apercuDonnees(live) : null;

    const sauvegardes = docs.map(h => ({
      backupAt:     h.backupAt,                 // Date exacte (sert de clé pour restaurer)
      snapshotDate: h.snapshotDate,             // "YYYY-MM-DD"
      motif:        h.motif || "quotidienne",
      apercu:       apercuDonnees(h.donnees)
    }));

    res.json({ ok: true, clientId, live: liveApercu, nbSauvegardes: sauvegardes.length, sauvegardes });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Restaurer un client à un instantané donné ──
router.post("/restaurer", async (req, res) => {
  try {
    if (!connexionOK()) return res.status(503).json({ ok: false, message: "Base non connectée, réessaie dans un instant." });
    if (!motDePasseOK(req.body.motDePasse)) return res.status(401).json({ ok: false, message: "Mot de passe administrateur incorrect." });

    const clientId = U(req.body.clientId);
    const backupAt = req.body.backupAt ? new Date(req.body.backupAt) : null;
    if (!clientId) return res.status(400).json({ ok: false, message: "clientId manquant." });
    if (!backupAt || isNaN(backupAt.getTime()))
      return res.status(400).json({ ok: false, message: "backupAt (date de la sauvegarde) manquant ou invalide." });

    const hist = db().collection(COLL_HIST);
    const live = db().collection(COLL_LIVE);

    // 1) Retrouver l'instantané choisi
    const snap = await hist.findOne({ clientId, source: COLL_LIVE, backupAt });
    if (!snap || !snap.donnees)
      return res.status(404).json({ ok: false, message: "Sauvegarde introuvable pour cette date." });

    // 2) Retrouver le document live (casse indifférente)
    let liveDoc = await live.findOne({ clientId });
    if (!liveDoc) {
      const tous = await live.find({}).toArray();
      liveDoc = tous.find(d => U(d.clientId) === clientId) || null;
    }

    // 3) SÉCURITÉ : historiser l'état ACTUEL avant d'écrire (motif spécial)
    if (liveDoc) {
      const maintenant = new Date();
      const p = n => String(n).padStart(2, "0");
      const jour = `${maintenant.getFullYear()}-${p(maintenant.getMonth()+1)}-${p(maintenant.getDate())}`;
      await hist.insertOne({
        snapshotDate: jour,
        backupAt:     maintenant,
        source:       COLL_LIVE,
        clientId,
        refId:        liveDoc._id,
        motif:        "avant-restauration",
        donnees:      liveDoc
      });
    }

    // 4) Construire le $set à partir des champs de données de la sauvegarde
    const set = { updatedAt: new Date() };
    for (const champ of CHAMPS_DONNEES) {
      if (Object.prototype.hasOwnProperty.call(snap.donnees, champ)) {
        set[champ] = snap.donnees[champ];
      }
    }

    if (liveDoc) {
      await live.updateOne({ _id: liveDoc._id }, { $set: set });
    } else {
      // Document live disparu : on le recrée avec le clientId normalisé
      await live.insertOne({ clientId, ...set });
    }

    const apres = await live.findOne(liveDoc ? { _id: liveDoc._id } : { clientId });
    res.json({
      ok: true,
      clientId,
      restaureDepuis: { backupAt: snap.backupAt, snapshotDate: snap.snapshotDate },
      apercuApres: apercuDonnees(apres),
      securite: liveDoc ? "État précédent sauvegardé (motif « avant-restauration »)." : "Aucun document live à sauvegarder (recréé)."
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
