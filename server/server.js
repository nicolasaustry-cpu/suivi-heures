import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import dataRoutes from "./routes/data.js";
import adminRoutes from "./routes/admin.js";

dotenv.config(); // charge le fichier .env

const app = express();

// --- Middlewares ---
app.use(cors());
app.use(express.json());

// ✅ Ajoute cette ligne : rend le dossier public accessible
app.use(express.static("public"));

// --- Route de test ---
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Sert automatiquement index.html à la racine
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// --- Routes principales ---
app.use("/api/auth", authRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/admin", adminRoutes);

// --- Connexion à MongoDB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Connecté à MongoDB"))
  .catch((err) => console.error("Erreur de connexion MongoDB :", err));

// --- Lancement du serveur ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Serveur lancé sur le port ${PORT}`));

