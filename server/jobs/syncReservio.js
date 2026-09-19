// ─────────────────────────────────────────────────────────────
// Synchronisation Reservio → planning (Suiv'Heures / Volitis)
// ─────────────────────────────────────────────────────────────
// Toutes les 15 minutes, pour chaque client ayant activé Reservio
// (entreprise.reservio.actif === true), on récupère le flux ICS de
// chaque salarié configuré (entreprise.reservio.salaries) et on
// injecte ses RDV À VENIR comme des créneaux de planning (heures[...]),
// exactement comme un créneau saisi à la main (chantier + heure de
// RDV), pour profiter de l'affichage existant sans rien changer côté
// planning.html dans un premier temps.
//
// RÈGLES (validées avec Nicolas le 19/09) :
//  • Reservio fait autorité TANT QUE le créneau n'a pas été modifié
//    manuellement dans Suiv'Heures (chantier / heures / horaire RDV /
//    changement de technicien = déplacement du pavé vers un autre
//    salarié). Dès qu'un écart est détecté → le créneau est VERROUILLÉ
//    (reservioLocked = true) et n'est plus jamais retouché par le sync.
//  • Si le RDV disparaît du flux Reservio (annulé côté Reservio) :
//      - créneau NON verrouillé → suppression silencieuse du créneau
//      - créneau VERROUILLÉ      → le créneau reste, mais reçoit une
//        alerte (reservioAnnule = true) que le gérant devra traiter
//        dans planning.html (conserver ou supprimer). Affichage de
//        cette alerte : À FAIRE dans un prochain fichier (planning.html).
//  • Seuls les RDV À VENIR (DTSTART >= maintenant) sont importés.
//  • Le type d'entretien "Non assigné" est affiché "Prestation non
//    définie" (le salarié reste celui du flux Reservio d'origine).
//
// Ce job NE modifie QUE ce qu'il a lui-même créé (reservioUid présent).
// Il ne touche jamais un créneau "normal" saisi manuellement.
// ─────────────────────────────────────────────────────────────

import cron from "node-cron";
import ical from "node-ical";
import Donnees from "../models/donnees.js";

const TZ             = "Europe/Paris";
const RESERVIO_CRON  = process.env.RESERVIO_CRON || "*/15 * * * *"; // toutes les 15 min
const NB_SLOTS_MAX   = 60; // doit couvrir NB_SLOTS de planning.html

// ── Utilitaires date (cohérents avec le format des clés de planning.html) ──
function dateKeyParis(d) {
  // 'YYYY_MM_DD' dans le fuseau Europe/Paris
  const p = new Intl.DateTimeFormat("fr-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(d);
  return p.replace(/-/g, "_");
}
function heureHHMMParis(d) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(d);
}
function aujourdHuiKeyParis() {
  return dateKeyParis(new Date());
}

// ── Découpe un SUMMARY Reservio "Client - Type d'entretien" ──
function libelleRdv(summary) {
  const s = String(summary || "").trim();
  const idx = s.lastIndexOf(" - ");
  let client  = idx >= 0 ? s.slice(0, idx).trim()      : s;
  let service = idx >= 0 ? s.slice(idx + 3).trim()     : "";
  if (!service || /^non assign/i.test(service)) service = "Prestation non définie";
  if (!client) client = "Client";
  return { client, service, chantier: `${client} — ${service}` };
}

// ── Extrait email / téléphone / adresse depuis la DESCRIPTION Reservio ──
// Format habituel :
//   Nom du contact
//   email@exemple.fr
//   0600000000
//   (ligne vide)
//   adresse / notes libres
//   (ligne vide)
//   https://app.reservio.com/...  (lien à ignorer)
function parserDescription(desc) {
  const txt = String(desc || "").trim();
  if (!txt) return { email: "", tel: "", adresse: "" };
  const blocs = txt.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const contact = blocs[0] || "";
  const lignes = contact.split("\n").map(l => l.trim()).filter(Boolean);
  const email = (lignes.find(l => /@/.test(l)) || "").trim();
  const tel   = (lignes.find(l => !/@/.test(l) && /[\d\s+().-]{8,}/.test(l)) || "").trim();
  // Tout ce qui n'est ni le bloc contact, ni le dernier bloc (lien reservio)
  const adresseBlocs = blocs.slice(1, blocs.length > 1 ? blocs.length - 1 : 1)
    .filter(b => !/^https?:\/\//i.test(b));
  const adresse = adresseBlocs.join(" — ").trim();
  return { email, tel: tel.replace(/\s+/g, " "), adresse: adresse.slice(0, 500) };
}

// ── Salarié : trouve le 1er slot libre du jour, en excluant ceux déjà pris ce cycle ──
function trouverSlotLibre(heures, salarieId, dateKey, dejaPris) {
  for (let i = 1; i <= NB_SLOTS_MAX; i++) {
    const k = `${salarieId}${dateKey}ch${i}`;
    if (dejaPris.has(k)) continue;
    const d = heures[k];
    if (!d || !String(d.chantier || "").trim()) return k;
  }
  return null; // planning du jour plein (très improbable avec 60 slots)
}

// ── Empreinte des champs "visibles" du créneau, pour détecter une modif manuelle ──
function empreinte(d) {
  return JSON.stringify({
    chantier: String(d.chantier || "").trim(),
    heures:   parseFloat(d.heures) || 0,
    rdv:      String(d.rdv || "").trim()
  });
}

// ── Synchronise UN salarié (une URL ICS) pour UN client ──
// Retourne l'ensemble des UID Reservio vus dans ce flux (RDV à venir).
async function syncSalarie(doc, salarieId, urlIcs, dejaPrisParDate) {
  const uidsVus = new Set();
  let events;
  try {
    const data = await ical.async.fromURL(urlIcs);
    events = Object.values(data).filter(e => e && e.type === "VEVENT");
  } catch (e) {
    console.error(`   ⚠️  Reservio salarié ${salarieId} — flux illisible : ${e.message}`);
    return uidsVus;
  }

  const maintenant = Date.now();
  const heures = doc.heures || (doc.heures = {});
  // UID Reservio déjà présents quelque part dans le planning (quel que soit le salarié actuel)
  const existantParUid = new Map();
  for (const [k, d] of Object.entries(heures)) {
    if (d && d.reservioUid) existantParUid.set(d.reservioUid, k);
  }

  for (const ev of events) {
    if (!ev.uid || !ev.start) continue;
    if (ev.start.getTime() < maintenant) continue; // RDV passé : hors périmètre
    uidsVus.add(ev.uid);

    const dateKey = dateKeyParis(ev.start);
    const { client, service, chantier } = libelleRdv(ev.summary);
    const dureeH = ev.end ? Math.max(0.25, (ev.end - ev.start) / 3600000) : 2;
    const rdv = heureHHMMParis(ev.start);
    const { email, tel, adresse } = parserDescription(ev.description);

    const cleAttendue = `${salarieId}${dateKey}`;
    const keyExistante = existantParUid.get(ev.uid);

    if (keyExistante) {
      const d = heures[keyExistante];
      if (d.reservioLocked) continue; // verrouillé : on ne touche plus jamais

      const dejaBouge = !keyExistante.startsWith(cleAttendue); // déplacé vers un autre salarié
      const modifie = !dejaBouge && d.reservioSnapshot && empreinte(d) !== d.reservioSnapshot;

      if (dejaBouge || modifie) {
        d.reservioLocked = true; // on gèle tel quel, on ne retouche plus
        continue;
      }

      // Rien de manuel détecté → on rafraîchit avec les données Reservio
      d.chantier = chantier;
      d.heures   = dureeH;
      d.rdv      = rdv;
      d.rdvAuteur = "reservio";
      d.reservioSnapshot = empreinte(d);
      d.reservioAnnule = false;
      doc.markModified(`heures.${keyExistante}`);
    } else {
      // Nouveau RDV : on cherche un slot libre du jour pour ce salarié
      const k = trouverSlotLibre(heures, salarieId, dateKey, dejaPrisParDate);
      if (!k) {
        console.warn(`   ⚠️  Planning plein le ${dateKey} pour le salarié ${salarieId} — RDV "${chantier}" ignoré.`);
        continue;
      }
      dejaPrisParDate.add(k);
      const d = {
        chantier, heures: dureeH, rdv, rdvAuteur: "reservio",
        reservioUid: ev.uid, reservioLocked: false, reservioAnnule: false
      };
      d.reservioSnapshot = empreinte(d);
      heures[k] = d;
      existantParUid.set(ev.uid, k);
    }

    // Coordonnées (adresse/téléphone) : alimente l'annuaire existant,
    // ce qui active automatiquement le bouton 🗺 Itinéraire en saisie mobile.
    if (adresse || tel || email) {
      const coords = doc.coordonneesChantiers || (doc.coordonneesChantiers = {});
      const cle = chantier.trim().toUpperCase();
      coords[cle] = {
        adresse: adresse || (coords[cle]?.adresse || ""),
        ville:   coords[cle]?.ville || "",
        mobile:  tel   || (coords[cle]?.mobile || ""),
        fixe:    coords[cle]?.fixe || ""
      };
      doc.markModified("coordonneesChantiers");
    }
  }

  return uidsVus;
}

// ── Marque comme annulés/supprime les créneaux dont le RDV Reservio a disparu ──
function traiterAnnulations(doc, uidsEncoreValides) {
  const aujourdHui = aujourdHuiKeyParis();
  const heures = doc.heures || {};
  for (const k of Object.keys(heures)) {
    const d = heures[k];
    if (!d || !d.reservioUid) continue;
    if (uidsEncoreValides.has(d.reservioUid)) continue; // toujours dans le flux
    const m = k.match(/(\d{4}_\d{2}_\d{2})ch\d+$/);
    if (!m || m[1] < aujourdHui) continue; // créneau passé : on n'y touche pas

    if (d.reservioLocked) {
      d.reservioAnnule = true; // alerte à traiter par le gérant (planning.html — à faire)
      doc.markModified(`heures.${k}`);
    } else {
      delete heures[k]; // jamais modifié manuellement → suppression silencieuse
      doc.markModified("heures");
    }
  }
}

// ── Synchronise UN client (toutes ses licences Reservio configurées) ──
async function syncClient(doc) {
  const cfg = doc.entreprise?.reservio;
  if (!cfg || cfg.actif !== true || !Array.isArray(cfg.salaries) || !cfg.salaries.length) return;

  const dejaPrisParDate = new Set(); // évite deux RDV sur le même slot pendant ce cycle
  const tousLesUids = new Set();

  for (const s of cfg.salaries) {
    const salarieId = s?.salarieId;
    const url = (s?.urlIcs || "").trim();
    if (salarieId == null || !url) continue;
    const uids = await syncSalarie(doc, salarieId, url, dejaPrisParDate);
    uids.forEach(u => tousLesUids.add(u));
  }

  traiterAnnulations(doc, tousLesUids);

  doc.updatedAt = new Date();
  await doc.save();
}

// ── Cycle complet : tous les clients ayant Reservio actif ──
export async function synchroniserReservioMaintenant() {
  try {
    const clients = await Donnees.find({ "entreprise.reservio.actif": true });
    if (!clients.length) return { ok: true, clients: 0 };

    console.log(`🔗 Synchro Reservio — ${clients.length} client(s) concerné(s).`);
    for (const doc of clients) {
      try {
        await syncClient(doc);
      } catch (e) {
        console.error(`   ⚠️  Échec synchro Reservio pour ${doc.clientId} : ${e.message}`);
      }
    }
    return { ok: true, clients: clients.length };
  } catch (e) {
    console.error("❌ Synchro Reservio en échec :", e.message);
    return { ok: false, raison: e.message };
  }
}

// ── Planification cron ───────────────────────────────────────
export function planifierSynchroReservio() {
  if (!cron.validate(RESERVIO_CRON)) {
    console.error(`❌ Expression cron invalide (${RESERVIO_CRON}) — synchro Reservio NON planifiée.`);
    return;
  }
  cron.schedule(RESERVIO_CRON, () => { synchroniserReservioMaintenant(); }, { timezone: TZ });
  console.log(`🗓️  Synchro Reservio planifiée : « ${RESERVIO_CRON} » (${TZ}).`);
}

export default planifierSynchroReservio;
