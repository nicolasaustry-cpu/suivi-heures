import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const prescripteurSchema = new mongoose.Schema({
  identifiant:  { type: String, required: true, unique: true, uppercase: true, trim: true },
  motDePasse:   { type: String, required: true },
  nom:          { type: String, default: "" },     // nom du prescripteur (affichage)
  actif:        { type: Boolean, default: true },
  dateCreation: { type: Date, default: Date.now }
});

// Hacher le mot de passe avant sauvegarde, seulement s'il a changé
prescripteurSchema.pre("save", async function (next) {
  if (!this.isModified("motDePasse")) return next();
  this.motDePasse = await bcrypt.hash(this.motDePasse, 10);
  next();
});

prescripteurSchema.methods.verifierMotDePasse = function (clair) {
  return bcrypt.compare(clair, this.motDePasse);
};

export default mongoose.model("Prescripteur", prescripteurSchema);
