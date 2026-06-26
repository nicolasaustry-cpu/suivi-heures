import cron from "node-cron";
import Donnees from "../models/donnees.js";
import NotifReglage from "../models/notifReglage.js";
import { envoyerNotif } from "../services/pushSender.js";

/* ───────────────────────────────────────────────────────────────
   Rappels de RDV par notification push.

   Toutes les minutes (heure de Paris), on parcourt les RDV planifiés
   du jour. Pour chacun, le rappel part EXACTEMENT à la minute
   « heure du RDV − délai effectif » :
     délai effectif = rdvDelai du RDV  →  sinon délai de l'entreprise
                                       →  sinon 45 min.
   Pas de rattrapage : si la minute est manquée (serveur éteint), on
   ne renvoie pas. Anti-doublon : marqueur `rdvNotifie` en base
   (= l'heure notifiée) + garde-fou mémoire pour la durée du process.
   ─────────────────────────────────────────────────────────────── */

const DELAI_DEFAUT = 45;

let _enCours = false;          // évite le chevauchement si un tick dépasse une minute
let _jourMemo = null;          // pour purger le garde-fou mémoire au changement de jour
const _dejaNotifie = new Set(); // signatures déjà notifiées dans ce process

/* Date "YYYY-MM-DD" et minutes-depuis-minuit, en heure de Paris. */
function maintenantParis() {
  const parts = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const g = t => (parts.find(p => p.type === t) || {}).value;
  let h = g('hour'); if (h === '24') h = '00';   // certains environnements renvoient "24" à minuit
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    minutes: parseInt(h, 10) * 60 + parseInt(g('minute'), 10)
  };
}

/* "HH:MM" → minutes depuis minuit (ou null si invalide). */
function hhmmEnMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || '').trim());
  if (!m) return null;
  const h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/* Décompose une clé `${salarieId}${YYYY_MM_DD}ch${i}` → { salarieId, date }. */
function decoderCle(cle) {
  const m = /^(\d+)(\d{4})_(\d{2})_(\d{2})ch(\d+)$/.exec(cle);
  if (!m) return null;
  return { salarieId: m[1], date: `${m[2]}-${m[3]}-${m[4]}` };
}

async function verifierEtEnvoyer() {
  if (_enCours) return;
  _enCours = true;
  try {
    const now = maintenantParis();
    if (now.date !== _jourMemo) { _dejaNotifie.clear(); _jourMemo = now.date; }

    // Délai par entreprise (défaut 45 si non réglé)
    const reglages = await NotifReglage.find({}, { clientId: 1, delaiRdvMin: 1 }).lean();
    const delaiParClient = {};
    reglages.forEach(r => { delaiParClient[r.clientId] = r.delaiRdvMin; });

    // On ne charge que ce qui est utile
    const docs = await Donnees.find({}, { clientId: 1, heures: 1 }).lean();
    const envois = [];

    for (const doc of docs) {
      const heures = doc.heures || {};
      const delaiEntreprise = (delaiParClient[doc.clientId] != null) ? delaiParClient[doc.clientId] : DELAI_DEFAUT;

      for (const cle of Object.keys(heures)) {
        const entry = heures[cle];
        if (!entry || !entry.rdv) continue;
        if (entry.rdvNotifie === entry.rdv) continue;        // déjà notifié pour cette heure

        const info = decoderCle(cle);
        if (!info || info.date !== now.date) continue;        // RDV pas daté d'aujourd'hui

        const rdvMin = hhmmEnMinutes(entry.rdv);
        if (rdvMin == null) continue;

        // Délai effectif : spécifique au RDV, sinon entreprise, sinon défaut
        let delai = delaiEntreprise;
        if (entry.rdvDelai != null && entry.rdvDelai !== '') {
          const dv = parseInt(entry.rdvDelai, 10);
          if (!isNaN(dv)) delai = dv;
        }

        const cible = rdvMin - delai;
        if (cible < 0 || cible !== now.minutes) continue;     // pas la minute exacte (aucun rattrapage)

        const sig = `${doc._id}|${cle}|${entry.rdv}`;
        if (_dejaNotifie.has(sig)) continue;
        _dejaNotifie.add(sig);

        const chantier = (entry.chantier || '').trim();
        const payload = {
          titre: "Rappel de RDV",
          corps: chantier ? `${chantier} à ${entry.rdv}` : `Rendez-vous à ${entry.rdv}`,
          url:   "/saisie.html",
          tag:   "rdv-" + cle
        };

        envois.push(
          envoyerNotif(doc.clientId, info.salarieId, payload)
            .then(() => Donnees.updateOne(
              { _id: doc._id },
              { $set: { [`heures.${cle}.rdvNotifie`]: entry.rdv } }
            ))
            .catch(err => console.warn("⚠️  Rappel RDV (envoi/marquage) :", err && err.message))
        );
      }
    }

    if (envois.length) await Promise.all(envois);
  } catch (err) {
    console.error("⚠️  Job rappels RDV :", err && err.message);
  } finally {
    _enCours = false;
  }
}

export function planifierRappelsRdv() {
  cron.schedule('* * * * *', verifierEtEnvoyer, { timezone: 'Europe/Paris' });
  console.log("⏰ Job de rappels RDV planifié (chaque minute, Europe/Paris)");
}
