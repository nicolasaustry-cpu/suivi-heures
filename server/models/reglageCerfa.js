import mongoose from "mongoose";

// Valeurs CERFA propres à l'entreprise, mémorisées à la première saisie et
// reproposées ensuite (opérateur, n° d'attestation de capacité, détecteur,
// installation de destination du fluide…). Une fiche par compte client.
const reglageCerfaSchema = new mongoose.Schema({
  clientId: { type: String, required: true, uppercase: true, trim: true, unique: true },
  valeurs:  { type: Object, default: {} },   // { operateur, attestation, detecteur, installation, qualiteOperateur }
  maj:      { type: Date, default: Date.now }
});

export default mongoose.model("ReglageCerfa", reglageCerfaSchema);
