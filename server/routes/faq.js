import express from "express";
import { verifyToken, verifyAdmin } from "../middleware/authMiddleware.js";
import Faq from "../models/faq.js";

const router = express.Router();

// ── Lecture publique : le chatbot des clients récupère les Q/R ──
// (pas de données sensibles, accessible sans authentification)
router.get("/", async (req, res) => {
  try {
    const faqs = await Faq.find().sort({ theme: 1, ordre: 1 });
    res.json({ ok: true, faqs });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Créer une Q/R (admin) ──
router.post("/", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { theme, question, reponse, ordre } = req.body;
    if (!question || !reponse)
      return res.status(400).json({ ok: false, message: "Question et réponse requises" });
    const faq = new Faq({ theme: theme || "Général", question, reponse, ordre: ordre || 0 });
    await faq.save();
    res.status(201).json({ ok: true, faq });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Modifier une Q/R (admin) ──
router.put("/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const faq = await Faq.findById(req.params.id);
    if (!faq) return res.status(404).json({ ok: false, message: "Entrée introuvable" });
    const { theme, question, reponse, ordre } = req.body;
    if (theme !== undefined)    faq.theme    = theme;
    if (question !== undefined) faq.question = question;
    if (reponse !== undefined)  faq.reponse  = reponse;
    if (ordre !== undefined)    faq.ordre    = ordre;
    faq.updatedAt = Date.now();
    await faq.save();
    res.json({ ok: true, faq });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Supprimer une Q/R (admin) ──
router.delete("/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    await Faq.deleteOne({ _id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ── Pré-remplissage initial (admin) : crée la base de départ si elle est vide ──
router.post("/seed", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const count = await Faq.countDocuments();
    if (count > 0)
      return res.json({ ok: true, message: "La base contient déjà des entrées, aucun ajout.", count });

    const base = [
      ["Connexion & licence", "Comment me connecter ?", "Ouvrez l'application et saisissez votre code de licence. Votre nom d'entreprise se pré-remplit automatiquement. La connexion reste active 30 jours."],
      ["Connexion & licence", "Que se passe-t-il après 30 jours ?", "L'application affiche « Session expirée » et vous ramène à l'écran de connexion, où votre code est déjà pré-rempli : il suffit de revalider. Aucune donnée n'est perdue."],
      ["Connexion & licence", "Quelle est la différence entre licence Standard et Plus ?", "La Standard donne accès à Entreprise, Salariés, Prévisionnel, Planning et Rapports. La Plus ajoute la saisie mobile par les ouvriers et le Planning réalisé."],
      ["Salariés", "Comment ajouter un salarié ?", "Page Salariés : remplissez prénom, nom et heures par jour, puis validez. Un PIN à 4 chiffres lui est attribué pour la saisie mobile."],
      ["Salariés", "Comment gérer un salarié qui alterne une semaine sur deux ?", "Cochez « alterne deux semaines (A/B) », saisissez les deux grilles, puis ajoutez une bascule (date + semaine de départ). L'alternance se poursuit automatiquement."],
      ["Salariés", "À quoi sert le PIN ?", "C'est le code personnel à 4 chiffres que le salarié utilise pour s'identifier sur la saisie mobile. Il est masqué par défaut ; le bouton œil l'affiche."],
      ["Prévisionnel", "Comment saisir un chantier au devis ?", "Page Prévisionnel : dans la colonne du mois voulu, tapez le nom du chantier et ses heures prévues. La touche Entrée passe au champ suivant."],
      ["Prévisionnel", "Comment reporter un chantier sur un autre mois ?", "Utilisez la fonction « Reporter un chantier » : choisissez le mois de destination ; un compteur indique les heures restantes."],
      ["Planning", "Comment saisir les heures dans le planning ?", "Tapez le nom du chantier dans la case et choisissez le nombre d'heures dans le menu. Le bouton ✕ efface le chantier."],
      ["Planning", "Que signifient les cases en orange ou rouge ?", "Orange : le total planifié dépasse 90 % des heures prévues au devis. Rouge : il dépasse les heures prévues."],
      ["Planning", "Que signifie le badge A ou B à côté d'un salarié ?", "Il indique quelle semaine type (A ou B) s'applique pour ce salarié alternant cette semaine-là."],
      ["Planning", "Comment imprimer le planning ?", "Bouton Imprimer : choisissez la semaine et les colonnes à inclure. Seul le nom de l'entreprise apparaît en en-tête."],
      ["Saisie mobile", "Comment l'ouvrier accède-t-il à la saisie mobile ?", "Il scanne le QR code (page Saisie mobile) ou saisit le code accès mobile, puis s'identifie avec son PIN."],
      ["Saisie mobile", "Comment déclarer une pause ?", "Sur la carte du chantier, le bouton Pause permet d'indiquer une durée (par tranches de 15 min), déduite du temps de travail."],
      ["Rapports & données", "Comment exporter mes données ?", "Page Rapports : boutons Excel ou PDF. Sélectionnez les mois / salariés / chantiers voulus avant d'exporter."],
      ["Rapports & données", "Vais-je garder mes données si j'arrête la licence ?", "Oui : vous pouvez exporter à tout moment, et un export complet vous est fourni sur demande à la résiliation."],
    ];
    const docs = base.map((b, i) => ({ theme: b[0], question: b[1], reponse: b[2], ordre: i }));
    await Faq.insertMany(docs);
    res.json({ ok: true, message: "Base de départ créée", count: docs.length });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
