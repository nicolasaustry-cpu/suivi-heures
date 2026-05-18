import mongoose from "mongoose";

// Stocke toutes les données d'un client (salariés, heures, planning, prévisionnel)
const donneesSchema = new mongoose.Schema({
  clientId:     { type: String, required: true, unique: true }, // = codeClient
  entreprise:   { type: Object, default: {} },
  salaries:     { type: Array,  default: [] },
  heures:       { type: Object, default: {} },
  chantiers:    { type: Array,  default: [] },
  previsionnel: { type: Object, default: {} },
  updatedAt:    { type: Date,   default: Date.now }
});

export default mongoose.model("Donnees", donneesSchema);
