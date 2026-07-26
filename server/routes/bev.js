import express from "express";
import Bev from "../models/bev.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

/* GET /api/bev/annee/:annee → { ok, annee, reports: { "<salarieId>": { "2026-01": 0, … } } }
   Renvoie, en UN seul aller-retour, les heures reportées de tous les salariés
   pour tous les mois d'une année. Sert au tableau de bord, qui a besoin du
   solde compteur de l'entreprise : sans elle il faudrait un appel par salarié
   et par mois.
   ⚠ CETTE ROUTE DOIT RESTER DÉCLARÉE AVANT « /:mois/:salarieId » : Express
   teste les routes dans l'ordre, et « /annee/2026 » correspondrait sinon à
   « /:mois/:salarieId » avec mois="annee", renvoyant un résultat vide. */
router.get("/annee/:annee", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const annee = String(req.params.annee || "").trim();
    if (!/^\d{4}$/.test(annee))
      return res.status(400).json({ ok: false, message: "année invalide" });

    const docs = await Bev.find({ mois: { $regex: "^" + annee + "-" } });
    const reports = {};
    for (const d of docs) {
      // Même cloisonnement par client que la route mensuelle : comparaison
      // en majuscules, la casse n'étant pas garantie en base.
      if ((d.clientId || "").toUpperCase() !== clientId) continue;
      const sid = String(d.salarieId);
      if (!reports[sid]) reports[sid] = {};
      reports[sid][d.mois] = Number(d.reporte) || 0;
    }
    res.json({ ok: true, annee, reports });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// GET /api/bev/:mois/:salarieId → { ok, retenues, valide }
router.get("/:mois/:salarieId", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const { mois, salarieId } = req.params;
    const tous = await Bev.find({ mois, salarieId: String(salarieId) });
    const doc  = tous.find(d => (d.clientId || "").toUpperCase() === clientId);
    if (!doc) return res.json({ ok: true, retenues: {}, valide: false, reporte: 0 });
    res.json({ ok: true, retenues: doc.retenues || {}, valide: !!doc.valide, reporte: doc.reporte || 0, evenements: doc.evenements || {}, indemnites: doc.indemnites || {}, tranches: doc.tranches || {} });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// POST /api/bev → { salarieId, mois, retenues, valide }
router.post("/", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const { salarieId, mois } = req.body;
    if (!salarieId || !mois)
      return res.status(400).json({ ok: false, message: "salarieId ou mois manquant" });

    const brut   = (req.body.retenues && typeof req.body.retenues === "object") ? req.body.retenues : {};
    const valide = !!req.body.valide;
    const reporte = Number(req.body.reporte) || 0;
    const EVTS = ['CP','École','Maladie','Abs Aut.','Ev. Famil.','RTT','AT'];
    const evbrut = (req.body.evenements && typeof req.body.evenements === 'object') ? req.body.evenements : {};
    const evenements = {};
    for (const k of Object.keys(evbrut)) { if (EVTS.includes(evbrut[k])) evenements[k] = evbrut[k]; }
    const indbrut = (req.body.indemnites && typeof req.body.indemnites === 'object') ? req.body.indemnites : {};
    const indemnites = { trajet: !!indbrut.trajet, transport: !!indbrut.transport, repas: !!indbrut.repas };
    const TRANCHES = ['IA','IB','II','III','IV','V','VI','VII'];
    const trbrut = (req.body.tranches && typeof req.body.tranches === 'object') ? req.body.tranches : {};
    const tranches = {};
    for (const k of Object.keys(trbrut)) { if (TRANCHES.includes(trbrut[k])) tranches[k] = trbrut[k]; }
    const retenues = {};
    for (const k of Object.keys(brut)) {
      const v = Number(brut[k]);
      if (!isNaN(v)) retenues[k] = v;
    }

    const tous = await Bev.find({ mois, salarieId: String(salarieId) });
    let doc = tous.find(d => (d.clientId || "").toUpperCase() === clientId);
    if (doc) {
      doc.retenues  = retenues;
      doc.valide    = valide;
      doc.reporte   = reporte;
      doc.evenements = evenements;
      doc.markModified('evenements');
      doc.indemnites = indemnites;
      doc.markModified('indemnites');
      doc.tranches = tranches;
      doc.markModified('tranches');
      doc.updatedAt = new Date();
      doc.markModified("retenues");
      await doc.save();
    } else {
      await Bev.create({ clientId, salarieId: String(salarieId), mois, retenues, valide, reporte, evenements, indemnites, tranches });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
