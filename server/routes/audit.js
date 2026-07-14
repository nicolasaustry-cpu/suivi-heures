// ─────────────────────────────────────────────────────────────
// routes/audit.js — Contrôle anti-mélange (LECTURE SEULE)
// ─────────────────────────────────────────────────────────────
// POST /api/audit/codes-employes   { motDePasse }
//   Détecte les entreprises qui PARTAGENT le même code employé.
//   C'est la faille structurelle : les routes mobiles identifient l'entreprise
//   par le seul code employé et prennent « la première trouvée ». Deux clients
//   avec le même code = les salariés de l'un écrivent chez l'autre.
// ─────────────────────────────────────────────────────────────

import express from "express";
import mongoose from "mongoose";

const router = express.Router();

const U = s => String(s == null ? "" : s).trim().toUpperCase();

function motDePasseOK(mdp) {
  const attendu = process.env.ADMIN_PASSWORD || "";
  return attendu && String(mdp || "") === attendu;
}

router.post("/codes-employes", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1)
      return res.status(503).json({ ok: false, message: "Base non connectée." });
    if (!motDePasseOK(req.body.motDePasse))
      return res.status(401).json({ ok: false, message: "Mot de passe administrateur incorrect." });

    const docs = await mongoose.connection.db.collection("donnees")
      .find({}, { projection: { clientId: 1, "entreprise.nom": 1, "entreprise.codeEmploye": 1, salaries: 1 } })
      .toArray();

    const parCode = new Map();
    const sansCode = [];

    docs.forEach(d => {
      const code = U(d.entreprise && d.entreprise.codeEmploye);
      const info = {
        clientId: U(d.clientId),
        nom: (d.entreprise && d.entreprise.nom) || "",
        nbSalaries: Array.isArray(d.salaries) ? d.salaries.length : 0
      };
      if (!code) { sansCode.push(info); return; }
      if (!parCode.has(code)) parCode.set(code, []);
      parCode.get(code).push(info);
    });

    const collisions = [];
    for (const [code, liste] of parCode.entries()) {
      if (liste.length > 1) collisions.push({ code, nbEntreprises: liste.length, entreprises: liste });
    }
    collisions.sort((a, b) => b.nbEntreprises - a.nbEntreprises);

    res.json({
      ok: true,
      nbEntreprises: docs.length,
      nbCodesDistincts: parCode.size,
      collisions,                 // ⚠ à traiter en priorité
      sansCodeEmploye: sansCode,  // pas de risque de collision, mais mobile inutilisable
      verdict: collisions.length
        ? `⚠ ${collisions.length} code(s) employé partagé(s) : risque de mélange RÉEL.`
        : "✅ Aucun code employé partagé : aucune collision possible aujourd'hui."
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
