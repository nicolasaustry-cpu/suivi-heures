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
      ["Entreprise", "Où se trouve le code accès mobile ?", "Page Entreprise, section Informations : le « Code accès mobile » est celui que vos ouvriers saisissent pour ouvrir la saisie mobile."],
      ["Entreprise", "Comment régler le délai d'alerte avant un RDV ?", "Page Entreprise, section Notifications de RDV : indiquez le nombre de minutes dans « Prévenir avant » puis Enregistrer. C'est le délai par défaut d'alerte du salarié avant un rendez-vous."],
      ["Entreprise", "Comment régler ou figer les seuils des jauges ?", "Page Entreprise, Paramétrage des jauges : ajustez Seuil rouge, Seuil orange et Zone verte. Cochez « Figer les seuils » puis Enregistrer pour les verrouiller."],
      ["Salariés", "Comment ajouter un salarié ?", "Page Salariés : remplissez prénom, nom et heures par jour, puis validez. Un PIN à 4 chiffres lui est attribué pour la saisie mobile."],
      ["Salariés", "Comment modifier les heures d'un salarié ?", "Page Salariés : ajustez la grille d'heures par jour du salarié concerné, puis validez."],
      ["Salariés", "À quoi sert le PIN ?", "C'est le code personnel à 4 chiffres que le salarié utilise pour s'identifier sur la saisie mobile. Il est masqué par défaut ; le bouton œil l'affiche."],
      ["Salariés", "Comment afficher le PIN d'un salarié ?", "Sur la page Salariés, utilisez le bouton œil à côté du PIN pour le rendre visible."],
      ["Salariés", "Comment gérer un salarié qui alterne une semaine sur deux ?", "Cochez « alterne deux semaines (A/B) », saisissez les deux grilles, puis ajoutez une bascule (date + semaine de départ). L'alternance se poursuit automatiquement."],
      ["Salariés", "Que signifie le badge A ou B à côté d'un salarié ?", "Il indique quelle semaine type (A ou B) s'applique à ce salarié alternant pour la semaine affichée."],
      ["Salariés", "Comment retirer un salarié qui quitte l'entreprise ?", "Depuis la page Salariés, supprimez ou désactivez le salarié concerné."],
      ["Salariés", "Comment enregistrer les PIN modifiés ?", "Page Salariés : après avoir modifié un ou plusieurs PIN dans la liste, cliquez « 💾 Enregistrer les PIN »."],
      ["Salariés", "Comment n'afficher que les salariés présents ?", "Page Salariés : le bouton « ✅ Salariés présents » bascule entre présents uniquement et tous (y compris les salariés sortis)."],
      ["Salariés", "À quoi sert la case « accès Planning équipe » ?", "Elle autorise ce salarié (par exemple un conducteur de travaux) à consulter la Vue équipe sur mobile et sur PC."],
      ["Prévisionnel", "À quoi sert le Prévisionnel ?", "À planifier vos chantiers au devis sur l'année, mois par mois, pour anticiper la charge de travail."],
      ["Prévisionnel", "Comment saisir un chantier au devis ?", "Page Prévisionnel : dans la colonne du mois voulu, tapez le nom du chantier et ses heures prévues. La touche Entrée passe au champ suivant."],
      ["Prévisionnel", "Comment corriger les heures prévues d'un chantier ?", "Modifiez directement la valeur dans la case du mois concerné ; le total se recalcule."],
      ["Prévisionnel", "Comment reporter un chantier sur un autre mois ?", "Utilisez la fonction « Reporter un chantier » : choisissez le mois de destination ; un compteur indique les heures restantes."],
      ["Prévisionnel", "Comment comparer prévu, planifié et réalisé sur un chantier ?", "Survolez une ligne de chantier : une infobulle compare, pour le mois et en total, le Prévu (devis), le Planifié (heures posées au planning) et le Réalisé (heures pointées, licence Plus), avec jauges et pourcentages."],
      ["Prévisionnel", "Que signifient les couleurs de l'infobulle du Prévisionnel ?", "Vert sous 90 % du prévu, orange au-delà de 90 %, rouge au-delà de 100 %."],
      ["Prévisionnel", "Pourquoi une ligne de chantier est-elle affichée en vert ?", "Elle est verte uniquement sur le mois où ce chantier est effectivement planifié dans le Planning prévu, pas sur toute l'année."],
      ["Prévisionnel", "À quoi sert le bouton « 📊 Gantt » ?", "Il ouvre le diagramme de Gantt prévisionnel : une ligne par chantier, les mois en colonnes, une bascule Planifié/Réalisé, un total par chantier et une ligne Charge/heures vendables, avec impression en paysage. Écran conçu pour l'ordinateur."],
      ["Planning", "Comment saisir les heures dans le planning ?", "Tapez le nom du chantier dans la case et choisissez le nombre d'heures dans le menu. Le bouton ✕ efface le chantier."],
      ["Planning", "Comment effacer un chantier d'une case ?", "Cliquez sur le bouton ✕ de la case concernée."],
      ["Planning", "Que signifient les cases en orange ou rouge ?", "Orange : le total planifié dépasse 90 % des heures prévues au devis. Rouge : il dépasse les heures prévues."],
      ["Planning", "Comment changer de semaine ?", "Naviguez d'une semaine à l'autre avec les flèches de navigation."],
      ["Planning", "Comment imprimer le planning ?", "Bouton Imprimer : choisissez la semaine et les colonnes à inclure. Seul le nom de l'entreprise apparaît en en-tête."],
      ["Planning", "Le salarié voit-il automatiquement son planning ?", "Oui. Les chantiers que vous planifiez apparaissent dans sa saisie mobile et dans son planning."],
      ["Planning", "Comment affecter un chantier sur plusieurs jours et plusieurs salariés d'un coup ?", "Bouton « 🏗️ Chantier long », à gauche du filtre salariés. Choisissez le chantier, une période (Du/Au) et les salariés, cliquez Analyser puis Valider. Le chantier remplit le temps contractuel restant de chaque jour, à partir d'aujourd'hui, sans écraser un chantier existant."],
      ["Planning", "Que se passe-t-il si un jour a déjà un chantier lors d'un Chantier long ?", "Le jour est signalé en conflit. Vous choisissez : Compléter le temps restant, Déplacer l'existant vers une autre date (le chantier long prend alors le jour libéré), ou Ignorer ce jour."],
      ["Planning", "Ma note de chantier apparaît sur tous les jours, comment la limiter à un seul jour ?", "Dans la fenêtre de note, cochez « Note pour cette journée uniquement » : elle ne s'affiche et ne s'imprime que sur ce jour, sans se dupliquer, tout en restant en mémoire. Décochée, la note reste générale et s'applique à tous les jours du chantier."],
      ["Planning", "Comment supprimer une note de chantier ?", "Ouvrez la note et cliquez « 🗑 Supprimer ». Case décochée : la note générale est retirée de tous les jours. Case cochée : seule la note de cette journée est supprimée. Le bouton n'apparaît que s'il y a une note à supprimer, et une confirmation est demandée."],
      ["Planning", "Comment renseigner une heure de rendez-vous sur un chantier ?", "Bouton 🕐 sur le pavé du chantier : indiquez l'heure de RDV ; le salarié en est alerté. Le bouton devient bleu une fois renseigné."],
      ["Planning", "Comment déclarer un jour férié, un événement familial ou une visite médicale ?", "Sur la journée concernée, choisissez le motif d'événement correspondant. Ces événements remontent automatiquement dans le BEV."],
      ["Planning", "Qu'est-ce que le Temps Non Affecté (TNA) ?", "C'est le temps contractuel d'une journée qui n'est couvert par aucun chantier ; il est calculé et affiché automatiquement en pavé « ⟲ Temps Non Affecté »."],
      ["Vue équipe", "À quoi sert la Vue équipe ?", "À visualiser le planning consolidé de toute votre équipe sur une période, en un seul écran."],
      ["Vue équipe", "La Vue équipe est-elle disponible en licence Standard ?", "Oui, en mode planning seul : le planning de l'équipe, sans le détail du réalisé ni la réorganisation des chantiers."],
      ["Vue équipe", "Qu'apporte la licence Plus sur la Vue équipe ?", "La vue complète, avec le suivi du réalisé (heures effectuées) en plus du planning."],
      ["Vue équipe", "Puis-je ajouter un chantier directement depuis la Vue équipe ?", "Oui : bouton « ➕ chantier » — renseignez le nom du chantier, une heure de RDV optionnelle et un délai d'alerte, puis validez."],
      ["Vue équipe", "Comment ajouter une note ou une photo depuis la Vue équipe ?", "Bouton « 📝 Ajouter une note / photos » : note écrite ou dictée, et photo."],
      ["Vue équipe", "Comment recharger la Vue équipe avec les dernières données ?", "Le bouton « ↻ Rafraîchir » recharge les données depuis le serveur."],
      ["Planning réalisé", "Où voir les heures réellement saisies par les ouvriers ?", "Page Planning réalisé (licence Plus) : elle regroupe les saisies remontées depuis la saisie mobile."],
      ["Planning réalisé", "Comment comparer le prévu et le réalisé ?", "Le Planning réalisé et les Rapports confrontent les heures planifiées aux heures réellement saisies par les ouvriers."],
      ["Planning réalisé", "Que signifie un réalisé affiché en rouge ?", "Que le temps réellement effectué dépasse le temps planifié sur ce chantier."],
      ["Planning réalisé", "Comment corriger une heure pointée par un ouvrier ?", "Page Planning réalisé : bouton ✏ sur la saisie du chantier, puis modifiez l'heure d'arrivée, de départ, la pause ou le déplacement, et Enregistrer. Le bouton 🗑 supprime la saisie."],
      ["Planning réalisé", "Comment masquer certains chantiers du réalisé ?", "Utilisez le filtre « Exclure les chantiers contenant » avec un mot-clé, en plus des filtres Mois, Salariés et Chantiers."],
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
      ["Rapports & données", "Comment voir les heures regroupées par chantier ?", "Page Rapports : le bouton « Situation par chantier » regroupe les heures planifiées et réalisées par chantier."],
      ["Rapports & données", "Comment filtrer un rapport sur une période précise ?", "Utilisez le filtre Période (bouton Effacer pour le réinitialiser), en plus des filtres Mois, Salarié(s) et Chantier(s). Un mot-clé « Exclure » permet d'écarter des chantiers."],
      ["Rapports & données", "Comment trier un rapport ?", "Cliquez sur l'en-tête d'une colonne pour trier les lignes."],
      ["Notes", "Comment retrouver une note de chantier précise ?", "Page Notes : utilisez les filtres Mois, Chantier, Intervenant et le champ Recherche. Les photos jointes s'agrandissent au clic."],
      ["Notes", "Comment exporter ou imprimer les notes ?", "Page Notes : bouton « 📊 Export Excel » pour un fichier, « 🖨 Imprimer » pour une version papier. « ↻ Rafraîchir » recharge les dernières notes."],
      ["Notes", "Comment modifier ou supprimer une note ?", "Sur la ligne concernée : ✏️ pour modifier (puis ✔️ enregistrer ou ✖️ annuler), 🗑 pour supprimer."],
      ["Sécurité & confidentialité", "Mes données sont-elles sécurisées ?", "Oui : échanges chiffrés (HTTPS), accès protégé et données cloisonnées par entreprise. Voir la politique de confidentialité sur suivi-heures.volitis.net/confidentialite.html."],
      ["Sécurité & confidentialité", "Qui peut accéder aux données de mon entreprise ?", "Uniquement vous et les personnes autorisées de votre entreprise. Les données ne sont ni vendues ni partagées à des fins commerciales."],
      ["Sécurité & confidentialité", "Y a-t-il de la publicité dans l'application ?", "Non. Suiv'Heures ne contient aucune publicité et n'utilise aucun traceur publicitaire."],
      ["Sécurité & confidentialité", "Comment demander la suppression de données ?", "Écrivez à contact@volitis.net avec l'objet « Demande de suppression de données »."],
      ["BEV", "À quoi sert le BEV ?", "Le Bordereau d'Éléments Variables prépare la paie de chaque salarié, mois par mois : heures, base, écarts et indemnités."],
      ["BEV", "Comment se calcule la « Nouvelle Base » ?", "C'est le temps contractuel du jour moins le temps d'événement (absences, congés, etc.) : Nouvelle Base = Contrat − Temps Évt."],
      ["BEV", "Que se passe-t-il pour un client qui ne pointe pas (planning seul) ?", "Si aucune heure n'est réalisée sur le mois, le BEV bascule automatiquement : « Écart Réalisé/Base » devient « Écart Planifié/Base » (Planifié − Base) et la colonne Réalisé est masquée. La bascule est automatique et se fait mois par mois."],
      ["BEV", "Comment ajuster un écart dans le BEV ?", "La colonne « Écart retenu » est modifiable jour par jour ; seuls vos ajustements manuels sont enregistrés. Un bouton permet de réinitialiser toute la colonne à sa valeur par défaut."],
      ["BEV", "Comment reporter un écart d'heures d'un mois sur l'autre ?", "Utilisez l'encart en bas du BEV : l'écart reporté est déduit du total des heures payées du mois."],
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
