import mongoose from "mongoose";

// Parc d'équipements d'un client (PAC, chaudière, climatisation…).
// Un équipement est rattaché à un client par sa clé normalisée (même règle
// que la page Clients : majuscules, sans accents ni ponctuation, sans le
// n° de devis Henrri « 26-09-1 »), ce qui le relie aussi à tous les chantiers
// de ce client (« MARY GERARD », « MARY GERARD 26-10-3 »…).
const equipementSchema = new mongoose.Schema({
  clientId:     { type: String, required: true, uppercase: true, trim: true, index: true },
  clientCle:    { type: String, required: true, trim: true },   // clé normalisée du client
  clientNom:    { type: String, default: "" },                   // nom affiché (tel que saisi)
  type:         { type: String, default: "", trim: true },       // ex. « Pompe à Chaleur Air Eau »
  marque:       { type: String, default: "", trim: true },
  modele:       { type: String, default: "", trim: true },       // modèle / référence
  numeroSerie:  { type: String, default: "", trim: true },
  emplacement:  { type: String, default: "", trim: true },       // ex. « Garage », « Unité extérieure façade nord »
  miseEnService:{ type: String, default: "" },                   // AAAA-MM-JJ
  fluide:       { type: String, default: "", trim: true },       // ex. « R32 » (préparation Cerfa 15497)
  chargeKg:     { type: Number, default: null },
  notes:        { type: String, default: "" },
  creePar:      { type: String, default: "" },                   // « bureau » ou nom du salarié (mobile)
  creeLe:       { type: Date, default: Date.now },
  modifieLe:    { type: Date, default: Date.now }
});

equipementSchema.index({ clientId: 1, clientCle: 1 });

/* Clé client : identique à _cle() de public/clients.html. */
const RE_REF_DEVIS = /\s+\d{2}-\d{2}-\d+\s*$/;
export function cleClient(nom) {
  return String(nom || "").trim().replace(RE_REF_DEVIS, "").trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

/* Libellé court d'un équipement (listes, PDF). */
export function libelleEquipement(e) {
  if (!e) return "";
  const tete = [e.type, e.marque].filter(Boolean).join(" ");
  const ref = [e.modele, e.numeroSerie ? "n° série " + e.numeroSerie : ""].filter(Boolean).join(" — ");
  return [tete, ref].filter(Boolean).join(" — ") + (e.emplacement ? ` (${e.emplacement})` : "");
}

export default mongoose.model("Equipement", equipementSchema);
