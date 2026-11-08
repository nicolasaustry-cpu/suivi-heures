// ─────────────────────────────────────────────────────────────
// services/accesBons.js — Accès au module Bons d'intervention
// ─────────────────────────────────────────────────────────────
// Le module (masques, bons, équipements) est réservé à la licence PLUS et
// doit en plus être activé sur la page Entreprise. Vérifié côté serveur, en
// complément du verrou du menu côté client.
// ─────────────────────────────────────────────────────────────

import Licence from "../models/licence.js";

export const MSG_PLUS = "Les bons d'intervention sont disponibles avec la licence Plus.";
export const MSG_INACTIF = "Les bons d'intervention ne sont pas activés pour votre entreprise. Activez-les sur la page Entreprise.";

/* Licence Plus du client ? */
export async function licencePlus(clientId) {
  const code = String(clientId || "").trim().toUpperCase();
  if (!code) return false;
  const lic = await Licence.findOne({ codeClient: code }, "type").lean();
  return lic?.type === "plus";
}

/* Motif de refus, ou null si l'accès est autorisé. */
export async function refusBons(clientId, entreprise) {
  if (!(await licencePlus(clientId))) return MSG_PLUS;
  if (!entreprise?.bonsInterventionActifs) return MSG_INACTIF;
  return null;
}
