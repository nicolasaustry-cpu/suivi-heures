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

// ── (Ré)initialisation de la base d'aide (admin) ──
// Remplace TOUT le contenu : vide la base puis recharge les questions ci-dessous.
router.post("/seed", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const base = [
      ["Connexion & licence", "Comment me connecter ?", "Ouvrez l'application et saisissez votre code de licence. Votre nom d'entreprise se pré-remplit automatiquement. La connexion reste active 30 jours."],
      ["Connexion & licence", "Que se passe-t-il après 30 jours ?", "L'application affiche « Session expirée » et vous ramène à l'écran de connexion, où votre code est déjà pré-rempli : il suffit de revalider. Aucune donnée n'est perdue."],
      ["Connexion & licence", "Mon nom d'entreprise ne se pré-remplit pas.", "Vérifiez le code de licence saisi (une faute suffit à ne pas le reconnaître). Si le problème persiste, contactez Volitis à contact@volitis.net."],
      ["Connexion & licence", "Puis-je utiliser l'application sur plusieurs ordinateurs ?", "Oui, avec le même code de licence. La session de 30 jours est indépendante sur chaque appareil."],
      ["Connexion & licence", "Quelle est la différence entre licence Standard et Plus ?", "La Standard donne accès à Entreprise, Salariés, Prévisionnel, Planning et Rapports. La Plus ajoute la saisie mobile par les ouvriers et le Planning réalisé."],
      ["Connexion & licence", "Comment passer de Standard à Plus ?", "Contactez Volitis à contact@volitis.net, ou consultez suivi-heures.volitis.net pour les offres et tarifs."],
      ["Salariés", "Comment ajouter un salarié ?", "Page Salariés : remplissez prénom, nom et heures par jour, puis validez. Un PIN à 4 chiffres lui est attribué pour la saisie mobile."],
      ["Salariés", "Comment modifier les heures d'un salarié ?", "Page Salariés : ajustez la grille d'heures par jour du salarié concerné, puis validez."],
      ["Salariés", "À quoi sert le PIN ?", "C'est le code personnel à 4 chiffres que le salarié utilise pour s'identifier sur la saisie mobile. Il est masqué par défaut ; le bouton œil l'affiche."],
      ["Salariés", "Comment afficher le PIN d'un salarié ?", "Sur la page Salariés, utilisez le bouton œil à côté du PIN pour le rendre visible."],
      ["Salariés", "Comment gérer un salarié qui alterne une semaine sur deux ?", "Cochez « alterne deux semaines (A/B) », saisissez les deux grilles, puis ajoutez une bascule (date + semaine de départ). L'alternance se poursuit automatiquement."],
      ["Salariés", "Que signifie le badge A ou B à côté d'un salarié ?", "Il indique quelle semaine type (A ou B) s'applique à ce salarié alternant pour la semaine affichée."],
      ["Salariés", "Comment retirer un salarié qui quitte l'entreprise ?", "Depuis la page Salariés, supprimez ou désactivez le salarié concerné."],
      ["Prévisionnel", "À quoi sert le Prévisionnel ?", "À planifier vos chantiers au devis sur l'année, mois par mois, pour anticiper la charge de travail."],
      ["Prévisionnel", "Comment saisir un chantier au devis ?", "Page Prévisionnel : dans la colonne du mois voulu, tapez le nom du chantier et ses heures prévues. La touche Entrée passe au champ suivant."],
      ["Prévisionnel", "Comment corriger les heures prévues d'un chantier ?", "Modifiez directement la valeur dans la case du mois concerné ; le total se recalcule."],
      ["Prévisionnel", "Comment reporter un chantier sur un autre mois ?", "Utilisez la fonction « Reporter un chantier » : choisissez le mois de destination ; un compteur indique les heures restantes."],
      ["Planning", "Comment saisir les heures dans le planning ?", "Tapez le nom du chantier dans la case et choisissez le nombre d'heures dans le menu. Le bouton ✕ efface le chantier."],
      ["Planning", "Comment effacer un chantier d'une case ?", "Cliquez sur le bouton ✕ de la case concernée."],
      ["Planning", "Que signifient les cases en orange ou rouge ?", "Orange : le total planifié dépasse 90 % des heures prévues au devis. Rouge : il dépasse les heures prévues."],
      ["Planning", "Comment changer de semaine ?", "Naviguez d'une semaine à l'autre avec les flèches de navigation."],
      ["Planning", "Comment imprimer le planning ?", "Bouton Imprimer : choisissez la semaine et les colonnes à inclure. Seul le nom de l'entreprise apparaît en en-tête."],
      ["Planning", "Le salarié voit-il automatiquement son planning ?", "Oui. Les chantiers que vous planifiez apparaissent dans sa saisie mobile et dans son planning."],
      ["Vue équipe", "À quoi sert la Vue équipe ?", "À visualiser le planning consolidé de toute votre équipe sur une période, en un seul écran."],
      ["Vue équipe", "La Vue équipe est-elle disponible en licence Standard ?", "Oui, en mode planning seul : le planning de l'équipe, sans le détail du réalisé ni la réorganisation des chantiers."],
      ["Vue équipe", "Qu'apporte la licence Plus sur la Vue équipe ?", "La vue complète, avec le suivi du réalisé (heures effectuées) en plus du planning."],
      ["Planning réalisé", "Où voir les heures réellement saisies par les ouvriers ?", "Page Planning réalisé (licence Plus) : elle regroupe les saisies remontées depuis la saisie mobile."],
      ["Planning réalisé", "Comment comparer le prévu et le réalisé ?", "Le Planning réalisé et les Rapports confrontent les heures planifiées aux heures réellement saisies par les ouvriers."],
      ["Planning réalisé", "Que signifie un réalisé affiché en rouge ?", "Que le temps réellement effectué dépasse le temps planifié sur ce chantier."],
      ["Saisie mobile", "Comment l'ouvrier accède-t-il à la saisie mobile ?", "Il scanne le QR code (page Saisie mobile) ou saisit le code accès mobile, puis s'identifie avec son nom et son PIN."],
      ["Saisie mobile", "Où trouver le QR code à imprimer ?", "Sur la page Saisie mobile affichée en mode PC : le QR code figure à droite. Imprimez-le et affichez-le ou distribuez-le aux ouvriers."],
      ["Saisie mobile", "Qu'est-ce que le code accès mobile ?", "Un code qui permet à l'ouvrier d'ouvrir la saisie mobile sans scanner le QR, avant de s'identifier avec son PIN."],
      ["Saisie mobile", "Comment l'ouvrier saisit-il sa journée ?", "Pour chaque chantier prévu, il renseigne arrivée, pause et départ, ajuste le déplacement si besoin, puis envoie le chantier."],
      ["Saisie mobile", "Comment déclarer une pause ?", "Sur la carte du chantier, le bouton Pause permet d'indiquer une durée (par tranches de 15 min), déduite du temps de travail."],
      ["Saisie mobile", "Comment saisir le temps de trajet entre deux chantiers ?", "Dans le bloc « Déplacement depuis chantier précédent », l'ouvrier ajuste les minutes avec les boutons moins et plus."],
      ["Saisie mobile", "L'ouvrier peut-il ajouter une note ou une photo ?", "Oui, une note (écrite ou dictée) et des photos peuvent être jointes à chaque chantier."],
      ["Saisie mobile", "Comment l'ouvrier envoie-t-il ses heures ?", "Avec le bouton « Envoyer ce chantier ». Le chantier passe alors en « Enregistré »."],
      ["Saisie mobile", "L'ouvrier doit-il installer une application ?", "Ce n'est pas obligatoire : il accède via le QR code ou le lien. Il peut aussi l'ajouter à l'écran d'accueil, ou l'installer depuis Google Play."],
      ["Saisie mobile", "Un ouvrier a oublié son PIN, que faire ?", "Réaffichez ou modifiez son PIN depuis la page Salariés (bouton œil), puis communiquez-le-lui."],
      ["Rapports & données", "Comment exporter mes données ?", "Page Rapports : boutons Excel ou PDF. Sélectionnez les mois / salariés / chantiers voulus avant d'exporter."],
      ["Rapports & données", "Comment lire les jauges des rapports ?", "Les jauges synthétisent l'activité ; leurs couleurs dépendent des seuils que vous avez paramétrés."],
      ["Rapports & données", "Comment régler les seuils des jauges ?", "Dans le paramétrage des jauges, ajustez les seuils qui déterminent les couleurs de vos indicateurs."],
      ["Rapports & données", "Mes données sont-elles sauvegardées ?", "Oui, elles sont hébergées avec des sauvegardes automatiques."],
      ["Rapports & données", "Vais-je garder mes données si j'arrête la licence ?", "Oui : vous pouvez exporter à tout moment, et un export complet vous est fourni sur demande à la résiliation."],
      ["Sécurité & confidentialité", "Mes données sont-elles sécurisées ?", "Oui : échanges chiffrés (HTTPS), accès protégé et données cloisonnées par entreprise. Voir la politique de confidentialité sur suivi-heures.volitis.net/confidentialite.html."],
      ["Sécurité & confidentialité", "Qui peut accéder aux données de mon entreprise ?", "Uniquement vous et les personnes autorisées de votre entreprise. Les données ne sont ni vendues ni partagées à des fins commerciales."],
      ["Sécurité & confidentialité", "Y a-t-il de la publicité dans l'application ?", "Non. Suiv'Heures ne contient aucune publicité et n'utilise aucun traceur publicitaire."],
      ["Sécurité & confidentialité", "Comment demander la suppression de données ?", "Écrivez à contact@volitis.net avec l'objet « Demande de suppression de données »."],
      ["Dépannage", "Après une modification, je ne vois pas le changement.", "Forcez le rechargement de la page avec Ctrl + Maj + R."],
      ["Dépannage", "Une page de gestion s'affiche mal sur téléphone.", "Les pages patron sont conçues pour l'ordinateur. Sur téléphone, utilisez la saisie mobile ; pour gérer, préférez un PC."],
      ["Dépannage", "Un ouvrier n'arrive pas à se connecter sur mobile.", "Vérifiez qu'il a bien un PIN dans la page Salariés et qu'il utilise le bon QR code ou code accès mobile (celui de votre entreprise)."],
      ["Dépannage", "Le total d'heures d'un salarié semble incohérent.", "Vérifiez ses saisies (arrivée, pause, départ) dans le Planning réalisé, ainsi que ses heures de référence dans la page Salariés."],
      ["Dépannage", "Comment contacter le support ?", "Pour toute question, écrivez à contact@volitis.net."]
    ];
    const docs = base.map((b, i) => ({ theme: b[0], question: b[1], reponse: b[2], ordre: i }));
    await Faq.deleteMany({});
    const result = await Faq.insertMany(docs);
    res.json({ ok: true, message: `Base d'aide réinitialisée (${result.length} questions)`, count: result.length });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
