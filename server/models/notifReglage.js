import mongoose from "mongoose";

/* ───────────────────────────────────────────────────────────────
   Réglages de notification par entreprise.

   Pour l'instant un seul réglage : le délai (en minutes) AVANT l'heure
   d'un RDV auquel le rappel push est envoyé au salarié.

   Collection dédiée et isolée (un document par clientId) : aucun impact
   sur les schémas existants (donnees, licences…). Valeur par défaut 45.
   ─────────────────────────────────────────────────────────────── */
const notifReglageSchema = new mongoose.Schema({
  clientId:    { type: String, required: true, unique: true },
  delaiRdvMin: { type: Number, default: 45, min: 0, max: 1440 },
  updatedAt:   { type: Date, default: Date.now }
});

export default mongoose.model("NotifReglage", notifReglageSchema);
