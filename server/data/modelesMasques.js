// ─────────────────────────────────────────────────────────────
// data/modelesMasques.js — Masques de bons prêts à l'emploi
// ─────────────────────────────────────────────────────────────
// Le client les ajoute en un clic depuis la page Masques de bons, puis les
// modifie librement comme ses propres masques. Les champs « AUTO » (date,
// heures, durée) sont repris du pointage et ne sont pas redemandés sur mobile.
// ─────────────────────────────────────────────────────────────

import { CHAMPS_EXEMPLE } from "./exempleBonOrganilog.js";

const ch = (id, libelle, type, extra = {}) => ({ id, libelle, type, obligatoire: false, dictee: false, signataire: "salarie", options: [], auto: "", ...extra });

const AUTO = [
  ch("date", "Date d'intervention", "datetime", { auto: "date" }),
  ch("debut", "Heure de début", "datetime", { auto: "heureDebut" }),
  ch("fin", "Heure de fin", "datetime", { auto: "heureFin" }),
  ch("duree", "Durée de travail", "datetime", { auto: "duree" })
];

// ── Entretien Chauffe-Eau Thermodynamique (d'après le rapport Organilog n° 9492) ──
const CHAMPS_CET = [
  ...AUTO,
  ch("type_act", "Type d'activité", "liste", { options: ["Entretien", "Dépannage", "Mise en service"] }),
  ch("type_eq", "Type d'équipement", "liste", { obligatoire: true, options: ["Ballon thermodynamique", "Chauffe-eau thermodynamique"] }),
  ch("marque", "Marque", "texte"),
  ch("reference", "Référence", "texte"),
  ch("etat_arrivee", "État de l'installation à l'arrivée", "liste", { obligatoire: true, options: [
    "A mon arrivée, équipement en fonctionnement correct.",
    "A mon arrivée, équipement en fonctionnement incorrect.",
    "A mon arrivée, équipement en défaut.",
    "A mon arrivée, équipement à l'arrêt."
  ] }),
  ch("defauts", "Défaut(s) ou état constaté(s)", "texte", { dictee: true }),
  ch("ctrl_install", "Contrôle installation", "cases_multiples", { options: [
    "Contrôle anode", "Contrôle état calorifuge", "Contrôle fixations ventilateur et compresseur",
    "Contrôle groupe de sécurité", "Contrôle mitigeur", "Contrôle sonde(s)", "Contrôle vase d'expansion",
    "Contrôle ventilateur(s) et turbine(s)", "Contrôle visuel installation",
    "Nettoyage bac à condensats", "Nettoyage batterie évaporateur"
  ] }),
  ch("ctrl_elec", "Contrôle installation électrique", "cases_multiples", { options: [
    "Test du différentiel de protection équipement",
    "Resserrage des connexions électriques sur tableau client",
    "Resserrage des connexions électriques sur équipement",
    "Contrôle visuel installation électrique"
  ] }),
  ch("ctrl_frigo", "Contrôle circuit frigorifique", "cases_multiples", { options: [
    "Contrôle visuel circuit frigorifique",
    "Contrôle des vannes de service",
    "Contrôle des valve(s) Schrader et bouchon(s)"
  ] }),
  ch("ctrl_etanch", "Contrôle indirect d'étanchéité au détecteur électronique", "liste", { options: [
    "Aucune fuite détectée", "Fuite détectée (voir CERFA)", "Non réalisé"
  ] }),
  ch("mode_chaud", "Contrôle du fonctionnement en mode chaud", "case"),
  ch("rapport", "Rapport d'intervention", "texte", { dictee: true }),
  ch("etat_depart", "État général de fonctionnement au départ", "liste", { obligatoire: true, options: [
    "A mon départ, équipement en fonctionnement correct.",
    "A mon départ, équipement en fonctionnement incorrect.",
    "A mon départ, équipement en défaut.",
    "A mon départ, équipement à l'arrêt et mis hors tension.",
    "A mon départ, équipement à l'arrêt et sous tension."
  ] }),
  ch("pieces_ok", "Pièce(s) fournie(s) durant l'intervention", "case"),
  ch("pieces", "Détail des pièces fournies", "texte", { dictee: true }),
  ch("devis", "Devis à prévoir", "case"),
  ch("photos", "Photos", "photo"),
  ch("sig_tech", "Signature technicien", "signature", { signataire: "salarie" }),
  ch("sig_client", "Signature client", "signature", { signataire: "client", obligatoire: true })
];

export const MODELES_MASQUES = [
  {
    code: "cet",
    nom: "Entretien Chauffe-Eau Thermodynamique",
    description: "Contrôles installation, électrique et circuit frigorifique, étanchéité, mode chaud, état à l'arrivée et au départ, pièces, devis, photos et signatures. CERFA 15497 proposé.",
    cerfa: "15497",
    champs: CHAMPS_CET
  },
  {
    code: "depannage-pac",
    nom: "Rapport d'intervention (dépannage PAC)",
    description: "Type d'activité et d'équipement, état à l'arrivée et au départ, défauts, rapport, pièces, devis, règlement, photos et signatures. CERFA 15497 proposé.",
    cerfa: "15497",
    champs: CHAMPS_EXEMPLE
  }
];
