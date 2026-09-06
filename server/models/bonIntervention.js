import mongoose from "mongoose";

// Un bon = une fiche d'intervention remplie sur mobile à partir d'un masque.
// Collection dédiée (comme documentchantier), pour ne pas alourdir la
// synchro ni la sauvegarde quotidienne.
const bonInterventionSchema = new mongoose.Schema({
  clientId:        { type: String, required: true, uppercase: true, trim: true, index: true },
  chantier:        { type: String, required: true, trim: true },  // nom du chantier (MAJUSCULES, comme le reste)
  masqueId:        { type: mongoose.Schema.Types.ObjectId, required: true, ref: "MasqueIntervention" },
  masqueNom:        { type: String, default: "" },  // copié au moment du remplissage (garde son sens si le masque est modifié/supprimé ensuite)
  salarieId:       { type: String, default: "" },
  salarieNom:      { type: String, default: "" },
  dateIntervention: { type: String, default: "" },  // AAAA-MM-JJ
  // Réponses : { idChamp: valeur }. Le format de la valeur dépend du type de
  // champ défini dans le masque (chaîne, booléen, tableau d'options, photos
  // en base64, signature en base64) — volontairement libre (Mixed) car la
  // structure varie selon le masque.
  reponses:        { type: mongoose.Schema.Types.Mixed, default: {} },
  creeLe:          { type: Date, default: Date.now }
});

bonInterventionSchema.index({ clientId: 1, chantier: 1 });

export default mongoose.model("BonIntervention", bonInterventionSchema);
