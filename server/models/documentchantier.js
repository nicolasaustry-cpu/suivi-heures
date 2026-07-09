import mongoose from "mongoose";

// Un document = un PDF joint à un chantier. Collection DÉDIÉE (jamais dans le
// document `donnees` du client) pour ne pas alourdir la synchro ni la sauvegarde
// quotidienne. Un PDF n'est chargé que lorsqu'on l'ouvre explicitement.
const documentChantierSchema = new mongoose.Schema({
  clientId:   { type: String, required: true },   // MAJUSCULES
  chantier:   { type: String, required: true },   // MAJUSCULES (nom du chantier)
  nom:        { type: String, default: "document.pdf" }, // nom de fichier affiché
  mime:       { type: String, default: "application/pdf" },
  taille:     { type: Number, default: 0 },        // octets (fichier binaire)
  data:       { type: String, default: "" },       // base64 SANS préfixe data:
  auteur:     { type: String, default: "" },
  uploadedAt: { type: Date,   default: Date.now }
});

documentChantierSchema.index({ clientId: 1, chantier: 1 });

export default mongoose.model("DocumentChantier", documentChantierSchema);
