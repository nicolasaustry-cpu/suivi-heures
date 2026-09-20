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

   Authentification Henrri : OAuth2 client_credentials (client_id +
   client_secret propres à chaque entreprise, saisis dans la page
   Entreprise). Le secret ne repart JAMAIS vers le navigateur une
   fois enregistré (la lecture de la config le masque).

   ⚠ Endpoints Henrri ci-dessous basés sur la documentation publique
   du SDK non officiel "henrri-connect" (sandbox https://api-sandbox.henrri.io).
   Non testés en conditions réelles (réseau de développement sans accès
   sortant vers l'API Henrri) : à corriger si l'API renvoie une erreur
   404/400 lors du premier test réel — voir les logs Railway, le message
   d'erreur y est renvoyé tel quel par appelHenrri().
   ─────────────────────────────────────────────────────────────── */

const HENRRI_BASE_URL   = "https://api-sandbox.henrri.io";
const HENRRI_TOKEN_PATH = "/api/oauth/token";
const HENRRI_DOCS_PATH  = "/api/documents";
const HENRRI_CUST_PATH  = "/api/customers";

// Cache mémoire des tokens en cours (évite une authentification à chaque appel).
// Clé = clientId Suiv'Heures. Valeur = { token, expire (timestamp ms) }.
const _tokenCache = new Map();

async function obtenirToken(clientId, henrriClientId, henrriClientSecret) {
  const cache = _tokenCache.get(clientId);
  if (cache && cache.expire > Date.now() + 5000) return cache.token;

  const r = await fetch(HENRRI_BASE_URL + HENRRI_TOKEN_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: henrriClientId,
      client_secret: henrriClientSecret,
      grant_type: "client_credentials"
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
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v); });
  const r = await fetch(url, { headers: { "Authorization": "Bearer " + token } });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`Appel Henrri échoué (HTTP ${r.status}) ${detail.slice(0, 300)}`);
  }
  return r.json();
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

    // ⚠ Paramètres de filtre (type de document = devis, statut = validé) à ajuster
    // selon les noms de champs réels renvoyés par l'API (à confirmer au 1er test).
    const data = await appelHenrri(clientId, cfg.henrriClientId, cfg.henrriClientSecret, HENRRI_DOCS_PATH, {
      document_type: "devis",
      status: "valide",
      limit: 100
    });
    const liste = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
    const dejaImportes = new Set(cfg.devisImportes || []);
    const resultat = liste
      .filter(d => !dejaImportes.has(String(d.id)))
      .map(d => ({
        id: String(d.id),
        client: (d.customer && (d.customer.name || d.customer.nom)) || d.customer_name || "",
        montant: d.total_ttc ?? d.montant ?? d.total ?? null,
        date: d.date || d.created_at || null,
        reference: d.reference || d.number || ""
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

// ── Base clients Henrri ──
router.get("/clients", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const cfg = await _config(clientId);
    if (!cfg.actif) return res.status(400).json({ ok: false, message: "Connexion Henrri non activée." });

    // ⚠ Champs à ajuster selon la structure réelle du modèle Customer Henrri.
    const data = await appelHenrri(clientId, cfg.henrriClientId, cfg.henrriClientSecret, HENRRI_CUST_PATH, { limit: 200 });
    const liste = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
    const resultat = liste.map(c => ({
      id: String(c.id),
      nom: c.name || c.nom || c.raison_sociale || "",
      adresse: c.address || c.adresse || "",
      ville: c.city || c.ville || "",
      codePostal: c.zip_code || c.code_postal || "",
      telephone: c.phone || c.telephone || "",
      email: c.email || ""
    }));
    res.json({ ok: true, clients: resultat });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
