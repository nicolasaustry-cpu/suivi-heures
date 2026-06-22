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
import faqRoutes    from "./routes/faq.js";
import bevRoutes    from "./routes/bev.js";
import prescRoutes  from "./routes/presc.js";
import { planifierSauvegardeQuotidienne } from "./jobs/backupQuotidien.js";

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "5mb" }));   // notes avec photos compressées (3 max ≈ 1,5 Mo)
app.use(express.static(path.join(__dirname, "../public")));

app.use("/api/auth",    authRoutes);
app.use("/api/data",    dataRoutes);
app.use("/api/admin",   adminRoutes);
app.use("/api/saisies", saisiesRoutes);
app.use("/api/faq",     faqRoutes);
app.use("/api/bev",     bevRoutes);
app.use("/api/presc",   prescRoutes);

// Endpoint de santé : vérifie l'état du serveur et de la base.
// Utile pour le monitoring (UptimeRobot…) et le diagnostic de panne.
app.get("/api/health", (req, res) => {
  const etatMongo = mongoose.connection.readyState; // 1 = connecté
  res.json({
    ok: true,
    serveur: "en ligne",
    mongo: etatMongo === 1 ? "connecté" : "déconnecté",
    timestamp: new Date().toISOString()
  });
});

// Fallback SPA : uniquement pour les requêtes qui ne sont pas /api et
// qui ne ciblent pas un fichier statique avec extension. Évite que GET /api/inexistant
// ou GET /favicon-inexistant.png renvoient le HTML de index.html.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/"))      return res.status(404).json({ ok: false, message: "Route API inconnue" });
  if (path.extname(req.path))            return res.status(404).send("Fichier introuvable");
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ─────────────────────────────────────────────────────────────
// Connexion MongoDB résiliente
// Le serveur ne s'arrête JAMAIS si MongoDB est temporairement
// indisponible : il réessaie en boucle et se reconnecte tout seul.
// Cela évite l'écran "Application failed to respond".
// ─────────────────────────────────────────────────────────────
const MONGO_OPTS = {
  serverSelectionTimeoutMS: 10000, // 10s pour trouver le serveur avant de réessayer
};

async function connecterMongo() {
  try {
    await mongoose.connect(process.env.MONGO_URI, MONGO_OPTS);
    console.log("✅ Connecté à MongoDB Atlas");
  } catch (err) {
    console.error("❌ Connexion MongoDB échouée :", err.message);
    console.log("⏳ Nouvelle tentative dans 5 secondes…");
    setTimeout(connecterMongo, 5000); // réessaie sans tuer le serveur
  }
}

// Si la connexion est perdue en cours de route, Mongoose tente de se reconnecter
mongoose.connection.on('disconnected', () => {
  console.warn("⚠️  MongoDB déconnecté — tentative de reconnexion automatique…");
});
mongoose.connection.on('reconnected', () => {
  console.log("✅ MongoDB reconnecté");
});
mongoose.connection.on('error', (err) => {
  console.error("⚠️  Erreur MongoDB :", err.message);
});

connecterMongo();

// Sauvegarde quotidienne « maison » → collection donnees_history (rétention 30 j)
planifierSauvegardeQuotidienne();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serveur lancé sur le port ${PORT}`));
