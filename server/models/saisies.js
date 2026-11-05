import mongoose from "mongoose";

const saisieChantierSchema = new mongoose.Schema({
  nom:          { type: String, required: true },
  heureArrivee: { type: String, default: "" },  // "HH:MM"
  heureDepart:  { type: String, default: "" },  // "HH:MM"
  dureeMin:     { type: Number, default: 0 },   // durée en minutes (pause déjà déduite)
  deplacement:  { type: Number, default: 0 },   // temps déplacement en minutes
  pause:        { type: Number, default: 0 },   // temps de pause en minutes (déduit de la durée)
  note:         { type: String, default: "" },   // note libre du chantier (saisie/dictée mobile)
  photos:       { type: [String], default: [] }, // photos compressées (data URL JPEG, 3 max)
  noteFaite:    { type: Boolean, default: false }, // note marquée « réalisée »
  isPrevisionnel: { type: Boolean, default: false },
  // Rang du passage sur ce chantier CE JOUR-LÀ (1 = premier passage, 2 = deuxième…).
  // Permet de distinguer deux visites du même chantier séparées par un autre chantier
  // dans la même journée, qui sans ce champ étaient fusionnées en une seule entrée
  // (la seconde écrasait la première). Par défaut 1 : ne change rien pour l'immense
  // majorité des saisies, où un chantier n'apparaît qu'une fois par jour.
  occurrence:   { type: Number, default: 1 }
}, { _id: false });

const saisieJournaliereSchema = new mongoose.Schema({
  clientId:   { type: String, required: true },
  salarieId:  { type: Number, required: true },
  salarieNom: { type: String, default: "" },
  date:       { type: String, required: true }, // "YYYY-MM-DD"
  chantiers:  [saisieChantierSchema],
  totalMin:   { type: Number, default: 0 },
  pauseJournee: { type: Number, default: 0 }, // pause déjeuner hors chantier, en minutes — JAMAIS comptée comme travail
  statut:     { type: String, enum: ["envoyee", "validee"], default: "envoyee" },
  createdAt:  { type: Date, default: Date.now },
  updatedAt:  { type: Date, default: Date.now }
});

// Index unique : un salarié ne peut envoyer qu'une saisie par jour
saisieJournaliereSchema.index({ clientId: 1, salarieId: 1, date: 1 }, { unique: true });

export default mongoose.model("Saisie", saisieJournaliereSchema);
