import jwt from "jsonwebtoken";

// Vérifie le token JWT envoyé par le client
export function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Accès refusé : aucun token fourni" });
  }

  try {
    const verified = jwt.verify(token, "SECRET_KEY"); // même clé que dans auth.js
    req.user = verified; // ajoute les infos utilisateur à la requête
    next(); // passe au code suivant
  } catch (err) {
    res.status(400).json({ message: "Token invalide ou expiré" });
  }
}
