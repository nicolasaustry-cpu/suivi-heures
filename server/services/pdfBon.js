// ─────────────────────────────────────────────────────────────
// services/pdfBon.js — PDF d'un bon d'intervention rempli
// ─────────────────────────────────────────────────────────────
// Construit le PDF (A4) d'un bon à partir de :
//   - bon        : document BonIntervention (réponses, chantier, date, technicien…)
//   - champs     : champs du masque (copie figée dans le bon, ou masque actuel)
//   - entreprise : { nom }  (en-tête)
//   - coord      : { adresse, ville, mobile, fixe } du chantier (peut être vide)
// Renvoie un Buffer. Le même PDF sert au téléchargement et à l'envoi par mail.
// ─────────────────────────────────────────────────────────────

import PDFDocument from "pdfkit";

const NAVY  = "#0f3a8a";
const AMBRE = "#f59e0b";
const GRIS  = "#64748b";
const TEXTE = "#1e293b";
const BORD  = "#cbd5e1";

const M = 42;               // marge
const LARG = 595.28 - 2 * M; // largeur utile A4

function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s || "");
}

function estImage(v) {
  return typeof v === "string" && /^data:image\/(png|jpe?g);base64,/i.test(v);
}

function imageBuffer(dataUrl) {
  return Buffer.from(dataUrl.split(",")[1] || "", "base64");
}

/* Texte affichable d'une réponse (hors photos et signatures). */
export function valeurTexte(champ, v) {
  if (v === undefined || v === null || v === "") return "—";
  switch (champ.type) {
    case "case":            return v === true || v === "true" ? "Oui" : "Non";
    case "cases_multiples": return Array.isArray(v) && v.length ? v.join(", ") : "—";
    case "datetime":        return champ.auto === "date" || /^\d{4}-\d{2}-\d{2}$/.test(v) ? fmtDate(v) : String(v);
    default:                return String(v);
  }
}

export function genererPdfBon({ bon, champs, entreprise, coord }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true,
      info: { Title: `Bon d'intervention ${bon.numero || ""}`.trim(), Author: entreprise?.nom || "Suiv'Heures" } });
    const morceaux = [];
    doc.on("data", c => morceaux.push(c));
    doc.on("end", () => resolve(Buffer.concat(morceaux)));
    doc.on("error", reject);

    const rep = bon.reponses || {};
    const basPage = () => doc.page.height - M - 20;
    const place = h => { if (doc.y + h > basPage()) doc.addPage(); };

    // ── En-tête ──
    doc.rect(0, 0, doc.page.width, 78).fill(NAVY);
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(17)
       .text(entreprise?.nom || "", M, 22, { width: LARG * 0.55 });
    doc.font("Helvetica-Bold").fontSize(15)
       .text("BON D'INTERVENTION", M, 20, { width: LARG, align: "right" });
    doc.font("Helvetica").fontSize(10)
       .text(`${bon.numero ? "N° " + bon.numero + "  ·  " : ""}${bon.masqueNom || ""}`, M, 42, { width: LARG, align: "right" });
    doc.rect(0, 78, doc.page.width, 4).fill(AMBRE);

    // ── Bloc client / intervention ──
    const yBloc = 100;
    const demi = (LARG - 14) / 2;
    const cadre = (x, titre, lignes) => {
      doc.fillColor(GRIS).font("Helvetica-Bold").fontSize(8).text(titre.toUpperCase(), x + 10, yBloc + 8, { width: demi - 20 });
      let y = yBloc + 22;
      for (const [txt, gras] of lignes) {
        if (!txt) continue;
        doc.fillColor(TEXTE).font(gras ? "Helvetica-Bold" : "Helvetica").fontSize(gras ? 11 : 10)
           .text(txt, x + 10, y, { width: demi - 20 });
        y = doc.y + 2;
      }
      return y;
    };
    const tel = [coord?.mobile, coord?.fixe].filter(Boolean).join("  ·  ");
    const yG = cadre(M, "Client / chantier", [
      [bon.chantier, true],
      [coord?.adresse, false],
      [coord?.ville, false],
      [tel ? "Tél. " + tel : "", false]
    ]);
    const creeLe = bon.creeLe ? new Date(bon.creeLe) : null;
    const yD = cadre(M + demi + 14, "Intervention", [
      [`Date : ${fmtDate(bon.dateIntervention) || "—"}`, true],
      [`Technicien : ${bon.salarieNom || "—"}`, false],
      [bon.equipement?.libelle ? `Équipement : ${bon.equipement.libelle}` : "", false],
      [creeLe ? `Bon établi le ${creeLe.toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })} à ${creeLe.toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" })}` : "", false]
    ]);
    const hBloc = Math.max(yG, yD) - yBloc + 8;
    doc.lineWidth(0.8).strokeColor(BORD)
       .roundedRect(M, yBloc, demi, hBloc, 5).stroke()
       .roundedRect(M + demi + 14, yBloc, demi, hBloc, 5).stroke();
    doc.y = yBloc + hBloc + 18;

    // ── Champs du masque (dans l'ordre), signatures regroupées en fin ──
    const signatures = [];
    for (const c of champs || []) {
      if (c.type === "signature") { signatures.push(c); continue; }
      const v = rep[c.id];

      if (c.type === "photo") {
        const photos = (Array.isArray(v) ? v : []).filter(estImage);
        place(30);
        doc.fillColor(GRIS).font("Helvetica-Bold").fontSize(9).text(c.libelle, M, doc.y, { width: LARG });
        doc.moveDown(0.3);
        if (!photos.length) {
          doc.fillColor(TEXTE).font("Helvetica").fontSize(10).text("—", M, doc.y);
          doc.moveDown(0.6);
          continue;
        }
        const w = (LARG - 2 * 10) / 3, h = w * 0.75;
        for (let i = 0; i < photos.length; i += 3) {       // 3 photos par rangée
          place(h + 8);
          const y0 = doc.y;
          photos.slice(i, i + 3).forEach((p, j) => {
            try { doc.image(imageBuffer(p), M + j * (w + 10), y0, { fit: [w, h], align: "center", valign: "center" }); }
            catch (e) { /* image illisible : ignorée */ }
          });
          doc.y = y0 + h + 8;
        }
        doc.y += 4;
        continue;
      }

      const txt = valeurTexte(c, v);
      doc.font("Helvetica").fontSize(10);
      const hTxt = doc.heightOfString(txt, { width: LARG - 175 });
      place(Math.max(hTxt, 12) + 10);
      const y = doc.y;
      doc.fillColor(GRIS).font("Helvetica-Bold").fontSize(9).text(c.libelle, M, y, { width: 165 });
      const yLib = doc.y;
      doc.fillColor(TEXTE).font("Helvetica").fontSize(10).text(txt, M + 175, y, { width: LARG - 175 });
      doc.y = Math.max(doc.y, yLib) + 5;
      doc.moveTo(M, doc.y).lineTo(M + LARG, doc.y).lineWidth(0.4).strokeColor("#e2e8f0").stroke();
      doc.y += 6;
    }

    // ── Signatures côte à côte ──
    if (signatures.length) {
      const hSig = 95;
      const w = demi;
      doc.y += 8;
      let yLigne = doc.y;
      signatures.forEach((c, i) => {
        const col = i % 2;
        if (col === 0) {                                   // nouvelle rangée de 2 signatures
          if (i > 0) doc.y = yLigne + 26 + hSig + 14;
          place(hSig + 40);
          yLigne = doc.y;
        }
        const x = M + col * (w + 14);
        const nom = c.signataire === "client" ? (rep[c.id + "__nom"] || "") : (bon.salarieNom || "");
        doc.fillColor(GRIS).font("Helvetica-Bold").fontSize(9).text(c.libelle, x, yLigne, { width: w });
        if (nom) doc.fillColor(TEXTE).font("Helvetica").fontSize(9).text(nom, x, yLigne + 12, { width: w });
        doc.lineWidth(0.8).strokeColor(BORD).roundedRect(x, yLigne + 26, w, hSig, 4).stroke();
        const img = rep[c.id];
        if (estImage(img)) {
          try { doc.image(imageBuffer(img), x + 6, yLigne + 30, { fit: [w - 12, hSig - 8], align: "center", valign: "center" }); }
          catch (e) { /* ignorée */ }
        }
      });
      doc.y = yLigne + 26 + hSig + 10;
    }

    // ── Pied de page sur chaque page ──
    const n = doc.bufferedPageRange().count;
    for (let i = 0; i < n; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;            // écrire dans la marge sans créer de page
      const y = doc.page.height - M + 6;
      doc.fillColor(GRIS).font("Helvetica").fontSize(8)
         .text(`${entreprise?.nom || ""}${bon.numero ? "  ·  Bon n° " + bon.numero : ""}`, M, y, { width: LARG / 2, lineBreak: false })
         .text(`Page ${i + 1}/${n}`, M + LARG / 2, y, { width: LARG / 2, align: "right", lineBreak: false });
    }
    doc.end();
  });
}
