import express from "express";
import jwt from "jsonwebtoken";
import Licence from "../models/licence.js";

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
      { clientId: licence.codeClient, nomClient: licence.nomClient, role: "client", type: licence.type },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    res.json({
      ok: true, token,
      clientId:   licence.codeClient,
      nomClient:  licence.nomClient,
      type:       licence.type,
      expiration: licence.dateExpiration
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

export default router;
