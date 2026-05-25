import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes   from "./routes/auth.js";
import dataRoutes   from "./routes/data.js";
import adminRoutes  from "./routes/admin.js";
import saisiesRoutes from "./routes/saisies.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.use("/api/auth",    authRoutes);
app.use("/api/data",    dataRoutes);
app.use("/api/admin",   adminRoutes);
app.use("/api/saisies", saisiesRoutes);

// Fallback SPA : uniquement pour les requêtes qui ne sont pas /api et
// qui ne ciblent pas un fichier statique avec extension. Évite que GET /api/inexistant
// ou GET /favicon-inexistant.png renvoient le HTML de index.html.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/"))      return res.status(404).json({ ok: false, message: "Route API inconnue" });
  if (path.extname(req.path))            return res.status(404).send("Fichier introuvable");
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connecté à MongoDB Atlas"))
  .catch(err => { console.error("❌ Erreur MongoDB :", err); process.exit(1); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serveur lancé sur le port ${PORT}`));
