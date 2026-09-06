import mongoose from "mongoose";

// Un masque = un modèle de bon d'intervention personnalisé par le client.
// Le client peut créer plusieurs masques (un par type d'intervention : SAV,
// contrôle réglementaire, etc.). Chaque masque définit les champs affichés
// dynamiquement sur mobile lors du remplissage d'un bon.
const champMasqueSchema = new mongoose.Schema({
  id:          { type: String, required: true },   // identifiant stable du champ (ex: "champ_1")
  libelle:     { type: String, required: true, trim: true },
  type:        { type: String, enum: ["texte", "case", "liste", "cases_multiples", "photo", "signature", "datetime"], required: true },
  obligatoire: { type: Boolean, default: false },
  dictee:      { type: Boolean, default: false },   // type "texte" uniquement : dictée vocale autorisée sur mobile
  signataire:  { type: String, enum: ["salarie", "client"], default: "salarie" }, // type "signature" uniquement : qui signe
  options:     { type: [String], default: [] },     // pour type "liste" ou "cases_multiples"
  // Pré-remplissage automatique depuis Suiv'Heures (type "datetime" uniquement) :
  auto:        { type: String, enum: ["", "date", "heureDebut", "heureFin", "duree"], default: "" }
}, { _id: false });

const masqueInterventionSchema = new mongoose.Schema({
  clientId:  { type: String, required: true, uppercase: true, trim: true, index: true },
  nom:       { type: String, required: true, trim: true },   // ex: "Contrôle réglementaire CVC"
  actif:     { type: Boolean, default: true },
  champs:    { type: [champMasqueSchema], default: [] },
  creeLe:    { type: Date, default: Date.now },
  modifieLe: { type: Date, default: Date.now }
});

masqueInterventionSchema.index({ clientId: 1, nom: 1 });

export default mongoose.model("MasqueIntervention", masqueInterventionSchema);
