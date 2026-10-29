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
  // Nom de chantier en MAJUSCULES, comme partout dans Suiv'Heures (le planning met le nom en
  // majuscules dès qu'on touche la ligne : en casse mixte, ce simple geste passait pour une
  // modification manuelle et verrouillait le RDV).
  return { client, service, chantier: `${client} — ${service}`.toUpperCase() };
}

// ── Extrait email / téléphone / adresse depuis la DESCRIPTION Reservio ──
// Format habituel :
//   Nom du contact
//   email@exemple.fr
//   0600000000
//   (ligne vide)
//   adresse + informations + type de contrat (UNE SEULE zone de saisie côté Reservio)
//   (ligne vide)
//   https://app.reservio.com/...  (lien à ignorer)
//
// Le client tape tout dans la même zone (ex. « 45 rue des Lilas 72210 Louplande PAC
// Atlantic, contrat entretien annuel »). On isole l'adresse (rue + CP + ville), qui part
// dans la fiche « Coordonnées du chantier », et TOUT le reste part dans la note du
// créneau : rien n'est jamais perdu, au pire une info reste dans la note.
function parserDescription(desc) {
  const txt = String(desc || "").trim();
  if (!txt) return { email: "", tel: "", adresse: "", ville: "", note: "" };
  const blocs = txt.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const contact = blocs[0] || "";
  const lignes = contact.split("\n").map(l => l.trim()).filter(Boolean);
  const email = (lignes.find(l => /@/.test(l)) || "").trim();
  const tel   = (lignes.find(l => !/@/.test(l) && /[\d\s+().-]{8,}/.test(l)) || "").trim();

  // Tous les blocs après le contact, hors lien Reservio (quel que soit son rang).
  const reste = blocs.slice(1)
    .filter(b => !/^https?:\/\//i.test(b))
    .map(nettoyerLibelleAdresse)
    .filter(Boolean);

  // Le bloc "adresse" est celui qui contient un code postal (5 chiffres isolés, pas un
  // morceau de n° de téléphone) ; à défaut, celui qui contient un mot de voie (rue, chemin…).
  let idxAdresse = reste.findIndex(b => CP_RE_1.test(b));
  if (idxAdresse < 0) idxAdresse = reste.findIndex(b => voieRegex().test(b));
  const blocAdresse = idxAdresse >= 0 ? reste[idxAdresse] : "";
  const autresBlocs = reste.filter((_, i) => i !== idxAdresse);

  const { rue, ville, avant, apres } = extraireAdresseVilleNote(blocAdresse);
  const note = [...autresBlocs, avant, apres].map(nettoyerBordsNote).filter(Boolean).join(" / ").trim();

  return {
    email, tel: tel.replace(/\s+/g, " "),
    adresse: rue.slice(0, 500), ville: ville.slice(0, 200), note: note.slice(0, 2000)
  };
}

// Reservio préfixe le champ par le libellé du formulaire, ex. :
//   "Adresse complète ( RUE - CP - VILLE): 45 rue ..."
//   "Adresse complète (RUE - CP - VILLE)  et  Marque de la PAC: 331 Chemin ..."
// Tout libellé de tête contenant « adresse » et terminé par « : » est retiré.
function nettoyerLibelleAdresse(bloc) {
  return String(bloc || "")
    .replace(/^[^:\n]{0,160}?adresse[^:\n]{0,160}:\s*/i, "")
    .trim();
}

// ── Outils de découpe ──
const CP_RE   = /(?<!\d)(\d{5})(?!\d)/g;
const CP_RE_1 = /(?<!\d)\d{5}(?!\d)/;
const VOIES = "rue|avenue|av\\.?|bd|boulevard|chemin|impasse|imp\\.?|all[ée]e|place|pl\\.|route|rte|lieu[- ]dit|ld|hameau|r[ée]sidence|quai|cours|square|voie|passage|sentier|lotissement|lot\\.|cit[ée]|faubourg|fbg|zac|za|zi|parc|rond[- ]point|carrefour|mont[ée]e|venelle|ruelle|clos|domaine|le bourg";
function voieRegex() {
  // n° facultatif (12, 12 bis, 12B…) + mot de voie
  return new RegExp(`(?<![\\p{L}\\d])(\\d{1,4}\\s*(?:bis|ter|[a-d])?\\s*,?\\s+)?(?:${VOIES})(?![\\p{L}])`, "giu");
}
// Mots qui ne font jamais partie d'un nom de ville : ils marquent le début des infos.
const MOTS_INFO = new Set(("contrat entretien marque pac chaudiere type modele info infos information informations " +
  "remarque remarques note notes merci code digicode portail etage bat batiment tel telephone mail appareil ref " +
  "annuel annuelle maintenance intervention client sav clim climatisation gaz fioul pellets granules poele ballon " +
  "acces attention svp rdv contact abonnement garantie depannage visite installation equipement chaudière").split(" "));
const LIAISONS = new Set("de du des la le les l d sur sous en les lez lès aux au et".split(" "));
const sansAccent = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = s => sansAccent(s).toLowerCase().replace(/[’']/g, " ").replace(/[^a-z0-9 -]/g, "").trim();
const motNorm = m => { const n = norm(m).replace(/-/g, ""); return n === "st" ? "saint" : n === "ste" ? "sainte" : n; };

function nettoyerBordsNote(s) {
  return String(s || "").replace(/^[\s,;:.\/\-–—]+|[\s,;:\/\-–—]+$/g, "").replace(/[ \t]+/g, " ").trim();
}

// ── Communes officielles par code postal (geo.api.gouv.fr, gratuit, sans clé) ──
// Sert à savoir EXACTEMENT où s'arrête le nom de la ville : « 72210 Louplande PAC
// Atlantic » → ville « Louplande », le reste en note. Cache mémoire par CP pour la
// durée du process ; si l'API ne répond pas, repli sur une règle de lecture du texte.
const _communesParCp = new Map();
async function chargerCommunes(textes) {
  const cps = new Set();
  for (const t of textes) for (const m of String(t || "").matchAll(CP_RE)) cps.add(m[1]);
  const manquants = [...cps].filter(cp => !_communesParCp.has(cp)).slice(0, 60);
  await Promise.all(manquants.map(async cp => {
    try {
      const r = await fetch(`https://geo.api.gouv.fr/communes?codePostal=${cp}&fields=nom&format=json`,
                            { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return;                                   // pas en cache : nouvel essai au prochain cycle
      const j = await r.json();
      _communesParCp.set(cp, Array.isArray(j) ? j.map(c => c && c.nom).filter(Boolean) : []);
    } catch { /* réseau indisponible : la règle de lecture prend le relais */ }
  }));
}

// Découpe le texte situé après le CP en « mots » en gardant leur position d'origine.
function motsAvecPos(txt) {
  const out = []; const re = /[^\s'’\-,;:.\/()]+/g; let m;
  while ((m = re.exec(txt))) out.push({ mot: m[0], debut: m.index, fin: m.index + m[0].length });
  return out;
}

// Longueur (en caractères de `apres`) du nom de ville, ou 0 si non reconnu.
function longueurVille(cp, apres) {
  const mots = motsAvecPos(apres);
  if (!mots.length) return { fin: 0, nom: "" };
  // 1) Liste officielle des communes du CP : on garde la plus longue qui correspond au début.
  const communes = _communesParCp.get(cp) || [];
  let meilleur = { fin: 0, nom: "" }, meilleurNb = 0;
  for (const nom of communes) {
    const cible = motsAvecPos(nom).map(x => motNorm(x.mot)).filter(Boolean);
    if (!cible.length || cible.length > mots.length) continue;
    // Le texte ne doit pas être coupé par une ponctuation forte au milieu du nom.
    let ok = true;
    for (let i = 0; i < cible.length && ok; i++) {
      if (motNorm(mots[i].mot) !== cible[i]) ok = false;
      if (ok && i > 0 && /[,;:\/()\n]/.test(apres.slice(mots[i - 1].fin, mots[i].debut))) ok = false;
    }
    if (ok && cible.length > meilleurNb) { meilleurNb = cible.length; meilleur = { fin: mots[cible.length - 1].fin, nom }; }
  }
  if (meilleurNb) return meilleur;

  // 2) Repli : mots en Majuscule (ou liaisons de/la/sur…), jusqu'à 6, arrêt sur
  //    ponctuation, retour à la ligne, chiffre ou mot « d'info » (contrat, PAC…).
  let fin = 0, nb = 0, dernierUtile = 0;
  for (let i = 0; i < mots.length && nb < 6; i++) {
    const w = mots[i];
    if (i > 0 && /[,;:\/()\n]|\s{2,}/.test(apres.slice(mots[i - 1].fin, w.debut))) break;
    if (/^\s*[,;:\/()\n]/.test(apres.slice(0, w.debut)) && i === 0) break;
    const n = motNorm(w.mot);
    if (/\d/.test(w.mot) || MOTS_INFO.has(n)) break;
    const liaison = LIAISONS.has(n);
    if (!liaison && !/^\p{Lu}/u.test(w.mot)) break;
    nb++; fin = w.fin; if (!liaison) dernierUtile = w.fin;
  }
  fin = dernierUtile || 0;                   // une ville ne finit pas par « de » / « la »
  return { fin, nom: fin ? apres.slice(0, fin).trim() : "" };
}

// Sépare, dans la zone de saisie unique : ce qui précède l'adresse (avant), la rue,
// "CP Ville", et tout ce qui suit la ville (après). avant + après → note du créneau.
function extraireAdresseVilleNote(txt) {
  // Plusieurs espaces d'affilée = séparation de champs chez Reservio → retour à la ligne.
  const brut = String(txt || "").replace(/\r/g, "").replace(/[ \t]{2,}/g, "\n").trim();
  if (!brut) return { rue: "", ville: "", avant: "", apres: "" };

  // Choix du CP : celui dont la ville est reconnue en priorité, sinon le 1er suivi d'une Majuscule.
  const cands = [...brut.matchAll(CP_RE)].map(m => ({ cp: m[1], i: m.index }));
  let choix = null;
  for (const c of cands) {
    const apres = brut.slice(c.i + 5).replace(/^[\s,\-–—]+/, "");
    const v = longueurVille(c.cp, apres);
    if (v.fin && (_communesParCp.get(c.cp) || []).includes(v.nom)) { choix = c; break; }
    if (!choix && /^[\s,\-–—]*\p{Lu}/u.test(brut.slice(c.i + 5))) choix = c;
  }
  if (!choix && cands.length) choix = cands[0];

  let prefixe, apresVille = "", ville = "";
  if (choix) {
    prefixe = brut.slice(0, choix.i);
    const reste = brut.slice(choix.i + 5);
    const decal = reste.length - reste.replace(/^[\s,\-–—]+/, "").length;
    const apres = reste.slice(decal);
    const v = longueurVille(choix.cp, apres);
    ville = (choix.cp + " " + v.nom).trim();
    apresVille = apres.slice(v.fin);
  } else {
    // Pas de code postal : l'adresse s'arrête au premier retour à la ligne / point-virgule.
    const m = voieRegex().exec(brut);
    if (!m) return { rue: "", ville: "", avant: brut, apres: "" };   // aucune adresse repérable → tout en note
    const fin = brut.slice(m.index).search(/[\n;]/);
    prefixe = fin < 0 ? brut : brut.slice(0, m.index + fin);
    apresVille = fin < 0 ? "" : brut.slice(m.index + fin);
  }

  // Rue = fin du préfixe. Si des infos la précèdent (« PAC Atlantic : 12 rue X »), on les
  // détache : début de la voie (n° + rue/chemin…) précédé d'une ponctuation, d'un retour à
  // la ligne ou d'un mot d'info. Sinon le préfixe entier reste la rue (ex. « Résidence Les Pins 12 rue X »).
  let rue = prefixe.replace(/[\s,\-–—]+$/, "");
  let avant = "";
  const voies = [...rue.matchAll(voieRegex())];
  const voie = voies.find(m => m[1]) || voies[0];
  if (voie && voie.index > 0) {
    const tete = rue.slice(0, voie.index);
    const motsTete = tete.split(/[^\p{L}]+/u).map(motNorm).filter(Boolean);
    if (/[:;.\n]\s*$/.test(tete) || /[:;\n]/.test(tete) || motsTete.some(w => MOTS_INFO.has(w))) {
      avant = tete; rue = rue.slice(voie.index);
    }
  } else if (!voie && /[:;\n]/.test(rue)) {
    // Pas de mot de voie (lieu-dit…) : la rue est le dernier morceau, le reste part en note.
    const morceaux = rue.split(/[:;\n]/);
    rue = morceaux.pop(); avant = morceaux.join(" / ");
  }
  rue = rue.replace(/\n/g, " ").replace(/\s+/g, " ").replace(/^[\s,\-–—:]+|[\s,\-–—:]+$/g, "").trim();
  return { rue, ville, avant: avant.replace(/\n/g, " / "), apres: apresVille.replace(/\n/g, " / ") };
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
// Comparaison tolérante aux simples reformatages du planning (casse du nom, espaces,
// « 9:30 » / « 09:30 », heures « 1.50 » / 1.5) : seule une vraie modification verrouille.
function _hhmm(v) {
  const m = String(v || "").trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? m[1].padStart(2, "0") + ":" + m[2] : String(v || "").trim();
}
function empreinte(d) {
  return JSON.stringify({
    chantier: String(d.chantier || "").replace(/\s+/g, " ").trim().toUpperCase(),
    heures:   Math.round((parseFloat(d.heures) || 0) * 100) / 100,
    rdv:      _hhmm(d.rdv),
    note:     String(d.note || "").replace(/\s+/g, " ").trim()
  });
}

/* Le créneau est-il resté tel que le sync l'a écrit ? L'empreinte mémorisée est relue puis
   normalisée avec les règles actuelles : les empreintes enregistrées avant cette version
   (nom en casse mixte, « 1.5 » vs 1.50…) ne provoquent donc aucun verrouillage abusif. */
function memeEmpreinte(d, snapshot) {
  try { return empreinte(JSON.parse(snapshot)) === empreinte(d); }
  catch (_) { return empreinte(d) === snapshot; }
}

// ── Synchronise UN salarié (une URL ICS) pour UN client ──
// Retourne l'ensemble des UID Reservio vus dans ce flux (RDV à venir).
async function syncSalarie(doc, salarieId, urlIcs, dejaPrisParDate, vus) {
  const uidsVus = new Set();
  let events;
  try {
    const data = await ical.async.fromURL(urlIcs);
    events = Object.values(data).filter(e => e && e.type === "VEVENT");
  } catch (e) {
    console.error(`   ⚠️  Reservio salarié ${salarieId} — flux illisible : ${e.message}`);
    return uidsVus;
  }
  // Noms officiels des communes des CP présents dans ce flux (pour isoler la ville).
  await chargerCommunes(events.map(e => e.description));

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
    const { email, tel, adresse, ville, note } = parserDescription(ev.description);

    const cleAttendue = `${salarieId}${dateKey}`;
    const keyExistante = existantParUid.get(ev.uid);

    if (keyExistante) {
      vus[ev.uid] = dateKey;                 // date actuelle du RDV (purge des RDV passés)
      let d = heures[keyExistante];
      if (d.reservioLocked) continue; // verrouillé : on ne touche plus jamais

      // Déplacement MANUEL dans Suiv'Heures (autre salarié ou autre jour) : la case actuelle
      // n'est plus celle où le sync l'avait posée (reservioCle). Créneaux plus anciens, sans
      // reservioCle : on garde l'ancienne règle (case hors du jour/salarié attendu = déplacé).
      // Seuls le salarié et le jour comptent (préfixe de la case) : un simple réordonnancement
      // des pavés dans la même journée change le n° de case mais n'est PAS une modification.
      const jourCase = c => String(c || "").replace(/ch\d+$/, "");
      const dejaBouge = d.reservioCle ? jourCase(keyExistante) !== jourCase(d.reservioCle)
                                      : !keyExistante.startsWith(cleAttendue);
      const modifie = !dejaBouge && d.reservioSnapshot && !memeEmpreinte(d, d.reservioSnapshot);

      if (dejaBouge || modifie) {
        d.reservioLocked = true; // on gèle tel quel, on ne retouche plus
        doc.markModified(`heures.${keyExistante}`);
        continue;
      }

      // RDV DÉPLACÉ DANS RESERVIO (autre jour ou autre salarié) alors que le créneau n'a pas
      // été touché ici : on le déplace dans le planning (avant, il restait verrouillé à
      // l'ancienne date et le nouveau rendez-vous n'apparaissait jamais).
      if (!keyExistante.startsWith(cleAttendue)) {
        const kNouv = trouverSlotLibre(heures, salarieId, dateKey, dejaPrisParDate);
        if (!kNouv) {
          console.warn(`   ⚠️  Planning plein le ${dateKey} pour le salarié ${salarieId} — RDV déplacé "${chantier}" non reporté.`);
          continue;
        }
        dejaPrisParDate.add(kNouv);
        heures[kNouv] = d;
        delete heures[keyExistante];
        delete d.rdvNotifie;                    // nouvelle date / heure : rappel re-déclenchable
        doc.markModified("heures");
        existantParUid.set(ev.uid, kNouv);
        d = heures[kNouv];
        d.reservioCle = kNouv;
      } else {
        d.reservioCle = keyExistante;           // mémorise la case actuelle (réordonnancement compris)
      }
      const keyCourante = existantParUid.get(ev.uid);

      // Rien de manuel détecté → on rafraîchit avec les données Reservio
      d.chantier = chantier;
      d.heures   = dureeH;
      d.rdv      = rdv;
      d.rdvAuteur = "reservio";
      d.note     = note || "";  // annotation libre laissée par le client sur ce RDV
      d.reservioSnapshot = empreinte(d);
      d.reservioAnnule = false;
      doc.markModified(`heures.${keyCourante}`);
    } else if (vus[ev.uid]) {
      // RDV déjà importé, absent du planning : supprimé (ou détaché) à la main dans
      // Suiv'Heures → on ne le recrée pas (avant, il réapparaissait toutes les 15 min).
      continue;
    } else {
      // Nouveau RDV : on cherche un slot libre du jour pour ce salarié
      const k = trouverSlotLibre(heures, salarieId, dateKey, dejaPrisParDate);
      if (!k) {
        console.warn(`   ⚠️  Planning plein le ${dateKey} pour le salarié ${salarieId} — RDV "${chantier}" ignoré.`);
        continue;
      }
      dejaPrisParDate.add(k);
      vus[ev.uid] = dateKey;                 // mémorisé : importé une fois, jamais réimporté
      const d = {
        chantier, heures: dureeH, rdv, rdvAuteur: "reservio", note: note || "",
        reservioUid: ev.uid, reservioLocked: false, reservioAnnule: false, reservioCle: k
      };
      d.reservioSnapshot = empreinte(d);
      heures[k] = d;
      doc.markModified(`heures.${k}`);   // "heures" est un Object libre (Mixed) : sans ça, Mongoose ne
                                          // détecte pas l'ajout et .save() ne persiste rien.
      existantParUid.set(ev.uid, k);
    }

    // Coordonnées (adresse/téléphone) : alimente l'annuaire existant,
    // ce qui active automatiquement le bouton 🗺 Itinéraire en saisie mobile.
    if (adresse || ville || tel || email) {
      const coords = doc.coordonneesChantiers || (doc.coordonneesChantiers = {});
      const cle = chantier.trim().toUpperCase();
      coords[cle] = {
        adresse: adresse || (coords[cle]?.adresse || ""),
        ville:   ville   || (coords[cle]?.ville   || ""),
        mobile:  tel     || (coords[cle]?.mobile  || ""),
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
      if (d.reservioAnnule) continue;  // alerte déjà posée : rien à réécrire
      d.reservioAnnule = true; // alerte à traiter par le gérant dans planning.html
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

  /* RDV déjà importés { uid: 'YYYY_MM_DD' } : champ propre au sync, lu et écrit directement
     dans la collection (hors schéma, hors synchronisation des postes). Initialisé avec les
     RDV présents dans le planning, puis purgé des RDV passés. */
  let vus = {};
  try {
    const brut = await Donnees.collection.findOne({ _id: doc._id }, { projection: { reservioVus: 1 } });
    vus = (brut && brut.reservioVus && typeof brut.reservioVus === "object") ? brut.reservioVus : {};
  } catch (_) {}
  for (const [k, d] of Object.entries(doc.heures || {})) {
    const m = k.match(/(\d{4}_\d{2}_\d{2})ch\d+$/);
    if (d && d.reservioUid && m && !vus[d.reservioUid]) vus[d.reservioUid] = m[1];
  }

  for (const s of cfg.salaries) {
    const salarieId = s?.salarieId;
    // Plusieurs fiches Reservio peuvent exister pour un même salarié (cas constaté
    // chez un client : deux flux non redondants, RDV différents dans chacun).
    // On accepte donc urlsIcs (tableau) et, par compatibilité, l'ancien urlIcs (chaîne unique).
    const urls = Array.isArray(s?.urlsIcs) ? s.urlsIcs
               : (s?.urlIcs ? [s.urlIcs] : []);
    if (salarieId == null || !urls.length) continue;
    for (const urlBrute of urls) {
      const url = (urlBrute || "").trim();
      if (!url) continue;
      const uids = await syncSalarie(doc, salarieId, url, dejaPrisParDate, vus);
      uids.forEach(u => tousLesUids.add(u));
    }
  }

  traiterAnnulations(doc, tousLesUids);

  doc.updatedAt = new Date();
  await doc.save();

  // Purge des RDV passés puis enregistrement de la liste des RDV déjà importés
  const aujourdHui = aujourdHuiKeyParis();
  for (const u of Object.keys(vus)) if (!vus[u] || vus[u] < aujourdHui) delete vus[u];
  try {
    await Donnees.collection.updateOne({ _id: doc._id }, { $set: { reservioVus: vus } });
  } catch (e) {
    console.warn(`   ⚠️  Reservio ${doc.clientId} : liste des RDV importés non enregistrée (${e.message})`);
  }
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
