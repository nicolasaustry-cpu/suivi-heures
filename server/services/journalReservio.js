// ─────────────────────────────────────────────────────────────
// Historique des retraits de RDV Reservio du planning (Suiv'Heures)
// ─────────────────────────────────────────────────────────────
// Chaque fois qu'un RDV importé de Reservio disparaît du planning (plus aucune case ne porte
// son lien reservioUid), une ligne est ajoutée à donnees.reservioRetraits (champ hors schéma,
// écrit directement dans la collection, 500 dernières lignes conservées) :
//   { uid, chantier, date: 'YYYY_MM_DD' (jour du RDV au planning), salarieId,
//     quand: Date, origine: 'synchro' | 'verification' | 'pc' | 'autre', detail }
// Origines :
//   synchro      → la synchronisation Reservio l'a retiré (RDV absent de Reservio)
//   verification → retiré via la modale « Vérifier les RDV Reservio » (choix du gérant)
//   pc           → un enregistrement depuis un poste (page indiquée dans le détail)
//   autre        → constaté au cycle de synchro suivant, sans enregistrement PC correspondant
//                  (mobile, agenda, autre route) : fenêtre horaire indiquée dans le détail
// ─────────────────────────────────────────────────────────────

import Donnees from "../models/donnees.js";

export const NB_RETRAITS_MAX = 500;
const CLE_RE = /^(\d+)(\d{4}_\d{2}_\d{2})ch\d+$/;

/* uid Reservio → { cle, chantier, date, salarieId } pour toutes les cases qui portent un lien. */
export function uidsReservio(heures) {
  const m = new Map();
  for (const [k, d] of Object.entries(heures || {})) {
    if (!d || !d.reservioUid || m.has(d.reservioUid)) continue;
    const x = k.match(CLE_RE);
    m.set(String(d.reservioUid), {
      cle: k, chantier: String(d.chantier || ""),
      date: x ? x[2] : "", salarieId: x ? x[1] : ""
    });
  }
  return m;
}

/* Lignes de retrait : uid présents « avant » et absents « après » (un simple déplacement de
   case ne compte pas : l'uid est toujours quelque part dans le planning). */
export function retraitsEntre(avant, apres, origine, detailParUid) {
  const out = [], quand = new Date();
  for (const [uid, info] of avant) {
    if (apres.has(uid)) continue;
    const detail = typeof detailParUid === "function" ? detailParUid(uid, info) : String(detailParUid || "");
    out.push({ uid, chantier: info.chantier, date: info.date, salarieId: info.salarieId, quand, origine, detail });
  }
  return out;
}

/* Ajoute les lignes au journal du client (sans jamais faire échouer l'appelant). */
export async function journaliserRetraits(docId, lignes) {
  if (!docId || !Array.isArray(lignes) || !lignes.length) return;
  try {
    await Donnees.collection.updateOne(
      { _id: docId },
      { $push: { reservioRetraits: { $each: lignes, $slice: -NB_RETRAITS_MAX } } }
    );
  } catch (e) {
    console.warn(`   ⚠️  Historique des retraits Reservio non enregistré (${e.message})`);
  }
}

/* Page d'origine d'une requête (Referer), ex. « planning.html », pour le détail. */
export function pageOrigine(req) {
  try {
    const ref = req.get("referer") || req.get("referrer") || "";
    if (!ref) return "page inconnue";
    const p = new URL(ref).pathname.split("/").filter(Boolean).pop();
    return p || "accueil";
  } catch (_) { return "page inconnue"; }
}
