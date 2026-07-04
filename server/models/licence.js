import mongoose from "mongoose";

const licenceSchema = new mongoose.Schema({
  codeClient:      { type: String, required: true, unique: true, uppercase: true, trim: true },
  nomClient:       { type: String, default: "" },
  email:           { type: String, default: "" },
  type:            { type: String, enum: ["standard", "plus"], default: "standard" },
  origine:         { type: String, enum: ["auto", "manuel"], default: "manuel" },      // auto = auto-inscription (essai), manuel = créé par l'admin
  statut:          { type: String, enum: ["prospect", "client", "gratuit", "test", "essai"], default: "client" },
  datePaiement:    { type: Date, default: null },                                       // date de paiement (facturation)
  actif:           { type: Boolean, default: true },
  dateActivation:  { type: Date, default: Date.now },
  dateExpiration:  { type: Date, required: true },
  notes:           { type: String, default: "" },
  prescripteur:    { type: String, default: "", uppercase: true, trim: true },  // identifiant du prescripteur rattaché
  marquePartenaire:{ type: Boolean, default: false },                            // marque blanche : masque "Volitis", affiche le logo du prescripteur
  logoPartenaire:  { type: String,  default: "" }                               // logo du prescripteur (image en data URL base64)
});

export default mongoose.model("Licence", licenceSchema);
