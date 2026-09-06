import mongoose from "mongoose";

// Signature personnelle d'un salarié, réutilisée automatiquement pour
// remplir les champs "Signature" des bons d'intervention. Collection
// dédiée (comme documentchantier) : une signature par salarié, écrasée
// à chaque nouvel enregistrement (pas d'historique).
const signatureSalarieSchema = new mongoose.Schema({
  clientId:  { type: String, required: true, uppercase: true, trim: true, index: true },
  salarieId: { type: String, required: true },
  data:      { type: String, default: "" },  // image PNG en base64 (data URL complète)
  maj:       { type: Date, default: Date.now }
});

signatureSalarieSchema.index({ clientId: 1, salarieId: 1 }, { unique: true });

export default mongoose.model("SignatureSalarie", signatureSalarieSchema);
