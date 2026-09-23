import mongoose from "mongoose";

/* ───────────────────────────────────────────────────────────────
   Communication clients (envoi de mails groupés depuis l'admin).

   Un document par envoi (réel ou test). Il sert :
   - d'historique des envois (liste dans admin.html, tests exclus) ;
   - de support à l'image jointe : l'image est stockée ici (data URL)
     et servie publiquement par GET /api/admin/communication/:id/image,
     car les messageries (Gmail, Outlook…) n'affichent pas les images
     intégrées en data URL dans un e-mail.
   ─────────────────────────────────────────────────────────────── */

const destinataireSchema = new mongoose.Schema({
  code:   String,
  nom:    String,
  email:  String,
  ok:     Boolean,
  erreur: String
}, { _id: false });

const communicationSchema = new mongoose.Schema({
  sujet:       { type: String, required: true },
  message:     { type: String, required: true },
  boutonTexte: { type: String, default: "" },
  boutonUrl:   { type: String, default: "" },
  image:       { type: String, default: "" },      // data URL (image/jpeg ou image/png)
  cible:       { type: Object, default: {} },      // { types:[], statuts:[], actifsSeulement }
  test:        { type: Boolean, default: false },
  destinataires: [destinataireSchema],
  nbEnvoyes:   { type: Number, default: 0 },
  nbEchecs:    { type: Number, default: 0 },
  date:        { type: Date, default: Date.now }
});

export default mongoose.models.Communication || mongoose.model("Communication", communicationSchema);
