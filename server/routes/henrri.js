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
   ─────────────────────────────────────────────────────────────── */

const HENRRI_BASE_URL   = "https://api-sandbox.henrri.io";
const HENRRI_TOKEN_PATH = "/v1/users/authenticate";
const HENRRI_DOCS_PATH  = "/v1/documents";
const HENRRI_CUST_PATH  = "/v1/customers";

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
// Clé = clientId Suiv'Heures. Valeur = { token, expire (timestamp ms) }.
const _tokenCache = new Map();

async function obtenirToken(clientId, henrriClientId, henrriClientSecret) {
  const cache = _tokenCache.get(clientId);
  if (cache && cache.expire > Date.now() + 5000) return cache.token;

  const r = await fetch(HENRRI_BASE_URL + HENRRI_TOKEN_PATH, {
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
  _tokenCache.set(clientId, { token, expire: Date.now() + dureeSec * 1000 });
  return token;
}

async function appelHenrri(clientId, henrriClientId, henrriClientSecret, chemin, params) {
  const token = await obtenirToken(clientId, henrriClientId, henrriClientSecret);
  const url = new URL(HENRRI_BASE_URL + chemin);
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

async function appelHenrriPagine(clientId, henrriClientId, henrriClientSecret, chemin, params, champListe) {
  let tous = [];
  for (let page = 1; page <= HENRRI_PAGES_MAX; page++) {
    const data = await appelHenrri(clientId, henrriClientId, henrriClientSecret, chemin, {
      ...params,
      limit: HENRRI_LIMITE_PAGE,
      page
    });
    const liste = Array.isArray(data.elements) ? data.elements
                : (Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []));
    tous = tous.concat(liste);
    if (liste.length < HENRRI_LIMITE_PAGE) break; // dernière page atteinte
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
      henrriClientSecretDefini: !!cfg.henrriClientSecret
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
      // Valide les identifiants tout de suite (retour d'erreur clair si invalides).
      try {
        _tokenCache.delete(clientId);
        await obtenirToken(clientId, henrriClientId || cfg.henrriClientId, secretAEnregistrer);
      } catch (e) {
        return res.status(400).json({ ok: false, message: "Connexion à Henrri impossible : " + e.message });
      }
    }

    cfg.henrriClientId     = henrriClientId || cfg.henrriClientId;
    cfg.henrriClientSecret = secretAEnregistrer;
    cfg.actif              = actif;
    cfg.updatedAt          = new Date();
    await cfg.save();
    _tokenCache.delete(clientId);

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
    _tokenCache.delete(clientId);
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

    // Filtre côté Henrri sur le type de document (devis = "Quotation") ;
    // le statut "devis validé/émis" (par opposition à un brouillon) correspond
    // au champ booléen "finalized" — confirmé par test réel : le champ "validated"
    // reste à false même sur un devis que l'utilisateur vient de valider dans
    // Henrri (il correspond probablement à une validation comptable distincte).
    // La limite Henrri est plafonnée à 100/page : appelHenrriPagine() parcourt
    // les pages suivantes au besoin pour ne pas manquer un devis récent.
    const liste = await appelHenrriPagine(clientId, cfg.henrriClientId, cfg.henrriClientSecret, HENRRI_DOCS_PATH, {
      documentTypes: "Quotation"
    });
    const dejaImportes = new Set(cfg.devisImportes || []);
    const validesUniquement = liste.filter(d => d && d.finalized === true);
    const resultat = validesUniquement
      .filter(d => !dejaImportes.has(String(d.id)))
      .map(d => ({
        id: String(d.id),
        client: (d.customer && d.customer.name) || "",
        montant: d.price_after_tax ?? d.total_ttc ?? null,
        date: d.date || null,
        reference: d.reference || d.number || ""
      }));
    // Compteurs de diagnostic : permettent de localiser où un devis manquant
    // se perd (jamais reçu de Henrri / reçu mais non "finalized" / déjà importé).
    // brut : dump complet des documents "finalized" reçus, pour identifier les
    // vrais noms de champs du client et du montant (client affiché = "MON CLIENT
    // PRO" et montant vide au 1er essai avec customer.name / price_after_tax).
    res.json({
      ok: true,
      devis: resultat,
      debug: {
        totalRecuHenrri: liste.length,
        totalDeclaresValides: validesUniquement.length,
        totalRestantApresImportes: resultat.length,
        brut: validesUniquement
      }
    });
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
    if (!Number.isInteger(anneeNum) || anneeNum < 2000 || anneeNum > 2100)
      return res.status(400).json({ ok: false, message: "Année invalide." });
    if (!Number.isInteger(moisNum) || moisNum < 0 || moisNum > 11)
      return res.status(400).json({ ok: false, message: "Mois invalide (attendu 0-11)." });
    if (!nomClient) return res.status(400).json({ ok: false, message: "Nom du client manquant." });

    const annee = String(anneeNum);
    const mois  = String(moisNum);

    let doc = await Donnees.findOne({ clientId });
    if (!doc) return res.status(404).json({ ok: false, message: "Données introuvables." });

    const prev = doc.previsionnel || {};
    if (!prev[annee]) prev[annee] = {};
    if (!prev[annee][mois]) prev[annee][mois] = { hVendables: "", caObjectif: "", chantiers: [] };
    if (!Array.isArray(prev[annee][mois].chantiers)) prev[annee][mois].chantiers = [];
    prev[annee][mois].chantiers.push({ client: nomClient, hPrevues: "" });
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

    // Le champ "search" est documenté comme obligatoire côté Henrri mais sans
    // valeur par défaut connue : on tente d'abord sans (beaucoup d'API traitent
    // un paramètre de recherche absent comme "pas de filtre"), puis on retente
    // avec un espace (recherche non vide qui matche tout) si Henrri le refuse.
    // Limite Henrri plafonnée à 100/page : appelHenrriPagine() parcourt les
    // pages suivantes au besoin pour récupérer la base clients complète.
    let liste;
    try {
      liste = await appelHenrriPagine(clientId, cfg.henrriClientId, cfg.henrriClientSecret, HENRRI_CUST_PATH, {});
    } catch (e) {
      liste = await appelHenrriPagine(clientId, cfg.henrriClientId, cfg.henrriClientSecret, HENRRI_CUST_PATH, { search: " " });
    }
    const resultat = liste.map(c => {
      const adr = c.address || {};
      const contacts = Array.isArray(c.contacts) ? c.contacts : [];
      const principal = contacts.find(ct => ct && (ct.primary || ct.is_primary)) || contacts[0] || {};
      return {
        id: String(c.id),
        nom: c.name || c.company_name || "",
        adresse: adr.address || "",
        ville: [adr.post_code, adr.city].filter(Boolean).join(" ").trim() || adr.city || "",
        codePostal: adr.post_code || "",
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
