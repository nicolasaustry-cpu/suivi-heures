import mongoose from "mongoose";

// Un bon = une fiche d'intervention remplie sur mobile à partir d'un masque.
// Collection dédiée (comme documentchantier), pour ne pas alourdir la
// synchro ni la sauvegarde quotidienne.
const bonInterventionSchema = new mongoose.Schema({
  clientId:        { type: String, required: true, uppercase: true, trim: true, index: true },
  numero:          { type: String, default: "" },   // « 2026-0001 », séquence par client et par année
  chantier:        { type: String, required: true, trim: true },  // nom du chantier (MAJUSCULES, comme le reste)
  masqueId:        { type: mongoose.Schema.Types.ObjectId, required: true, ref: "MasqueIntervention" },
  masqueNom:       { type: String, default: "" },  // copié au moment du remplissage (garde son sens si le masque est modifié/supprimé ensuite)
  // Copie des champs du masque au moment du remplissage : le bon reste lisible
  // et imprimable à l'identique même si le client modifie ou supprime le masque.
  masqueChamps:    { type: Array, default: [] },
  // Équipement du parc client concerné (facultatif) + copie figée de ses
  // caractéristiques au moment du bon (type, marque, modèle, n° de série…).
  equipementId:    { type: mongoose.Schema.Types.ObjectId, default: null, ref: "Equipement" },
  equipement:      { type: Object, default: null },
  salarieId:       { type: String, default: "" },
  salarieNom:      { type: String, default: "" },
  dateIntervention: { type: String, default: "" },  // AAAA-MM-JJ
  // Réponses : { idChamp: valeur }. Le format de la valeur dépend du type de
  // champ défini dans le masque (chaîne, booléen, tableau d'options, photos
  // en base64, signature en base64) — volontairement libre (Mixed) car la
  // structure varie selon le masque.
  reponses:        { type: mongoose.Schema.Types.Mixed, default: {} },
  // Historique des envois au client depuis le PC : [{ a, copie, le }]
  envois:          { type: Array, default: [] },
  creeLe:          { type: Date, default: Date.now }
});

bonInterventionSchema.index({ clientId: 1, chantier: 1 });
bonInterventionSchema.index({ clientId: 1, creeLe: -1 });
bonInterventionSchema.index({ clientId: 1, equipementId: 1 });

// Compteur de numérotation (un document par client et par année).
// findOneAndUpdate + $inc est atomique : deux bons envoyés en même temps
// ne peuvent pas recevoir le même numéro.
const compteurBonSchema = new mongoose.Schema({
  _id:    { type: String },          // « CLIENTID-2026 »
  valeur: { type: Number, default: 0 }
});
export const CompteurBon = mongoose.model("CompteurBon", compteurBonSchema);

export async function prochainNumeroBon(clientId, date) {
  const annee = (date ? new Date(date) : new Date()).getFullYear();
  const c = await CompteurBon.findOneAndUpdate(
    { _id: `${clientId}-${annee}` },
    { $inc: { valeur: 1 } },
    { upsert: true, new: true }
  );
  return `${annee}-${String(c.valeur).padStart(4, "0")}`;
}

export default mongoose.model("BonIntervention", bonInterventionSchema);
