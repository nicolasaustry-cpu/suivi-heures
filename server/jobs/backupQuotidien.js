// ─────────────────────────────────────────────────────────────
// Sauvegarde quotidienne « maison »  (Suiv'Heures / Volitis)
// ─────────────────────────────────────────────────────────────
// Chaque nuit, on copie TOUTES les collections de données de la base
// dans une collection d'historique unique : `donnees_history`.
//   • toutes licences confondues (Standard + Plus)
//   • un instantané par jour et par document
//   • rétention 30 jours (les instantanés plus vieux sont purgés)
//
// Objectif : pouvoir restaurer FACILEMENT les données d'UN client à une
// date donnée, sans avoir à monter un cluster temporaire depuis un snapshot
// Atlas (procédure lourde utilisée lors de l'incident 2CPEBAT26).
//
// Le job travaille en natif sur la connexion Mongoose (mongoose.connection.db)
// → AUCUNE dépendance à tes modèles : si le schéma évolue, le backup continue.
//
// Restauration type (depuis le shell mongosh ou Compass) :
//   db.donnees_history.find({ clientId: "2CPEBAT26" }).sort({ backupAt: -1 })
//   → on récupère le champ `donnees` (le document complet d'origine)
//   → on réinjecte dans la collection source (`source`)
// ─────────────────────────────────────────────────────────────

import cron from "node-cron";
import mongoose from "mongoose";

// ── Réglages (surchargeables par variables d'environnement Railway) ──
const HISTORY_COLL   = "donnees_history";
const RETENTION_JOURS = Number(process.env.BACKUP_RETENTION_JOURS) || 30;
const HEURE_CRON     = process.env.BACKUP_CRON || "30 3 * * *"; // 03h30 chaque jour
const TZ             = "Europe/Paris";
const LANCER_AU_DEMARRAGE = process.env.BACKUP_AU_DEMARRAGE === "1"; // utile au 1er déploiement

// Collections à NE JAMAIS sauvegarder (l'historique lui-même, les collections
// système, plus toute liste perso via BACKUP_EXCLURE="logs,sessions").
const EXCLUES = new Set(
  [HISTORY_COLL, ...(process.env.BACKUP_EXCLURE || "").split(",")]
    .map(s => s.trim())
    .filter(Boolean)
);

// Champs candidats pour identifier le client (normalisé en MAJUSCULES,
// cohérent avec la normalisation clientId existante de l'app).
const CHAMPS_CLIENT = ["clientId", "client", "codeClient", "licence", "code"];

const BATCH = 500; // insertion par paquets

// ── Utilitaires ──────────────────────────────────────────────
function jourParis(d = new Date()) {
  // 'YYYY-MM-DD' dans le fuseau Europe/Paris (indépendant du fuseau serveur)
  const p = new Intl.DateTimeFormat("fr-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
  return p; // fr-CA donne déjà 2026-06-22
}

function extraireClientId(doc) {
  for (const champ of CHAMPS_CLIENT) {
    const v = doc?.[champ];
    if (typeof v === "string" && v.trim()) return v.trim().toUpperCase();
  }
  return null;
}

function db() {
  return mongoose.connection.db;
}

function connexionOK() {
  return mongoose.connection.readyState === 1 && !!db();
}

// ── Index de l'historique (rapidité des restaurations) ───────
async function assurerIndex() {
  const coll = db().collection(HISTORY_COLL);
  await coll.createIndex({ clientId: 1, backupAt: -1 });
  await coll.createIndex({ snapshotDate: 1 });
  await coll.createIndex({ source: 1, snapshotDate: 1 });
}

// ── Y a-t-il déjà un instantané pour aujourd'hui ? ────────────
// Évite les doublons (redémarrage Railway, double instance, relance manuelle).
async function snapshotDejaFait(jour) {
  const n = await db().collection(HISTORY_COLL).countDocuments({ snapshotDate: jour }, { limit: 1 });
  return n > 0;
}

// ── Purge des instantanés au-delà de la rétention ────────────
async function purgerAnciens() {
  const limite = new Date(Date.now() - RETENTION_JOURS * 24 * 3600 * 1000);
  const r = await db().collection(HISTORY_COLL).deleteMany({ backupAt: { $lt: limite } });
  if (r.deletedCount) console.log(`🧹 Purge historique : ${r.deletedCount} instantané(s) > ${RETENTION_JOURS} j supprimé(s).`);
}

// ── Liste des collections à sauvegarder ──────────────────────
async function collectionsASauvegarder() {
  const infos = await db().listCollections().toArray();
  return infos
    .filter(c => c.type === "collection")           // pas les vues
    .map(c => c.name)
    .filter(name => !name.startsWith("system.") && !EXCLUES.has(name));
}

// ── Cœur : copie d'une collection vers l'historique ──────────
async function sauvegarderCollection(nom, jour, backupAt) {
  const source = db().collection(nom);
  const cible  = db().collection(HISTORY_COLL);
  const curseur = source.find({}, { noCursorTimeout: false });

  let tampon = [];
  let total = 0;

  const flush = async () => {
    if (!tampon.length) return;
    await cible.insertMany(tampon, { ordered: false });
    total += tampon.length;
    tampon = [];
  };

  for await (const doc of curseur) {
    tampon.push({
      snapshotDate: jour,            // '2026-06-22'
      backupAt,                      // Date précise de l'instantané
      source: nom,                   // collection d'origine (pour réinjecter)
      clientId: extraireClientId(doc), // null si non identifiable
      refId: doc._id,                // _id du document d'origine
      donnees: doc                   // copie INTÉGRALE du document
    });
    if (tampon.length >= BATCH) await flush();
  }
  await flush();
  return total;
}

// ── Sauvegarde complète (export pour déclenchement manuel) ───
export async function sauvegarderMaintenant({ force = false } = {}) {
  if (!connexionOK()) {
    console.warn("⏭️  Sauvegarde quotidienne ignorée : MongoDB non connecté pour l'instant.");
    return { ok: false, raison: "mongo_indisponible" };
  }

  const jour = jourParis();
  const backupAt = new Date();

  try {
    await assurerIndex();

    if (!force && await snapshotDejaFait(jour)) {
      console.log(`ℹ️  Instantané du ${jour} déjà présent — sauvegarde sautée (utilisez force pour relancer).`);
      await purgerAnciens();
      return { ok: true, saute: true, jour };
    }

    const collections = await collectionsASauvegarder();
    console.log(`💾 Sauvegarde ${jour} — collections : ${collections.join(", ") || "(aucune)"}`);

    let totalDocs = 0;
    for (const nom of collections) {
      try {
        const n = await sauvegarderCollection(nom, jour, backupAt);
        totalDocs += n;
        console.log(`   • ${nom} : ${n} document(s)`);
      } catch (e) {
        // Une collection en échec ne doit pas faire échouer tout le backup
        console.error(`   ⚠️  Échec sauvegarde collection ${nom} : ${e.message}`);
      }
    }

    await purgerAnciens();

    console.log(`✅ Sauvegarde du ${jour} terminée : ${totalDocs} document(s) historisé(s).`);
    return { ok: true, jour, totalDocs, collections };
  } catch (e) {
    console.error("❌ Sauvegarde quotidienne en échec :", e.message);
    return { ok: false, raison: e.message };
  }
}

// ── Planification cron ───────────────────────────────────────
export function planifierSauvegardeQuotidienne() {
  if (!cron.validate(HEURE_CRON)) {
    console.error(`❌ Expression cron invalide (${HEURE_CRON}) — sauvegarde quotidienne NON planifiée.`);
    return;
  }

  cron.schedule(HEURE_CRON, () => { sauvegarderMaintenant(); }, { timezone: TZ });
  console.log(`🗓️  Sauvegarde quotidienne planifiée : « ${HEURE_CRON} » (${TZ}), rétention ${RETENTION_JOURS} j → ${HISTORY_COLL}`);

  if (LANCER_AU_DEMARRAGE) {
    // Petit délai pour laisser la connexion Mongo s'établir au boot
    setTimeout(() => sauvegarderMaintenant(), 15000);
  }
}

export default planifierSauvegardeQuotidienne;
