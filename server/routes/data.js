import express from "express";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// Exemple de route protégée
router.get("/private", verifyToken, (req, res) => {
  res.json({
    message: "Bienvenue sur la route protégée !",
    user: req.user
  });
});

export default router;
