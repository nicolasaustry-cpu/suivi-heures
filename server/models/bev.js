import mongoose from "mongoose";

/* Un document BEV par (client, salarié, mois).
   retenues : { "YYYY-MM-DD": heures décimales retenues } — surcharges du réalisé.
   valide   : mois marqué validé/signé (informatif, ne verrouille pas la saisie). */
const bevSchema = new mongoose.Schema({
  clientId:  { type: String, required: true },
  salarieId: { type: String, required: true },
  mois:      { type: String, required: true },     // "YYYY-MM"
  retenues:  { type: Object, default: {} },
  reporte:   { type: Number, default: 0 },
  evenements:{ type: Object, default: {} },
  indemnites:{ type: Object, default: {} },     // { trajet:bool, transport:bool, repas:bool }
  tranches:  { type: Object, default: {} },     // { "YYYY-MM-DD": "IA"|"IB"|... }
  valide:    { type: Boolean, default: false },
  updatedAt: { type: Date,   default: Date.now }
});

bevSchema.index({ clientId: 1, salarieId: 1, mois: 1 }, { unique: true });

export default mongoose.model("Bev", bevSchema);
