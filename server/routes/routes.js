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
    // Henrri renvoie meta.hasNext (confirmé par le schéma OpenAPI officiel) : plus
    // fiable que de deviner à la taille de la page reçue (fonctionne même si la
    // dernière page fait exactement 100 éléments).
    const aUneSuite = data.meta && typeof data.meta.hasNext === "boolean"
      ? data.meta.hasNext
      : liste.length >= HENRRI_LIMITE_PAGE;
    if (!aUneSuite) break;
  }
  return tous;
}

async function _config(clientId) {
  let cfg = await Henrri.findOne({ clientId });
  if (!cfg) cfg = await Henrri.create({ clientId });
  return cfg;
}

// ── Lire l'état de la connexion (jamais le secret en clair) ──
router.get("/config", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const cfg = await _config(clientId);
    res.json({
      ok: true,
      actif: cfg.actif,
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
    const actif = !!req.body.actif;
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
    _tokenCache.delete(clientId + ":sandbox");
    _tokenCache.delete(clientId + ":production");

    res.json({ ok: true, actif: cfg.actif });
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
    if (!cfg.actif) return res.status(400).json({ ok: false, message: "Connexion Henrri non activée." });

    // Filtre côté Henrri sur le type de document : "quotation" (en minuscule —
    // confirmé par l'énumération officielle DocumentKind du spec OpenAPI Henrri)
    // et sur le statut "finalisé" via le paramètre natif "finalized" (booléen),
    // qui correspond au devis validé/émis (par opposition à un brouillon) — le
    // champ "validated" reste à false même sur un devis que l'utilisateur vient
    // de valider dans Henrri (il correspond à une validation comptable distincte).
    // Tri par date décroissante pour garder les devis récents en tête si jamais
    // le plafond de pagination était atteint. La limite Henrri est plafonnée à
    // 100/page : appelHenrriPagine() parcourt les pages suivantes au besoin.
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
        reference: d.identity || d.reference || d.number || ""
      }));
    res.json({ ok: true, devis: resultat });
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
    prev[annee][mois].chantiers.push({ client: nomChantier, hPrevues: "" });
    doc.previsionnel = prev;
    doc.markModified("previsionnel");
    doc.updatedAt = new Date();
    await doc.save();

    await Henrri.updateOne(
      { clientId },
      { $addToSet: { devisImportes: devisId }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );

    res.json({ ok: true });
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
    res.json({
      ok: true,
      actif: cfg.actif,
      clients: cfg.clientsCache || [],
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

    // Le champ "search" est confirmé optionnel par le spec OpenAPI officiel de
    // Henrri (pas de flag "required") : un appel sans filtre renvoie bien toute
    // la base clients. Limite Henrri plafonnée à 100/page : appelHenrriPagine()
    // parcourt les pages suivantes au besoin pour récupérer la base complète.
    const liste = await appelHenrriPagine(clientId, cfg.henrriClientId, cfg.henrriClientSecret, cfg.henrriEnvironnement, HENRRI_CUST_PATH, {});
    // Champs Henrri en camelCase (confirmé sur le modèle Document.customer d'un
    // vrai devis sandbox : name, tradeName, address, contacts) — corrigé du
    // snake_case initialement supposé (post_code, is_primary…).
    const resultat = liste.map(c => {
      const adr = c.address || {};
      const contacts = Array.isArray(c.contacts) ? c.contacts : [];
      const principal = contacts.find(ct => ct && (ct.primary || ct.isPrimary)) || contacts[0] || {};
      return {
        id: String(c.id),
        nom: c.name || c.tradeName || c.companyName || "",
        adresse: adr.address || "",
        ville: [adr.postCode, adr.city].filter(Boolean).join(" ").trim() || adr.city || "",
        codePostal: adr.postCode || "",
        telephone: principal.phone || principal.mobile || c.phone || "",
        email: principal.email || c.email || ""
      };
    });

    cfg.clientsCache = resultat;
    cfg.clientsCacheLe = new Date();
    cfg.updatedAt = new Date();
    await cfg.save();

    res.json({ ok: true, clients: resultat, actualiseLe: cfg.clientsCacheLe });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
