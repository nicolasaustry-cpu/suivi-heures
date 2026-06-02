import mongoose from "mongoose";

// Une entrée de la base d'aide (question / réponse du chatbot).
const faqSchema = new mongoose.Schema({
  theme:    { type: String, default: "Général" }, // regroupement (ex : "Planning")
  question: { type: String, required: true },
  reponse:  { type: String, required: true },
  ordre:    { type: Number, default: 0 },         // pour trier l'affichage
  updatedAt:{ type: Date,   default: Date.now }
});

export default mongoose.model("Faq", faqSchema);
