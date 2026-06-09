import jwt from "jsonwebtoken";

export function verifyToken(req, res, next) {
  let token = req.headers.authorization?.split(" ")[1];
  if (!token && req.body && req.body._token) token = req.body._token;  // repli sendBeacon (sans en-tête)
  if (!token) return res.status(401).json({ message: "Accès refusé : aucun token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(400).json({ message: "Token invalide ou expiré" });
  }
}

export function verifyAdmin(req, res, next) {
  if (req.user?.role !== "admin")
    return res.status(403).json({ message: "Accès réservé à l'administrateur" });
  next();
}
