import express from "express";
import Bev from "../models/bev.js";
import { verifyToken } from "../middleware/authMiddleware.js";

const router = express.Router();

// GET /api/bev/:mois/:salarieId → { ok, retenues, valide }
router.get("/:mois/:salarieId", verifyToken, async (req, res) => {
  try {
    const clientId = (req.user.clientId || "").toUpperCase();
    const { mois, salarieId } = req.params;
    const tous = await Bev.find({ mois, salarieId: String(salarieId) });
    const doc  = tous.find(d => (d.clientId || "").toUpperCase() === clientId);
    if (!doc) return res.json({ ok: true, retenues: {}, valide: false, reporte: 0 });
    res.json({ ok: true, retenues: doc.retenues || {}, valide: !!doc.valide, reporte: doc.reporte || 0, evenements: doc.evenements || {} });
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
      doc.updatedAt = new Date();
      doc.markModified("retenues");
      await doc.save();
    } else {
      await Bev.create({ clientId, salarieId: String(salarieId), mois, retenues, valide, reporte, evenements });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

export default router;
