import webpush from "web-push";
import PushSubscription from "../models/pushSubscription.js";

/* ───────────────────────────────────────────────────────────────
   Moteur d'envoi des notifications push (Web Push / VAPID).

   - Configure web-push avec les clés VAPID (variables d'environnement).
   - envoyerNotif() pousse une notification à TOUS les appareils d'un
     salarié donné, et supprime au passage les abonnements devenus
     invalides (le navigateur a désinstallé l'app, vidé ses données…).
   ─────────────────────────────────────────────────────────────── */

let _configure = false;

function configurer() {
  if (_configure) return true;
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn("⚠️  VAPID non configuré (clés manquantes) : envoi push désactivé");
    return false;
  }
  const sujet = process.env.VAPID_SUBJECT || "mailto:contact@volitis.net";
  webpush.setVapidDetails(sujet, pub, priv);
  _configure = true;
  return true;
}

/* Envoie une notification à tous les abonnements d'un salarié.
   payload : objet { titre, corps, url, tag } (sérialisé en JSON).
   Renvoie { envoyes, supprimes }. Ne lève jamais : les erreurs par
   appareil sont isolées pour ne pas bloquer les autres envois. */
export async function envoyerNotif(clientId, salarieId, payload) {
  if (!configurer()) return { envoyes: 0, supprimes: 0 };

  const abos = await PushSubscription.find({ clientId, salarieId: Number(salarieId) });
  if (!abos.length) return { envoyes: 0, supprimes: 0 };

  const corpsJSON = JSON.stringify(payload || {});
  let envoyes = 0, supprimes = 0;

  await Promise.all(abos.map(async (a) => {
    const subscription = {
      endpoint: a.endpoint,
      keys: { p256dh: a.p256dh, auth: a.auth }
    };
    try {
      await webpush.sendNotification(subscription, corpsJSON);
      envoyes++;
    } catch (err) {
      const code = err && err.statusCode;
      // 404 / 410 (Gone) : l'abonnement n'existe plus côté navigateur → on le retire
      if (code === 404 || code === 410) {
        try { await PushSubscription.deleteOne({ _id: a._id }); supprimes++; } catch (_) {}
      } else {
        console.warn("⚠️  Échec envoi push :", code || (err && err.message));
      }
    }
  }));

  return { envoyes, supprimes };
}
