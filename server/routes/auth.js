import express from "express";
import jwt from "jsonwebtoken";
import Licence from "../models/licence.js";
import Prescripteur from "../models/prescripteur.js";
import Donnees from "../models/donnees.js";

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const code = (req.body.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ ok: false, message: "Code manquant" });

    const licence = await Licence.findOne({ codeClient: code });
    if (!licence)       return res.status(404).json({ ok: false, message: "Code inconnu" });
    if (!licence.actif) return res.status(403).json({ ok: false, message: "Licence désactivée" });
    if (new Date() > licence.dateExpiration)
      return res.status(403).json({ ok: false, message: "Licence expirée" });

    const token = jwt.sign(
      { clientId: code, nomClient: licence.nomClient, role: "client", type: licence.type },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      ok: true, token,
      clientId:   code,
      nomClient:  licence.nomClient,
      type:       licence.type,
      expiration: licence.dateExpiration,
      marquePartenaire: !!licence.marquePartenaire,
      logoPartenaire:   licence.logoPartenaire || ""
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post("/admin-login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (email    !== process.env.ADMIN_EMAIL ||
        password !== process.env.ADMIN_PASSWORD)
      return res.status(401).json({ ok: false, message: "Identifiants incorrects" });

    const token = jwt.sign({ role: "admin" }, process.env.JWT_SECRET, { expiresIn: "8h" });
    res.json({ ok: true, token });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post("/presc-login", async (req, res) => {
  try {
    const identifiant = (req.body.identifiant || req.body.email || "").trim().toUpperCase();
    const motDePasse  = req.body.motDePasse || req.body.password || "";
    if (!identifiant || !motDePasse)
      return res.status(400).json({ ok: false, message: "Identifiant et mot de passe requis" });

    const presc = await Prescripteur.findOne({ identifiant });
    if (!presc || !presc.actif)
      return res.status(401).json({ ok: false, message: "Identifiants incorrects" });
    const ok = await presc.verifierMotDePasse(motDePasse);
    if (!ok) return res.status(401).json({ ok: false, message: "Identifiants incorrects" });

    const token = jwt.sign(
      { role: "prescripteur", presId: identifiant, nom: presc.nom },
      process.env.JWT_SECRET,
      { expiresIn: "8h" }
    );
    res.json({ ok: true, token, nom: presc.nom, presId: identifiant });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

router.post("/verify", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ ok: false });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ ok: true, ...decoded });
  } catch {
    res.status(401).json({ ok: false, message: "Token invalide" });
  }
});

// ── Infos publiques d'un prescripteur (pour le co-branding de la page d'essai) ──
router.get("/prescripteur-public/:id", async (req, res) => {
  try {
    const id = (req.params.id || "").trim().toUpperCase();
    if (!id) return res.json({ ok: false });
    const presc = await Prescripteur.findOne({ identifiant: id }).select("nom actif logoPartenaire");
    if (!presc || !presc.actif) return res.json({ ok: false });
    res.json({
      ok: true,
      nom: presc.nom || "",
      actif: !!presc.actif,
      logoPartenaire: presc.logoPartenaire || ""
    });
  } catch (err) {
    res.json({ ok: false });
  }
});

// ── Génère un code client unique à partir du nom d'entreprise ──
function _baseCode(nom) {
  const base = (nom || "ESSAI")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  return base || "ESSAI";
}
async function _codeUnique(nom) {
  const base = _baseCode(nom);
  for (let i = 0; i < 25; i++) {
    const suffixe = Math.random().toString(16).slice(2, 6).toUpperCase(); // 4 caractères hex
    const code = base + "-" + suffixe;
    if (!(await Licence.findOne({ codeClient: code }))) return code;
  }
  return "ESSAI-" + Date.now().toString(36).toUpperCase();
}

// ── Auto-inscription à l'essai (30 jours) — route publique ──
router.post("/inscription", async (req, res) => {
  try {
    const nomClient   = (req.body.nomClient   || "").trim();
    const email       = (req.body.email       || "").trim().toLowerCase();
    const codeEmploye = (req.body.codeEmploye || "").trim().toUpperCase();
    const prescIn     = (req.body.prescripteur || "").trim().toUpperCase();

    if (!nomClient)   return res.status(400).json({ ok: false, message: "Nom de l'entreprise requis." });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return res.status(400).json({ ok: false, message: "E-mail invalide." });

    // Anti-abus : un seul essai par e-mail
    const dejaEssai = await Licence.findOne({ email, origine: "auto" });
    if (dejaEssai)
      return res.status(409).json({ ok: false, message: "Un essai a déjà été créé avec cet e-mail." });

    // Co-branding : rattachement au prescripteur si le code est valide et actif
    let prescripteur = "", marquePartenaire = false, logoPartenaire = "";
    if (prescIn) {
      const presc = await Prescripteur.findOne({ identifiant: prescIn });
      if (presc && presc.actif) {
        prescripteur = prescIn;
        marquePartenaire = true;
        logoPartenaire = presc.logoPartenaire || "";
      }
    }

    const code = await _codeUnique(nomClient);
    const now = new Date();
    const dateExpiration = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // +30 jours

    const licence = new Licence({
      codeClient: code,
      nomClient,
      email,
      type: "plus",            // accès complet pendant l'essai
      origine: "auto",
      statut: "essai",
      actif: true,
      dateActivation: now,
      dateExpiration,
      prescripteur,
      marquePartenaire,
      logoPartenaire
    });
    await licence.save();

    // Espace de données vide, avec le code d'accès mobile pré-rempli
    await Donnees.create({
      clientId: code,
      entreprise: { nom: nomClient, codeEmploye }
    });

    res.status(201).json({ ok: true, codeClient: code, expiration: dateExpiration });
  } catch (err) {
    if (err && err.code === 11000)
      return res.status(409).json({ ok: false, message: "Un compte existe déjà. Réessayez." });
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
