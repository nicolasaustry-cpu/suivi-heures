import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes  from "./routes/auth.js";
import dataRoutes  from "./routes/data.js";
import adminRoutes from "./routes/admin.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Middlewares ──
app.use(cors());
app.use(express.json());

// ── Fichiers statiques (pages HTML) ──
app.use(express.static(path.join(__dirname, "../public")));

// ── Routes API ──
app.use("/api/auth",  authRoutes);
app.use("/api/data",  dataRoutes);
app.use("/api/admin", adminRoutes);

// ── Toutes les autres routes → index.html (SPA) ──
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ── Connexion MongoDB ──
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connecté à MongoDB Atlas"))
  .catch(err => { console.error("❌ Erreur MongoDB :", err); process.exit(1); });

// ── Lancement ──
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serveur lancé sur le port ${PORT}`));
