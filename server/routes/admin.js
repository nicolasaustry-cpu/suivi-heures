import express from "express";
import User from "../models/user.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Vérifie que l'utilisateur est un admin
function verifyAdmin(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Accès réservé à l'administrateur" });
  }
  next();
}

// Liste tous les utilisateurs
router.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  const users = await User.find().select("-password");
  res.json(users);
});

// Activer / désactiver un utilisateur
router.patch("/users/:id/toggle", verifyToken, verifyAdmin, async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ message: "Utilisateur introuvable" });
  user.active = !user.active;
  await user.save();
  res.json({ message: `Utilisateur ${user.active ? "activé" : "désactivé"}` });
});

export default router;
