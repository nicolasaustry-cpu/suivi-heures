import mongoose from "mongoose";

/* Un document par entreprise cliente (clientId) : identifiants API Henrri
   + suivi des devis déjà affectés au prévisionnel (pour ne pas les reproposer).
   Collection DÉDIÉE et isolée : ces identifiants ne transitent jamais par la
   synchronisation générale de "entreprisedata" (localStorage → /api/data),
   qui écraserait/dupliquerait ces données à chaque sauvegarde de page (même
   principe que OrdreMobile ou NotifReglage). */
const henrriSchema = new mongoose.Schema({
  clientId:           { type: String, required: true, unique: true },
  actif:              { type: Boolean, default: false },
  henrriClientId:     { type: String, default: "" },
  henrriClientSecret: { type: String, default: "" },
  devisImportes:      { type: [String], default: [] }, // IDs de documents Henrri déjà affectés au prévisionnel
  devisIgnores:       { type: [String], default: [] }, // IDs de devis écartés manuellement (ne plus proposer)
  clientsCache:       { type: Array, default: [] },   // dernière liste de clients Henrri récupérée (rafraîchie manuellement)
  clientsCacheLe:     { type: Date,  default: null },
  updatedAt:          { type: Date, default: Date.now }
});

export default mongoose.model("Henrri", henrriSchema);
