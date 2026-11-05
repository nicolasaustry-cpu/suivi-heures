// ─────────────────────────────────────────────────────────────
// data/exempleBonOrganilog.js — Bon d'intervention d'exemple
// ─────────────────────────────────────────────────────────────
// Reproduit dans Suiv'Heures un « Rapport d'intervention » Organilog réel
// (dépannage PAC Hitachi du 13/10/2026) : un masque reprenant les champs
// d'Organilog + un bon rempli avec ses réponses. Sert de démonstration et
// de point de départ aux clients (route POST /api/bons-intervention/pc/exemple).
// Les signatures sont des tracés fictifs.
// ─────────────────────────────────────────────────────────────

export const NOM_MASQUE_EXEMPLE = "Rapport d'intervention (exemple)";

const OUI_NON_DEPART = [
  "A l'arrêt et mis hors tension",
  "A l'arrêt et sous tension",
  "En défaut",
  "En fonctionnement correct",
  "En fonctionnement incorrect",
  "En mode secours"
];

export const CHAMPS_EXEMPLE = [
  { id: "ex_date",       libelle: "Date d'intervention",   type: "datetime", auto: "date" },
  { id: "ex_debut",      libelle: "Heure de début",        type: "datetime", auto: "heureDebut" },
  { id: "ex_fin",        libelle: "Heure de fin",          type: "datetime", auto: "heureFin" },
  { id: "ex_duree",      libelle: "Durée de travail",      type: "datetime", auto: "duree" },
  { id: "ex_type_act",   libelle: "Type d'activité",       type: "liste",
    options: ["Intervention / Dépannage", "Entretien", "Mise en service", "Installation", "Contrôle d'étanchéité"] },
  { id: "ex_type_eq",    libelle: "Type d'équipement",     type: "liste", obligatoire: true,
    options: ["Pompe à Chaleur Air Eau", "Pompe à Chaleur Air Air", "Climatisation", "Chaudière gaz", "Chaudière fioul", "Poêle / chaudière granulés", "Ballon thermodynamique"] },
  { id: "ex_marque",     libelle: "Marque",                type: "texte" },
  { id: "ex_reference",  libelle: "Référence",             type: "texte" },
  { id: "ex_arr_fonct",  libelle: "À mon arrivée, équipement en fonctionnement", type: "case" },
  { id: "ex_arr_defaut", libelle: "À mon arrivée, équipement en défaut",         type: "case" },
  { id: "ex_defauts",    libelle: "Défaut(s) ou état constaté(s)",               type: "texte", dictee: true },
  { id: "ex_rapport",    libelle: "Rapport d'intervention", type: "texte", obligatoire: true, dictee: true },
  { id: "ex_depart",     libelle: "À mon départ, équipement", type: "cases_multiples", options: OUI_NON_DEPART },
  { id: "ex_pieces_ok",  libelle: "Pièce(s) fournie(s) durant l'intervention",   type: "case" },
  { id: "ex_pieces",     libelle: "Détail des pièces fournies",                  type: "texte", dictee: true },
  { id: "ex_devis",      libelle: "Devis à prévoir",       type: "case" },
  { id: "ex_reglement",  libelle: "Règlement ce jour",     type: "case" },
  { id: "ex_photos",     libelle: "Photos",                type: "photo" },
  { id: "ex_sig_tech",   libelle: "Signature technicien",  type: "signature", signataire: "salarie" },
  { id: "ex_sig_client", libelle: "Signature client",      type: "signature", signataire: "client", obligatoire: true }
].map(c => Object.assign({ obligatoire: false, dictee: false, signataire: "salarie", options: [], auto: "" }, c));

export const BON_EXEMPLE = {
  chantier: "MARY GERARD",
  coord: { adresse: "1 Impasse de la Baptisterie", ville: "61170 Le Ménil-Guyon", mobile: "", fixe: "" },
  salarieNom: "François-Xavier MILLE",
  // Installation n°1136 d'Organilog, reprise dans le parc d'équipements du client
  equipement: {
    type: "Pompe à Chaleur Air Eau",
    marque: "Hitachi",
    modele: "Ui : RWD-5.0NWE-200S / Ue : RAS-5WHNPE",
    numeroSerie: "371876/7E483008",
    emplacement: "",
    notes: "N° de série de l'unité extérieure effacé."
  },
  dateIntervention: "2026-10-13",
  reponses: {
    ex_date: "2026-10-13",
    ex_debut: "11:00",
    ex_fin: "12:00",
    ex_duree: "1h00",
    ex_type_act: "Intervention / Dépannage",
    ex_type_eq: "Pompe à Chaleur Air Eau",
    ex_marque: "Hitachi",
    ex_reference: "Ui : RWD-5.0NWE-200S (371876/7E483008) / Ue : RAS-5WHNPE (SN effacé)",
    ex_arr_fonct: true,
    ex_arr_defaut: true,
    ex_defauts: "Défaut 018.",
    ex_rapport:
      "PAC en mode secours ECS depuis la dernière intervention.\n" +
      "Appel au SAV Hitachi car impossible lors de la dernière intervention (heure tardive).\n" +
      "Suite à notre échange avec Hitachi, demande de contrôle sur place et de pouvoir les joindre.\n\n" +
      "Appel au SAV ce jour et explications du technicien : sur ce modèle, suite à des coupures électriques, le régulateur peut perdre ses paramétrages.\n" +
      "Contrôle des paramètres et constatation d'un problème (indication d'une chaudière).\n" +
      "Paramétrage avec l'aide d'Hitachi.\n" +
      "Plus de défaut 018.\n" +
      "Redémarrage et défaut 019 (sonde sortie d'eau échangeur).\n" +
      "Sonde légèrement abîmée.\n" +
      "Fourniture et remplacement.\n" +
      "Plus de défaut.",
    ex_depart: [],
    ex_pieces_ok: true,
    ex_pieces: "Sonde sortie échangeur (non facturée).",
    ex_devis: false,
    ex_reglement: false,
    ex_photos: [],
    ex_sig_tech: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWgAAACMCAYAAABRRzP1AAAEwklEQVR42u3cXU7rSBAG0DZiCzyzElafleQ5i2iekBCKiRBxu37OeRlpdIe5uLq+LrfjbHPOAUA8Ly4BgIAGQEADCGgABDSAgAZAQAMgoAEENAACGkBAAyCgARDQAAIaAAENIKABENAAAhoAAQ2AgAYQ0AAIaAABDYCABkBAAwhoAAQ0gIAGQEADCGgABDQAAhpAQAMgoAGaeHUJAO57e/+YP//d7XrZBDRAkFA2QQMI5eEMGiB4OJugAeG8Y+VZs4CGIIFwu162r3+6IrGCOVpNBDScdNv8/c8Ia+F8zzbnVDEIcJYppHt8dE5AQ+IHTYJaOAtoWBzMP4Mg+gMq4Sygof0nADKdiTp3FtAWklvgdg0vpE3PArrgOaYGrjWNZQ0S4SyghbOQbtHsQtq1FNAFPwGgies0uyMP11BAJ216T/97NLqQdicioBM3vaCuP4U57uh93XybXdEjjcjf0JXdyka/9/9S2z6bmgm6yETmdrh2o5uke/aBCbrI4tn7GaatuoGotvUfngvokxv+mYtn7+dp5PyNbVrueZchoAsuHCH9/LpFaHR17UdAH9zgZ+3qe82sof++oZpeDUEC2nnzsttiIT1KHbt0r2fl319AFz9HNP31mJ5tujXXvYBucLtl6qoVcjbdPh8/FNBNFoyQrtXo6jk8JKT+baamdh5tUxXQmsjfRaPbdP2OAlqTm7r6hLNNt/a1ENDYVB112FQFtClMQ5vCEM4C2hQ2nOv1avROm26nTVRAN11AJkUDhO9IEdCmMFOXutl0fUeKgAbHOJ4vCGgKTWEaut4kVrGmXb9hUEBr7JZnlx3P4rPWtPMdgID2sKJFSHUL5yq/W/dNVUC73Sp/1NF1AnN8JaDR0CZMNTU9C2jTswlUk3epqboJaLfKXmDxMFufCWgPK9wWq5maGhwCBbRdEFMYNtWAAf11kSt/CqD6oqn4wLD78Y1PdTQP6Lf3j1mt4Hb0fA2tZjlrqm4HB3S1Hbr7dCHU1FSvFTviqH4b1S20stXTFFanpuq28FMc2UJao+draFNYzprqtcUB7eIOZ5emMIRz3AnaK6bOLtXMFO2Ox4sqFo2jDp5c07PqalNdGNBVGtqiiV1T0/Mx6/vIuqpZ4Ak6akhbNPlqaoLPN4Tos0ABneXCWzR1aqpujrAEdKHCW4Q5a2pTzVXXvbNtNfOQ0BRWLKQ1+nAEJqDrT9EaXTNy7Cc79v672/Wy6bXgE/SZzSycc95pqFuefv0tnF3Nx7Y5Z8vmsnBy1lU4xwnkR9ddrRIGdJTCWTz5rqma5b7LVauR44gj4iumFo8Jnf1+da19imNJSGv0fBuvmuV+3iDgR64jjrMaz7lzvroK59zHH2qVOKBXN6Bmz1NXmykECOhVwSmc40xX36/7X49A1IxOXk1zZHjWoF4MDwmHL2kh3NN/4cxwxFFz0jU955ua1QcCBvR/31wSzrkCWy0gWUAf8XqpcAYEdOCXVoQzIKADBrVwBgR0oKAWyoCA9lopgIAGGF5UAUBAAyCgAQQ0AAIaQEADIKABENAAAhoAAQ0goAEQ0AACGgABDYCABhDQAAhoAAENgIAGQEADCGgABDSAgAZAQAMIaAAENAACGkBAA/BUn5R4XE+AEJQ5AAAAAElFTkSuQmCC",
    ex_sig_client: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWgAAACMCAYAAABRRzP1AAAE2klEQVR42u3dS07jQBQF0ApiC4xZCatnJYxZhBkhIQRJHJVd73OO1Gq1epD4U7eeX8r2Zdu2AUA8T3YBgIAGQEADCGgABDSAgAZAQAMgoAEENAACGkBAAyCgARDQAAIaAAENIKABENAAAhoAAQ2AgAYQ0AAIaAABDYCABkBAk9nL69t27d9QxbNdQIWQBhU0BA1mgY2ABkBAAwho/ACl7wzDj4SCgIOP2+fH+8WeQAXtBygWE8YIaHBVAwIaVM8goHdXaCq4HEHtOCGgVWhob4CAFgCYPBHQ3AwAQW7CBQGtUmNH2DpOCGjVljsiTZow3EkYOAAy3a3mUh9U0Noc7ogMN8GYnBDQxdoALp/zTpaOHQKa8NWZG25AQLcK2czVWdbvPmMiMRkhoPWa3Q4d5PhocyCgCRtyKkYQ0C3DNWN19vM7Z6qiTTSggnZp3OD4CHsE9NDmGAlvia4YXiZbBHTTtc+ZBn/n1RsgoCmxZDB6IKqIEdCCrFTF1z3UvGUFAd20X1kh/KIGmCAFAe2qQB8dBHSXIIsUkveGWrc2gOocAd2kOotS2VUKndnbovpGQJN60olcRQtYaBLQZzz32SU0K85p593wyiv+rvBWDo5Zn/17O1a80uus/ZjpdWV7wvnW/nM1IqD9OKQlEG5bVk+iWcaAABfQLYIsa4UWoYom7s1WzgUBrc1h9cbQ5nhsX13bnjPeTCPABbT2xsEDJEoVPfszq7Q5Hgnne/5fgAvoVn3ao4NNT5XZE7MAF9DaHAkmnbOraJPN4/vprFAT4AI67dpncq5EydSHzv44WAEuoEMOqqw3w1Rc0ZG1D/1o31mA1wnwZz8O5g2AzCee9ob17gJcBV3mpD4z0FZU0VpQcfrO3QJcBa3NIdDcjOPqQoAL6FUHpNptxUcGmgAyIQvw4Wl22huOkdYGmc89z4NOGKyr1sBWmyiibY8rC0oH9Oq1zyqd2CEU+fhUWFKHgBZoxd4ALoDsGxoEdNTLQ4GGvjMq6CAn+MzPjTLpzKqiI06iq7+TvjNaHCYd2xNwH+o70yKgo1chFaqk6is6TMII6CYn+YzPt6St9nfTd0aLw6QTtopeuT2r96WrD9oEdJbnPu8ZlAawCRhU0InedJK5F23C0dqgYUAb+CavTOeS85XWFXT0SqRKtVlhRcfZ54oldWhxNHzrsqscBQUC2sBnShXdMZT0nWlfQVd4S7NJp16rxjFFQBedOKJPOrcCrns46TvTMqCzrH1WaQkm+wAVdMEwzjKQqz2jY9b313emZUBb0uU4RT82+s6ooLU3UlXR3atH1TNaHEVC2WC2pA7SBXTmSvO/QVrlcrhSCFV6YwwCWijYplLLBYcldQhoqlVcwsj+oGlAV1j7bMDWnDz1nVFBq7gIuO/1nWkf0AZBvqD7/bdbuaFJBZ15AHQYvB3C2VUQAtrAJtGTBx1D2gW09gbRJknnJAJapYnzEgGNH9KwpI6ILtu2WfsMd5x3Vm2gggZL6iB2QPshhqHvjIA2GEDfGQG9M5C//zhMKAYQ0AYMOB8R0CCcQUCDcEZAgzAGAQ2ezMdwJyEAKmgABDSAgAZAQAMIaAAENICABkBAAyCgAQQ0AAIaQEADIKABENAAAhoAAQ0goAEQ0AACGgABDYCABhDQABziC0n0uyoA2CJYAAAAAElFTkSuQmCC",
    ex_sig_client__nom: "Mr MARY"
  }
};
