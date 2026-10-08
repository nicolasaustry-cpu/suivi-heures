import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";
import Henrri from "../models/henrri.js";
import Donnees from "../models/donnees.js";

const router = express.Router();

/* ───────────────────────────────────────────────────────────────
   Intégration API Henrri (facturation), par entreprise cliente.
   - Objectif 1 : récupérer les devis validés Henrri → les affecter
     à un mois du Prévisionnel (chantiers.html).
   - Objectif 2 : récupérer la base clients Henrri → préremplir les
     coordonnées de chantier + nouvelle page clients.html.

   Authentification Henrri : schéma propre à Henrri (PAS un OAuth2
   client_credentials standard) : POST /v1/users/authenticate avec un
   corps JSON {clientId, clientSecret} (identifiants propres à chaque
   entreprise, saisis dans la page Entreprise). Le secret ne repart
   JAMAIS vers le navigateur une fois enregistré (la lecture de la
   config le masque).

   Contrat d'API confirmé via la documentation du SDK non officiel
   "henrri-connect" (sandbox https://api-sandbox.henrri.io) après
   échec du premier test réel (HTTP 404 sur l'ancien chemin
   /api/oauth/token, qui n'existe pas).

   ⚠ Environnement (sandbox / production) : Henrri utilise DEUX hôtes
   distincts, confirmés par le README du SDK "henrri-connect" —
   https://api-sandbox.henrri.io (bac à sable, données fictives, clé
   de test) et https://api.henrri.io (production, vraies données,
   nécessite une clé de production demandée via le formulaire Henrri
   dédié). Une même paire client_id/secret n'est valable que sur l'un
   des deux hôtes : le choix se fait par entreprise cliente, via le
   champ henrriEnvironnement enregistré dans la config Henrri.
   ─────────────────────────────────────────────────────────────── */

const HENRRI_URL_SANDBOX    = "https://api-sandbox.henrri.io";
const HENRRI_URL_PRODUCTION = "https://api.henrri.io";
const HENRRI_TOKEN_PATH = "/v1/users/authenticate";
const HENRRI_DOCS_PATH  = "/v1/documents";
const HENRRI_CUST_PATH  = "/v1/customers";

function _baseUrl(environnement) {
  return environnement === "production" ? HENRRI_URL_PRODUCTION : HENRRI_URL_SANDBOX;
}

// En-têtes obligatoires sur tous les appels Henrri (y compris l'authentification).
function _entetesHenrri(token) {
  const h = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-Version": "1.0"
  };
  if (token) h["Authorization"] = "Bearer " + token;
  return h;
}

// Cache mémoire des tokens en cours (évite une authentification à chaque appel).
// Clé = clientId Suiv'Heures + environnement (un token sandbox et un token
// production ne sont jamais interchangeables, même pour la même entreprise).
const _tokenCache = new Map();

async function obtenirToken(clientId, henrriClientId, henrriClientSecret, environnement) {
  const cle = clientId + ":" + (environnement || "sandbox");
  const cache = _tokenCache.get(cle);
  if (cache && cache.expire > Date.now() + 5000) return cache.token;

  const r = await fetch(_baseUrl(environnement) + HENRRI_TOKEN_PATH, {
    method: "POST",
    headers: _entetesHenrri(),
    body: JSON.stringify({
      clientId: henrriClientId,
      clientSecret: henrriClientSecret
    })
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Authentification Henrri refusée (HTTP ${r.status}) ${detail.slice(0, 300)}`);
  }
  const d = await r.json();
  const token = d.access_token || d.token;
  if (!token) throw new Error("Réponse Henrri sans jeton d'accès");
  const dureeSec = Number(d.expires_in) || 3600;
  _tokenCache.set(cle, { token, expire: Date.now() + dureeSec * 1000 });
  return token;
}

async function appelHenrri(clientId, henrriClientId, henrriClientSecret, environnement, chemin, params) {
  const token = await obtenirToken(clientId, henrriClientId, henrriClientSecret, environnement);
  const url = new URL(_baseUrl(environnement) + chemin);
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== "") url.searchParams.set(k, v); });
  const r = await fetch(url, { headers: _entetesHenrri(token) });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Appel Henrri échoué (HTTP ${r.status}) ${detail.slice(0, 300)}`);
  }
  return r.json();
}

// La limite maximale acceptée par Henrri est 100 par page (confirmé par erreur
// 400 "limit must be between 1 and 100"). On parcourt donc les pages successives
// (page=1,2,…) jusqu'à obtenir moins de 100 éléments ou atteindre un plafond de
// sécurité, afin de ne pas manquer un document récent situé au-delà de la 1ère page.
const HENRRI_LIMITE_PAGE = 100;
const HENRRI_PAGES_MAX   = 10; // plafond de sécurité = 1000 éléments max

// Simplifie un numéro de devis Henrri : ne garde que les 3 derniers groupes
// séparés par "-", en partant de la droite (ex. "I-26-09-1" → "26-09-1").
function _simplifierReference(ref) {
  const parties = String(ref || "").split("-").filter(Boolean);
  return parties.slice(-3).join("-");
}

/* Fiche client Henrri (objet "customer" d'un devis OU élément de /v1/customers,
   même modèle camelCase : name, address{address,postCode,city}, contacts[])
   → format des coordonnées de chantier de Suiv'Heures. */
function _clientHenrriVersFiche(c) {
  const adr = (c && c.address) || {};
  const contacts = Array.isArray(c && c.contacts) ? c.contacts : [];
  const principal = contacts.find(ct => ct && (ct.primary || ct.isPrimary)) || contacts[0] || {};
  return {
    id: c && c.id != null ? String(c.id) : "",
    nom: (c && (c.name || c.tradeName || c.companyName)) || "",
    adresse: adr.address || "",
    ville: [adr.postCode, adr.city].filter(Boolean).join(" ").trim() || adr.city || "",
    codePostal: adr.postCode || "",
    telephone: principal.phone || principal.mobile || (c && c.phone) || "",
    email: principal.email || (c && c.email) || ""
  };
}
// Même répartition mobile / fixe que coordonnees.js (_henrriVersCoord)
function _ficheVersCoordonnees(f) {
  const tel = String((f && f.telephone) || "");
  const estMobile = /^0[67]/.test(tel.replace(/[.\s-]/g, ""));
  return {
    adresse: String((f && f.adresse) || "").slice(0, 500),
    ville:   String((f && f.ville) || "").slice(0, 200),
    mobile:  (estMobile ? tel : "").slice(0, 40),
    fixe:    (estMobile ? "" : tel).slice(0, 40),
    email:   String((f && f.email) || "").trim().slice(0, 120)
  };
}
const _coordVide = c => !c || (!c.adresse && !c.ville && !c.mobile && !c.fixe && !c.email);

async function appelHenrriPagine(clientId, henrriClientId, henrriClientSecret, environnement, chemin, params) {
  let tous = [];
  for (let page = 1; page <= HENRRI_PAGES_MAX; page++) {
    const data = await appelHenrri(clientId, henrriClientId, henrriClientSecret, environnement, chemin, {
      ...params,
      limit: HENRRI_LIMITE_PAGE,
      page
    });
    const liste = Array.isArray(data.elements) ? data.elements
                : (Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []));
    tous = tous.concat(liste);
    const aUneSuite = data.meta && typeof data.meta.hasNext === "boolean" ? data.meta.hasNext : liste.length >= HENRRI_LIMITE_PAGE;
    if (!aUneSuite) break; // dernière page atteinte
  }
  return tous;
}

async function _config(clientId) {
  let cfg = await Henrri.findOne({ clientId });
  if (!cfg) cfg = await Henrri.create({ clientId });
  return cfg;
}

/* ───────────────────────────────────────────────────────────────
   Henrri « version pilotage » : OUI / NON, puis mode de liaison
   - mode "api"    : connexion API (client_id/secret), fonctionnement historique ;
   - mode "import" : import d'un export Excel des devis validés (même démarche
                     que DuoPilot : dépôt → correspondance des colonnes →
                     rapport → application).
   Les champs pilotage / mode / devisFichier ne sont pas forcément déclarés dans
   le modèle Mongoose : ils sont LUS en .lean() (renvoie tout ce qui est en base)
   et ÉCRITS avec { strict: false }, ce qui évite toute modification du modèle.
   Compatibilité : une entreprise déjà connectée par API avant cette évolution
   (pas de champ pilotage) est lue comme pilotage = oui, mode = api.
   ─────────────────────────────────────────────────────────────── */
async function _etat(clientId) {
  await _config(clientId); // garantit l'existence du document
  const brut = (await Henrri.findOne({ clientId }).lean()) || {};
  const pilotage = typeof brut.pilotage === "boolean" ? brut.pilotage : !!brut.actif;
  const mode = brut.mode === "import" ? "import" : "api";
  const actifApi = !!brut.actif;
  // « Henrri actif » au sens de l'appli : bouton Devis Henrri, page Clients…
  const henrriActif = pilotage && (mode === "import" || actifApi);
  return {
    brut, pilotage, mode, actifApi, henrriActif,
    devisFichier: Array.isArray(brut.devisFichier) ? brut.devisFichier : [],
    devisImportes: Array.isArray(brut.devisImportes) ? brut.devisImportes.map(String) : [],
    devisIgnores:  Array.isArray(brut.devisIgnores)  ? brut.devisIgnores.map(String)  : []
  };
}

// Nombre lu dans un export : accepte 12,5 / "12,5 h" / 12.5 / vide → null
function _nombre(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const t = String(v).replace(/\u00a0/g, " ").replace(/\s+/g, "").replace(/h$/i, "").replace(",", ".");
  if (t === "") return null;
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
}
const _txt = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max || 200);

// Heures de référence : heures analysées si > 0, sinon nombre d'heures du devis
function _heuresReference(d) {
  const ha = Number(d && d.heuresAnalysees) || 0;
  if (ha > 0) return { valeur: ha, source: "analysees" };
  const h = Number(d && d.heures) || 0;
  return { valeur: h > 0 ? h : null, source: h > 0 ? "devis" : "" };
}

/* Ligne envoyée par import-henrri.html → devis normalisé (ou { rejet }) */
function _normaliserLigne(l) {
  const numero = _txt(l && l.numero, 60);
  const nom = _txt([l && l.nom, l && l.prenom].filter(x => _txt(x)).join(" "), 200);
  if (!numero) return { rejet: "N° de devis manquant", nom };
  if (!nom) return { rejet: "Nom manquant", numero };
  return {
    id: "imp:" + numero.toUpperCase(),
    numero,
    reference: _simplifierReference(numero) || numero,
    client: nom,
    heures: _nombre(l.heures),
    heuresAnalysees: _nombre(l.heuresAnalysees)
  };
}

/* ── Recherche du client d'un devis importé dans la base clients ──
   L'export Henrri ne contient pas les coordonnées : on les cherche dans ce que
   Suiv'Heures connaît déjà, pour PROPOSER de les reporter sur la fiche du
   chantier créé à l'affectation :
   1. les fiches coordonnées de chantier (planning, prévisionnel, page Clients),
      dont le nom correspond au client (n° de devis final « 26-09-1 » ignoré) ;
   2. à défaut, la base clients Henrri en cache (connexion API antérieure).
   Comparaison sans accents ni casse, ordre des mots indifférent
   (« DUPONT Jean » = « Jean Dupont »). Plusieurs fiches pour un même client :
   on garde la plus complète. */
const _RE_REF_DEVIS = /\s+\d{2}-\d{2}-\d+\s*$/;
function _cleClient(nom) {
  return String(nom || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(_RE_REF_DEVIS, "")
    .replace(/[^A-Z0-9]+/g, " ").trim()
    .split(" ").filter(Boolean).sort().join(" ");
}
const _nbChamps = c => ["adresse", "ville", "mobile", "fixe", "email"].filter(k => c && String(c[k] || "").trim()).length;

function _indexBaseClients(coordonneesChantiers, clientsCache) {
  const index = new Map();
  const proposer = (cle, coord, source, nomTrouve) => {
    if (!cle || _coordVide(coord)) return;
    const actuel = index.get(cle);
    if (!actuel || (actuel.source === source && _nbChamps(coord) > _nbChamps(actuel.coord)))
      index.set(cle, { coord, source, nomTrouve });
  };
  // 1. Fiches coordonnées (prioritaires : saisies ou corrigées dans Suiv'Heures)
  Object.entries(coordonneesChantiers || {}).forEach(([nom, c]) => {
    if (!c || typeof c !== "object") return;
    const coord = {
      adresse: String(c.adresse || "").slice(0, 500), ville: String(c.ville || "").slice(0, 200),
      mobile: String(c.mobile || "").slice(0, 40), fixe: String(c.fixe || "").slice(0, 40),
      email: String(c.email || "").trim().slice(0, 120)
    };
    proposer(_cleClient(nom), coord, "fiche", nom);
  });
  // 2. Cache Henrri (seulement pour les clients absents des fiches)
  (Array.isArray(clientsCache) ? clientsCache : []).forEach(f => {
    const cle = _cleClient(f && f.nom);
    if (cle && !index.has(cle)) proposer(cle, _ficheVersCoordonnees(f), "henrri", f.nom);
  });
  return index;
}

const CHAMPS_COMPARES = [
  ["client", "Nom"], ["heures", "Nombre d'heures"], ["heuresAnalysees", "Heures analysées"]
];

/* Analyse (sans écriture) d'un lot de lignes au regard de ce qui est déjà en base */
function _analyserImport(lignes, etat) {
  const existants = new Map(etat.devisFichier.map(d => [String(d.id), d]));
  const affectes = new Set(etat.devisImportes);
  const ecartes = new Set(etat.devisIgnores);
  const statut = id => affectes.has(id) ? "affecte" : (ecartes.has(id) ? "ecarte" : "attente");

  const vus = new Set();
  const r = { nouveaux: [], misAJour: [], inchanges: [], absents: [], doublons: [], rejets: [], valides: [] };
  (Array.isArray(lignes) ? lignes : []).slice(0, 5000).forEach(l => {
    const d = _normaliserLigne(l || {});
    if (d.rejet) { r.rejets.push({ raison: d.rejet, numero: d.numero || "", client: d.nom || "" }); return; }
    if (vus.has(d.id)) { r.doublons.push({ numero: d.numero, client: d.client }); return; }
    vus.add(d.id);
    r.valides.push(d);
    const ref = _heuresReference(d);
    const resume = { numero: d.numero, client: d.client, heures: d.heures, heuresAnalysees: d.heuresAnalysees,
                     heuresRef: ref.valeur, heuresRefSource: ref.source, statut: statut(d.id) };
    const ancien = existants.get(d.id);
    if (!ancien) { r.nouveaux.push(resume); return; }
    const changements = [];
    CHAMPS_COMPARES.forEach(([cle, libelle]) => {
      const a = ancien[cle] == null ? "" : ancien[cle];
      const b = d[cle] == null ? "" : d[cle];
      if (String(a) !== String(b)) changements.push({ champ: libelle, avant: a, apres: b });
    });
    if (changements.length) r.misAJour.push({ ...resume, changements });
    else r.inchanges.push(resume);
  });
  etat.devisFichier.forEach(d => {
    if (!vus.has(String(d.id)) && statut(String(d.id)) === "attente")
      r.absents.push({ numero: d.numero, client: d.client });
  });
  r.totaux = {
    lignes: Array.isArray(lignes) ? lignes.length : 0,
    nouveaux: r.nouveaux.length, misAJour: r.misAJour.length, inchanges: r.inchanges.length,
    absents: r.absents.length, doublons: r.doublons.length, rejets: r.rejets.length
  };
  return r;
}

// ── Lire l'état de la connexion (jamais le secret en clair) ──
router.get("/config", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const cfg = await _config(clientId);
    const etat = await _etat(clientId);
    res.json({
      ok: true,
      actif: cfg.actif,                     // connexion API active (historique)
      pilotage: etat.pilotage,              // Henrri version pilotage : oui / non
      mode: etat.mode,                      // "api" | "import"
      henrriActif: etat.henrriActif,        // fonctions Henrri visibles dans l'appli
      nbDevisFichier: etat.devisFichier.length,
      devisFichierLe: etat.brut.devisFichierLe || null,
      henrriClientId: cfg.henrriClientId || "",
      henrriClientSecretDefini: !!cfg.henrriClientSecret,
      henrriEnvironnement: cfg.henrriEnvironnement || "sandbox"
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Enregistrer / mettre à jour les identifiants API Henrri ──
router.post("/config", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const henrriClientId     = String(req.body.henrriClientId || "").trim();
    const henrriClientSecret = String(req.body.henrriClientSecret || "").trim();
    // Nouvelle page Entreprise : pilotage (oui/non) + mode (api/import).
    // Ancienne page (pas de champ pilotage) : comportement historique.
    const avecPilotage = typeof req.body.pilotage === "boolean";
    const pilotage = avecPilotage ? req.body.pilotage : !!req.body.actif;
    const mode = avecPilotage ? (req.body.mode === "import" ? "import" : "api") : "api";
    // La connexion API n'est active que si pilotage = oui ET mode = api
    const actif = pilotage && mode === "api";
    const environnement = req.body.henrriEnvironnement === "production" ? "production" : "sandbox";

    if (actif && !henrriClientId) {
      return res.status(400).json({ ok: false, message: "Client ID Henrri requis pour activer la connexion." });
    }

    const cfg = await _config(clientId);
    // On ne garde le secret précédent que si un nouveau n'est pas fourni (permet de
    // modifier le seul Client ID sans ressaisir le secret déjà enregistré).
    const secretAEnregistrer = henrriClientSecret || cfg.henrriClientSecret;

    if (actif) {
      if (!secretAEnregistrer) {
        return res.status(400).json({ ok: false, message: "Client Secret Henrri requis pour activer la connexion." });
      }
      // Valide les identifiants tout de suite (retour d'erreur clair si invalides),
      // sur l'hôte correspondant à l'environnement choisi (sandbox ou production).
      try {
        _tokenCache.delete(clientId + ":" + environnement);
        await obtenirToken(clientId, henrriClientId || cfg.henrriClientId, secretAEnregistrer, environnement);
      } catch (e) {
        return res.status(400).json({ ok: false, message: "Connexion à Henrri impossible : " + e.message });
      }
    }

    cfg.henrriClientId      = henrriClientId || cfg.henrriClientId;
    cfg.henrriClientSecret  = secretAEnregistrer;
    cfg.henrriEnvironnement = environnement;
    cfg.actif               = actif;
    cfg.updatedAt           = new Date();
    await cfg.save();
    await Henrri.updateOne({ clientId }, { $set: { pilotage, mode } }, { strict: false });
    _tokenCache.delete(clientId + ":sandbox");
    _tokenCache.delete(clientId + ":production");

    res.json({ ok: true, actif: cfg.actif, pilotage, mode });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Désactiver / effacer la connexion Henrri ──
router.delete("/config", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    await Henrri.findOneAndUpdate(
      { clientId },
      { $set: { actif: false, henrriClientId: "", henrriClientSecret: "", updatedAt: new Date() } },
      { upsert: true }
    );
    _tokenCache.delete(clientId + ":sandbox");
    _tokenCache.delete(clientId + ":production");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Devis validés Henrri non encore affectés au Prévisionnel ──
router.get("/devis", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const cfg = await _config(clientId);
    const etat = await _etat(clientId);
    if (!etat.pilotage) return res.status(400).json({ ok: false, message: "Henrri n'est pas activé (page Entreprise)." });

    // ── Mode « import de devis validés » : liste issue du dernier import Excel ──
    if (etat.mode === "import") {
      let indexBase = new Map();
      try {
        const doc = await Donnees.findOne({ clientId }, "coordonneesChantiers").lean();
        indexBase = _indexBaseClients(doc && doc.coordonneesChantiers, cfg.clientsCache);
      } catch (e) {
        console.warn("[HENRRI] base clients illisible :", e.message);
      }
      const affectes = new Set(etat.devisImportes);
      const ecartes = new Set(etat.devisIgnores);
      const devis = etat.devisFichier
        .filter(d => d && !affectes.has(String(d.id)) && !ecartes.has(String(d.id)))
        .map(d => {
          const ref = _heuresReference(d);
          return {
            id: String(d.id),
            client: d.client || "",
            reference: d.reference || d.numero || "",
            numero: d.numero || "",
            montant: null,
            date: null,
            signe: false,
            heures: d.heures,
            heuresAnalysees: d.heuresAnalysees,
            heuresRef: ref.valeur,
            heuresRefSource: ref.source,
            // Pas de coordonnées dans l'export : coordonnées trouvées dans la base
            // clients, à PROPOSER (case cochée par défaut dans la modale)
            coordonnees: null,
            coordBase: indexBase.get(_cleClient(d.client)) || null,
            customerId: ""
          };
        });
      return res.json({ ok: true, mode: "import", devis, importeLe: etat.brut.devisFichierLe || null });
    }

    if (!cfg.actif) return res.status(400).json({ ok: false, message: "Connexion Henrri non activée." });

    // Filtre côté Henrri sur le type de document (devis = "Quotation") ;
    // le statut "devis validé/émis" (par opposition à un brouillon) correspond
    // au champ booléen "finalized" — confirmé par test réel : le champ "validated"
    // reste à false même sur un devis que l'utilisateur vient de valider dans
    // Henrri (il correspond probablement à une validation comptable distincte).
    // La limite Henrri est plafonnée à 100/page : appelHenrriPagine() parcourt
    // les pages suivantes au besoin pour ne pas manquer un devis récent.
    const liste = await appelHenrriPagine(clientId, cfg.henrriClientId, cfg.henrriClientSecret, cfg.henrriEnvironnement, HENRRI_DOCS_PATH, {
      documentTypes: "quotation",
      finalized: true,
      sortBy: "date",
      sortOrder: "descending"
    });
    const dejaImportes = new Set(cfg.devisImportes || []);
    const dejaIgnores  = new Set(cfg.devisIgnores  || []);
    const validesUniquement = liste.filter(d => d && d.finalized === true);
    const resultat = validesUniquement
      .filter(d => !dejaImportes.has(String(d.id)) && !dejaIgnores.has(String(d.id)))
      .map(d => ({
        id: String(d.id),
        // Champs Henrri en camelCase (confirmé sur un vrai devis sandbox) :
        // customer.name, priceAfterTax, date, identity (= n° de pièce, ex. "I-26-09-1").
        client: (d.customer && d.customer.name) || "",
        montant: d.priceAfterTax ?? d.priceBeforeTax ?? null,
        date: d.date || null,
        reference: _simplifierReference(d.identity || d.reference || d.number || ""),
        // "validated" = validation électronique (acceptation en ligne par le client,
        // avec identité du signataire). Le statut manuel « Validé par le client »
        // de l'interface Henrri n'est PAS exposé par l'API : on ne s'en sert qu'en
        // information (badge « signé »), jamais comme filtre.
        signe: d.validated === true,
        // Coordonnées du client portées par le devis : renvoyées à l'affectation
        // pour remplir la fiche du chantier créé (adresse visible au planning).
        coordonnees: _ficheVersCoordonnees(_clientHenrriVersFiche(d.customer || {})),
        customerId: d.customer && d.customer.id != null ? String(d.customer.id) : ""
      }));
    res.json({ ok: true, mode: "api", devis: resultat });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Affecter un devis validé à un mois du Prévisionnel ──
// Structure réelle du Prévisionnel (voir chantiers.html) : previsionnel[annee][mois]
// où annee est une clé texte à 4 chiffres et mois un index 0-11 (pas "AAAA-MM").
router.post("/devis/:id/affecter", verifyToken, async (req, res) => {
  try {
    const clientId  = (req.user.clientId || "").toUpperCase();
    const devisId   = String(req.params.id);
    const anneeNum  = parseInt(req.body.annee, 10);
    const moisNum   = parseInt(req.body.mois, 10);
    const nomClient = String(req.body.client || "").trim();
    const reference = String(req.body.reference || "").trim();
    // Heures prévues proposées (mode import : heures analysées, sinon heures du devis).
    // Vide si non fourni (mode API) : saisie manuelle comme avant.
    const hNum = _nombre(req.body.hPrevues);
    const hPrevues = hNum != null && hNum > 0 ? hNum : "";
    if (!Number.isInteger(anneeNum) || anneeNum < 2000 || anneeNum > 2100)
      return res.status(400).json({ ok: false, message: "Année invalide." });
    if (!Number.isInteger(moisNum) || moisNum < 0 || moisNum > 11)
      return res.status(400).json({ ok: false, message: "Mois invalide (attendu 0-11)." });
    if (!nomClient) return res.status(400).json({ ok: false, message: "Nom du client manquant." });

    const annee = String(anneeNum);
    const mois  = String(moisNum);
    // Ligne nommée "<nom du client Henrri> <n° devis>" (ex. "Jean-paul CHAUVET
    // I-26-09-1"), pour distinguer plusieurs devis affectés au même client.
    const nomChantier = reference ? (nomClient + " " + reference) : nomClient;

    let doc = await Donnees.findOne({ clientId });
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables." });

    const prev = doc.previsionnel || {};
    if (!prev[annee]) prev[annee] = {};
    if (!prev[annee][mois]) prev[annee][mois] = { hVendables: "", caObjectif: "", chantiers: [] };
    if (!Array.isArray(prev[annee][mois].chantiers)) prev[annee][mois].chantiers = [];
    prev[annee][mois].chantiers.push({ client: nomChantier, hPrevues });
    doc.previsionnel = prev;
    doc.markModified("previsionnel");

    // Coordonnées du chantier créé : sans elles, le planning (qui cherche l'adresse
    // sous le nom EXACT du chantier, « NOM 26-09-1 ») n'affiche rien, alors que la
    // base clients, elle, connaît l'adresse sous « NOM ». Source : coordonnées
    // portées par le devis (envoyées par chantiers.html), à défaut la base clients
    // Henrri en cache (par id client, puis par nom). Une fiche déjà remplie n'est
    // JAMAIS écrasée.
    let coordAjoutees = false;
    try {
      const cleCh = nomChantier.trim().toUpperCase();
      const coords = doc.coordonneesChantiers || {};
      if (_coordVide(coords[cleCh])) {
        let coord = null;
        const recu = req.body.coordonnees;
        if (recu && typeof recu === "object") {
          const c = {
            adresse: String(recu.adresse || "").slice(0, 500), ville: String(recu.ville || "").slice(0, 200),
            mobile: String(recu.mobile || "").slice(0, 40),    fixe: String(recu.fixe || "").slice(0, 40),
            email: String(recu.email || "").trim().slice(0, 120)
          };
          if (!_coordVide(c)) coord = c;
        }
        // Proposition refusée dans la modale (mode import) : aucune coordonnée reportée
        if (!coord && !req.body.sansCoordonnees) {
          const cfgC = await Henrri.findOne({ clientId }, "clientsCache");
          const cache = (cfgC && Array.isArray(cfgC.clientsCache)) ? cfgC.clientsCache : [];
          const custId = String(req.body.customerId || "");
          const nomU = nomClient.toUpperCase();
          const f = (custId && cache.find(x => x && String(x.id) === custId))
                 || cache.find(x => x && String(x.nom || "").trim().toUpperCase() === nomU);
          if (f) { const c = _ficheVersCoordonnees(f); if (!_coordVide(c)) coord = c; }
        }
        if (coord) {
          coords[cleCh] = coord;
          doc.coordonneesChantiers = coords;
          doc.markModified("coordonneesChantiers");
          coordAjoutees = true;
        }
      }
    } catch (e) {
      console.warn("[HENRRI] coordonnées non reportées sur le chantier :", e.message);
    }
    doc.updatedAt = new Date();
    await doc.save();

    await Henrri.updateOne(
      { clientId },
      { $addToSet: { devisImportes: devisId }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ ok: true, chantier: nomChantier, coordonnees: coordAjoutees });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Écarter un devis proposé sans l'affecter (ne plus le reproposer) ──
router.post("/devis/:id/ignorer", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const devisId  = String(req.params.id);
    await Henrri.updateOne(
      { clientId },
      { $addToSet: { devisIgnores: devisId }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ── Base clients Henrri ──
   Lecture RAPIDE : renvoie le cache déjà stocké côté serveur (clientsCache),
   sans appeler Henrri à chaque fois — utilisé par clients.html au chargement
   ET par le préremplissage des coordonnées de chantier.
   Le rafraîchissement (appel réel à Henrri) est déclenché manuellement via
   POST /clients/sync (bouton dédié dans clients.html). */
router.get("/clients", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const cfg = await _config(clientId);
    const etat = await _etat(clientId);
    res.json({
      ok: true,
      actif: etat.henrriActif,
      mode: etat.mode,
      clients: etat.henrriActif ? (cfg.clientsCache || []) : [],
      actualiseLe: cfg.clientsCacheLe || null
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Rafraîchir la base clients depuis Henrri (appel API réel, manuel) ──
router.post("/clients/sync", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const cfg = await _config(clientId);
    if (!cfg.actif) return res.status(400).json({ ok: false, message: "Connexion Henrri non activée." });

    // Le paramètre "search" est confirmé optionnel par la spécification officielle
    // Henrri (aucun flag "required") : un simple appel sans filtre suffit.
    // Limite Henrri plafonnée à 100/page : appelHenrriPagine() parcourt les
    // pages suivantes au besoin pour récupérer la base clients complète.
    const liste = await appelHenrriPagine(clientId, cfg.henrriClientId, cfg.henrriClientSecret, cfg.henrriEnvironnement, HENRRI_CUST_PATH, {});
    // Champs Henrri en camelCase (confirmé sur le modèle Document.customer d'un
    // vrai devis sandbox : name, tradeName, address, contacts) — corrigé du
    // snake_case initialement supposé (post_code, is_primary…).
    const resultat = liste.map(c => _clientHenrriVersFiche(c));

    cfg.clientsCache = resultat;
    cfg.clientsCacheLe = new Date();
    cfg.updatedAt = new Date();
    await cfg.save();

    res.json({ ok: true, clients: resultat, actualiseLe: cfg.clientsCacheLe });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

/* ───────────────────────────────────────────────────────────────
   IMPORT DES DEVIS VALIDÉS (mode « import ») — même démarche que DuoPilot
   1. import-henrri.html lit le fichier Excel et fait la correspondance
      des colonnes, puis envoie les lignes déjà mappées ;
   2. /import/apercu  : rapport de fusion, AUCUNE écriture ;
   3. /import/confirmer : enregistrement.
   Règles : un import ne supprime jamais rien ; un devis déjà affecté ou écarté
   n'est jamais reproposé (et sa ligne du Prévisionnel n'est jamais modifiée).
   L'export ne contient pas les coordonnées : elles sont proposées à
   l'affectation depuis la base clients (voir _indexBaseClients).
   ─────────────────────────────────────────────────────────────── */
router.post("/import/apercu", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const etat = await _etat(clientId);
    const r = _analyserImport(req.body && req.body.lignes, etat);
    delete r.valides;
    res.json({ ok: true, rapport: r });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post("/import/confirmer", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const etat = await _etat(clientId);
    const r = _analyserImport(req.body && req.body.lignes, etat);
    const maintenant = new Date();

    // Devis : mise à jour / ajout par n° de devis, rien n'est supprimé
    const parId = new Map(etat.devisFichier.map(d => [String(d.id), d]));
    r.valides.forEach(d => {
      const ancien = parId.get(d.id);
      parId.set(d.id, { ...(ancien || {}), ...d, importeLe: (ancien && ancien.importeLe) || maintenant, majLe: maintenant });
    });
    const devisFichier = Array.from(parId.values());

    await Henrri.updateOne(
      { clientId },
      { $set: { devisFichier, devisFichierLe: maintenant, updatedAt: maintenant } },
      { strict: false }
    );

    delete r.valides;
    res.json({ ok: true, rapport: r, enAttente: devisFichier.filter(d => !etat.devisImportes.includes(String(d.id)) && !etat.devisIgnores.includes(String(d.id))).length });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
