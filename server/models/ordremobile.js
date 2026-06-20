import mongoose from "mongoose";

// Ordre d'affichage des chantiers côté MOBILE, fixé par le gérant depuis la Vue équipe.
// N'affecte PAS le planning PC. Stocké dans une collection séparée pour ne jamais
// être écrasé par la synchronisation du poste patron (qui ne touche qu'à "Donnees").
//   ordres = { "<salarieId>_<YYYY-MM-DD>": ["NOM CHANTIER A", "NOM CHANTIER B", ...] }
const ordreMobileSchema = new mongoose.Schema({
  clientId:  { type: String, required: true, unique: true },
  ordres:    { type: Object, default: {} },
  updatedAt: { type: Date,   default: Date.now }
});

export default mongoose.model("OrdreMobile", ordreMobileSchema);
