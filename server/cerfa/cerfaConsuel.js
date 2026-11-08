// ─────────────────────────────────────────────────────────────
// cerfa/cerfaConsuel.js — Attestations de conformité électrique (Consuel)
//   12506*03 jaune    : installation électrique à usage domestique
//   12507*03 verte    : installation électrique à usage non domestique
//   15523*01 bleue    : installation de production sans stockage
//   15524*01 violette : installation de production avec stockage
// ─────────────────────────────────────────────────────────────
// Le formulaire officiel est vendu et numéroté par le Consuel : il ne peut pas
// être rempli ici. Suiv'Heures génère une FICHE DE PRÉPARATION (MODE "fiche")
// reprenant les rubriques de l'attestation, pré-remplie d'après le bon, que
// l'installateur reporte ensuite dans son espace Consuel.
// ─────────────────────────────────────────────────────────────

import { T, Z, C, R, N, jjmmaaaa, nomClient, cpVille, blocEntreprise, signataireClient, rapportDuBon } from "./outils.js";

const AVERTISSEMENT = "Document de préparation établi avec Suiv'Heures : il ne remplace pas l'attestation de conformité. " +
  "Seule l'attestation achetée auprès du Consuel, portant son numéro et son visa, est valable pour la mise en service. " +
  "Reporter ces informations sur l'attestation officielle (espace Consuel).";

// ── Rubriques communes ──
const INSTALLATEUR = { titre: "Installateur", champs: [
  Z("installateur", "Nom, adresse et SIRET de l'installateur", { memo: "installateurElec" }),
  T("qualif", "Qualification (Qualifelec, QualiPV…) et n°", { memo: "qualifElec" })
] };
const INSTALLATION = { titre: "Installation", champs: [
  T("client", "Client / maître d'ouvrage"),
  Z("adresse", "Adresse exacte de l'installation"),
  T("pdl", "N° de point de livraison (PDL / PRM)", { court: true })
] };
const NATURE = { titre: "Nature des travaux", champs: [
  R("nature", "Travaux", [["neuf", "Installation neuve"], ["renov", "Rénovation totale (mise hors tension par le distributeur)"], ["modif", "Modification / extension"]])
] };
const RACCORDEMENT = [
  R("branchement", "Branchement", [["mono", "Monophasé"], ["tri", "Triphasé"]]),
  T("puissance", "Puissance souscrite / de raccordement (kVA)", { court: true }),
  T("agcp", "Calibre de l'AGCP (disjoncteur de branchement, A)", { court: true })
];
const TERRE = [
  T("terre", "Résistance de la prise de terre (ohms)", { court: true }),
  C("liaisonPrincipale", "Liaison équipotentielle principale"),
  C("conducteurTerre", "Conducteur principal de protection raccordé")
];
const OBSERVATIONS = { titre: "Observations", champs: [Z("obs", "Observations / réserves")] };
const SIGNATURES = {
  operateur: { titre: "L'installateur (date et signature)", champNom: "signTech" },
  detenteur: { titre: "Le client", champNom: "signClient" }
};
const SIGN_SECTION = { titre: "Signataires", aide: "Les signatures du bon sont reprises sur la fiche.", champs: [
  T("signTech", "Installateur : nom du signataire"),
  T("signDate", "Date", { court: true }),
  T("signClient", "Client : nom du signataire")
] };

// ── Production photovoltaïque (bleue et violette) ──
const PRODUCTION = { titre: "Installation de production", champs: [
  R("mode", "Mode d'exploitation", [["totale", "Vente totale"], ["surplus", "Autoconsommation avec vente du surplus"], ["sansinj", "Autoconsommation sans injection"]]),
  T("source", "Source d'énergie", { court: true }),
  T("crete", "Puissance crête (kWc)", { court: true }),
  T("nbModules", "Nombre de modules", { court: true }),
  T("modules", "Modules : marque et modèle"),
  T("pOnduleur", "Puissance totale des onduleurs (kVA)", { court: true }),
  T("nbOnduleurs", "Nombre d'onduleurs / micro-onduleurs", { court: true }),
  T("onduleurs", "Onduleurs : marque et modèle"),
  R("raccProd", "Raccordement de la production", [["mono", "Monophasé"], ["tri", "Triphasé"]])
] };
const PROTECTIONS_PV = { titre: "Protections et mise à la terre", champs: [
  C("coupureDC", "Dispositif de coupure DC accessible"),
  C("parafoudreDC", "Parafoudre côté continu"),
  C("parafoudreAC", "Parafoudre côté alternatif"),
  C("ddrProd", "Protection différentielle du circuit de production"),
  C("terreMasses", "Masses métalliques (structure, cadres) reliées à la terre"),
  C("etiquetage", "Étiquetage réglementaire posé (coffrets, tableau, onduleurs)"),
  T("terre", "Résistance de la prise de terre (ohms)", { court: true })
] };
const STOCKAGE = { titre: "Stockage", champs: [
  T("batterie", "Batterie : marque et modèle"),
  T("techno", "Technologie (lithium-ion…)", { court: true }),
  T("capacite", "Capacité utile (kWh)", { court: true }),
  T("pBatterie", "Puissance de charge / décharge (kW)", { court: true }),
  R("couplage", "Couplage", [["ac", "Côté alternatif (AC)"], ["dc", "Côté continu (DC)"]]),
  T("empBatterie", "Emplacement de la batterie"),
  C("ventBatterie", "Emplacement conforme aux préconisations du fabricant"),
  C("secours", "Fonction secours / îlotage")
] };

// ── Définition des 4 attestations ──
const DEFS = [
  {
    CODE: "12506", NUMERO: "12506*03", couleur: "jaune", COULEUR: [0.85, 0.65, 0.05],
    INTITULE: "Attestation de conformité Consuel jaune — installation électrique à usage domestique",
    sections: [INSTALLATEUR, INSTALLATION, NATURE,
      { titre: "Type de local", champs: [
        R("local", "Local", [["maison", "Maison individuelle"], ["appart", "Logement en immeuble collectif"], ["dependance", "Dépendance / installation extérieure"]])
      ] },
      { titre: "Caractéristiques de l'installation", champs: [
        ...RACCORDEMENT,
        T("nbCircuits", "Nombre de circuits", { court: true }),
        C("ddr30", "Protection différentielle 30 mA de tous les circuits"),
        C("ddrTypeA", "Interrupteur différentiel de type A (lave-linge, plaques…)"),
        C("liaisonSdb", "Liaison équipotentielle salle d'eau"),
        C("parafoudre", "Parafoudre"),
        C("gtl", "Gaine technique logement (GTL)"),
        C("irve", "Borne de recharge véhicule électrique (IRVE)"),
        ...TERRE
      ] }, OBSERVATIONS, SIGN_SECTION]
  },
  {
    CODE: "12507", NUMERO: "12507*03", couleur: "verte", COULEUR: [0.1, 0.55, 0.3],
    INTITULE: "Attestation de conformité Consuel verte — installation électrique à usage non domestique",
    sections: [INSTALLATEUR, INSTALLATION, NATURE,
      { titre: "Type de locaux", champs: [
        R("locaux", "Locaux", [["erp", "Établissement recevant du public"], ["travail", "Locaux de travail (tertiaire, industriel)"], ["communs", "Parties communes d'immeuble"], ["exterieur", "Éclairage extérieur / mobilier urbain"]]),
        T("erpCat", "ERP : type et catégorie", { court: true })
      ] },
      { titre: "Caractéristiques de l'installation", champs: [
        R("tension", "Alimentation", [["bt36", "BT jusqu'à 36 kVA"], ["bt", "BT au-delà de 36 kVA"], ["hta", "HTA"]]),
        ...RACCORDEMENT,
        R("schema", "Schéma des liaisons à la terre", [["TT", "TT"], ["TN", "TN"], ["IT", "IT"]]),
        C("ddr30", "Protection différentielle 30 mA des circuits prises de courant"),
        C("eclSecurite", "Éclairage de sécurité"),
        C("coupureUrgence", "Coupure d'urgence"),
        T("verification", "Rapport de vérification initiale : organisme et n°"),
        ...TERRE
      ] }, OBSERVATIONS, SIGN_SECTION]
  },
  {
    CODE: "15523", NUMERO: "15523*01", couleur: "bleue", COULEUR: [0.12, 0.35, 0.75],
    INTITULE: "Attestation de conformité Consuel bleue — installation de production sans stockage",
    sections: [INSTALLATEUR, INSTALLATION, NATURE, PRODUCTION, PROTECTIONS_PV, OBSERVATIONS, SIGN_SECTION]
  },
  {
    CODE: "15524", NUMERO: "15524*01", couleur: "violette", COULEUR: [0.45, 0.2, 0.65],
    INTITULE: "Attestation de conformité Consuel violette — installation de production avec stockage",
    sections: [INSTALLATEUR, INSTALLATION, NATURE, PRODUCTION, STOCKAGE, PROTECTIONS_PV, OBSERVATIONS, SIGN_SECTION]
  }
];

/* Saisie sur MOBILE : mesures et constats du technicien. */
function mobile(code) {
  const base = [
    { titre: "Installation", champs: [
      T("pdl", "N° PDL / PRM (compteur), si connu"),
      R("nature", "Travaux", [["neuf", "Neuf"], ["renov", "Rénovation totale"], ["modif", "Modification"]])
    ] }
  ];
  if (code === "12506" || code === "12507") {
    base.push({ titre: "Mesures et contrôles", champs: [
      R("branchement", "Branchement", [["mono", "Mono"], ["tri", "Tri"]]),
      N("puissance", "Puissance (kVA)"),
      N("agcp", "Calibre AGCP (A)"),
      N("terre", "Prise de terre (ohms)"),
      C("liaisonPrincipale", "Liaison équipotentielle principale"),
      C("conducteurTerre", "Conducteur principal de protection raccordé"),
      ...(code === "12506"
        ? [N("nbCircuits", "Nombre de circuits"), C("ddr30", "Différentiel 30 mA partout"), C("ddrTypeA", "Différentiel type A"),
           C("liaisonSdb", "Liaison salle d'eau"), C("parafoudre", "Parafoudre"), C("gtl", "GTL"), C("irve", "Borne IRVE")]
        : [R("schema", "Schéma de liaison à la terre", [["TT", "TT"], ["TN", "TN"], ["IT", "IT"]]),
           C("ddr30", "Différentiel 30 mA prises de courant"), C("eclSecurite", "Éclairage de sécurité"), C("coupureUrgence", "Coupure d'urgence")])
    ] });
  } else {
    base.push({ titre: "Production", champs: [
      R("mode", "Mode", [["totale", "Vente totale"], ["surplus", "Surplus"], ["sansinj", "Sans injection"]]),
      N("crete", "Puissance crête (kWc)"), N("nbModules", "Nombre de modules"), T("modules", "Modules : marque / modèle"),
      N("pOnduleur", "Puissance onduleurs (kVA)"), N("nbOnduleurs", "Nombre d'onduleurs"), T("onduleurs", "Onduleurs : marque / modèle"),
      R("raccProd", "Raccordement", [["mono", "Mono"], ["tri", "Tri"]])
    ] });
    if (code === "15524") base.push({ titre: "Stockage", champs: [
      T("batterie", "Batterie : marque / modèle"), N("capacite", "Capacité (kWh)"), N("pBatterie", "Puissance (kW)"),
      R("couplage", "Couplage", [["ac", "AC"], ["dc", "DC"]]), T("empBatterie", "Emplacement"), C("secours", "Fonction secours")
    ] });
    base.push({ titre: "Protections", champs: [
      C("coupureDC", "Coupure DC accessible"), C("parafoudreDC", "Parafoudre DC"), C("parafoudreAC", "Parafoudre AC"),
      C("ddrProd", "Différentiel circuit production"), C("terreMasses", "Masses reliées à la terre"),
      C("etiquetage", "Étiquetage posé"), N("terre", "Prise de terre (ohms)")
    ] });
  }
  return base;
}

function creer(d) {
  return {
    CODE: d.CODE,
    NUMERO: d.NUMERO,
    TITRE: `CERFA ${d.NUMERO} — Consuel, attestation ${d.couleur} (fiche de préparation)`,
    INTITULE: d.INTITULE,
    COULEUR: d.COULEUR,
    MODE: "fiche",
    AVERTISSEMENT,
    SECTIONS: d.sections,
    MOBILE: mobile(d.CODE),
    SIGNATURES,
    preremplir(ctx) {
      const { bon, champs = [], coord = {}, entreprise = {}, reglages = {} } = ctx;
      const v = {};
      const { cp, ville, rue } = cpVille(coord);
      v.installateur = reglages.installateurElec || blocEntreprise(entreprise);
      v.qualif = reglages.qualifElec || "";
      v.client = nomClient(bon.chantier);
      v.adresse = [rue, [cp, ville].filter(Boolean).join(" ")].filter(Boolean).join("\n");
      v.nature = "neuf";
      if (d.CODE === "15523" || d.CODE === "15524") { v.source = "Photovoltaïque"; v.mode = "surplus"; }
      v.obs = rapportDuBon(bon, champs).slice(0, 900);
      v.signTech = bon.salarieNom || "";
      v.signDate = jjmmaaaa(bon.dateIntervention);
      v.signClient = signataireClient(bon, champs);
      return v;
    }
  };
}

export const CONSUEL = DEFS.map(creer);
