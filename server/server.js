import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import dataRoutes from "./routes/data.js";
import adminRoutes from "./routes/admin.js";

 // routes d’authentification

dotenv.config(); // charge le fichier .env

const app = express();

// --- Middlewares ---
app.use(cors());
app.use(express.json());

// --- Route de test ---
app.get("/", (req, res) => {
  res.send("✅ Le serveur fonctionne et MongoDB est connecté !");
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
