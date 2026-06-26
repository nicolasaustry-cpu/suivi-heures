import mongoose from "mongoose";

/* ───────────────────────────────────────────────────────────────
   Abonnement aux notifications push (Web Push / VAPID).

   Un document = un appareil/navigateur abonné. L'`endpoint` fourni
   par le navigateur est unique par appareil : on l'utilise comme clé
   d'unicité et on fait un upsert dessus. Ainsi :
     - si le même appareil se réabonne, on met simplement à jour son
       document (pas de doublon) ;
     - si un autre salarié se connecte sur ce même appareil et s'abonne,
       l'abonnement est réattribué à ce salarié (comportement voulu).

   Un même salarié peut avoir PLUSIEURS abonnements (téléphone + PC, etc.).
   Tout est cloisonné par `clientId` (multi-entreprises).
   ─────────────────────────────────────────────────────────────── */
const pushSubscriptionSchema = new mongoose.Schema({
  clientId:  { type: String, required: true, index: true },
  salarieId: { type: Number, required: true },

  // Données brutes de l'abonnement renvoyées par le navigateur
  endpoint:  { type: String, required: true, unique: true },
  p256dh:    { type: String, required: true },  // subscription.keys.p256dh
  auth:      { type: String, required: true },  // subscription.keys.auth

  // Indicatif (diagnostic / identification d'appareil), non sensible
  userAgent: { type: String, default: "" },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Recherche rapide « tous les abonnements d'un salarié d'une entreprise »
// (utilisée à l'envoi des rappels de RDV).
pushSubscriptionSchema.index({ clientId: 1, salarieId: 1 });

export default mongoose.model("PushSubscription", pushSubscriptionSchema);
