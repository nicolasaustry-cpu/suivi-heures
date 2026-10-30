import mongoose from "mongoose";

/* ═══════════════════════════════════════════════════════════════
   AGENDA DU DIRIGEANT — un document par rendez-vous
   ═══════════════════════════════════════════════════════════════
   Le rendez-vous est saisi par le gérant sur son téléphone (agenda.html).
   L'agenda est la référence du rendez-vous (heure de fin, lieu, type,
   participants) ; chaque participant reçoit en plus une case dans le
   planning (Donnees.heures) portant agendaId = rdvId, ce qui permet de la
   retrouver même si elle a été déplacée dans le planning entre-temps.

   type : "client"   → RDV client : payé, classé « RDV client » (exclu des
                       heures productives, du prévisionnel et de la jauge)
          "visite"   → compte normalement
          "chantier" → compte normalement
   ═══════════════════════════════════════════════════════════════ */
const agendaRdvSchema = new mongoose.Schema({
  clientId: { type: String, required: true, index: true },
  rdvId:    { type: String, required: true },
  gerantId: { type: String, default: "" },
  date:     { type: String, required: true },     // YYYY-MM-DD
  debut:    { type: String, required: true },     // HH:MM
  fin:      { type: String, required: true },     // HH:MM
  titre:    { type: String, required: true },     // = nom du chantier (majuscules)
  type:     { type: String, enum: ["client", "visite", "chantier"], default: "client" },
  lieu:     { type: String, default: "" },
  tel:      { type: String, default: "" },        // téléphone du contact (aussi reporté sur la fiche chantier)
  salaries: { type: [String], default: [] },      // ids des participants
  note:     { type: String, default: "" },
  creeLe:   { type: Date, default: Date.now },
  majLe:    { type: Date, default: Date.now }
});

agendaRdvSchema.index({ clientId: 1, rdvId: 1 }, { unique: true });
agendaRdvSchema.index({ clientId: 1, date: 1 });

export default mongoose.models.AgendaRdv || mongoose.model("AgendaRdv", agendaRdvSchema);
