// ─────────────────────────────────────────────────────────────
// cerfa/index.js — Catalogue des CERFA joignables à un bon d'intervention
// ─────────────────────────────────────────────────────────────
// Chaque CERFA = un PDF officiel remplissable (dans ce dossier) + un module de
// définition (sections de saisie, pré-remplissage, zones de signature).
// Ajouter un CERFA : déposer son PDF, écrire son module, l'inscrire ci-dessous.
// ─────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as c15497 from "./cerfa15497.js";
import { demarche } from "./demarches.js";

const DOSSIER = path.dirname(fileURLToPath(import.meta.url));
export const MODELES = { [c15497.CODE]: c15497 };

export { demarche };

export function listeModeles() {
  return Object.values(MODELES).map(m => ({ code: m.CODE, titre: m.TITRE, demarche: demarche(m.CODE) }));
}

/* Ne garde que les champs connus du modèle (texte ≤ 2000 car., cases booléennes). */
export function assainirValeurs(code, brut) {
  const m = MODELES[code]; if (!m) return null;
  const out = {};
  for (const s of m.SECTIONS) for (const c of s.champs) {
    const v = brut ? brut[c.pdf] : undefined;
    if (v === undefined || v === null) continue;
    if (c.type === "case") out[c.pdf] = v === true || v === "true";
    else if (c.type === "radio") { if (c.options.some(o => o[0] === String(v))) out[c.pdf] = String(v); }
    else out[c.pdf] = String(v).slice(0, 2000);
  }
  return out;
}

const estImage = v => typeof v === "string" && /^data:image\/(png|jpe?g);base64,/i.test(v);

/* PDF officiel rempli (formulaire aplati) + signatures apposées. Renvoie un Buffer. */
export async function remplirCerfa(code, valeurs, signatures = {}) {
  const m = MODELES[code];
  if (!m) throw new Error("CERFA inconnu : " + code);
  const doc = await PDFDocument.load(fs.readFileSync(path.join(DOSSIER, m.FICHIER)));
  const form = doc.getForm();
  const v = m.completer ? m.completer(valeurs || {}) : (valeurs || {});
  for (const s of m.SECTIONS) for (const c of s.champs) {
    const val = v[c.pdf];
    try {
      if (c.type === "case") { const cb = form.getCheckBox(c.pdf); val ? cb.check() : cb.uncheck(); }
      else if (c.type === "radio") { if (val) form.getRadioGroup(c.pdf).select(String(val)); }
      else if (val != null && String(val).trim()) {
        const tf = form.getTextField(c.pdf);
        const texte = String(val).replace(/[^\n\x20-\x7E -ÿŒœ€’–—…°]/g, "");
        if (c.type === "zone") {
          tf.enableMultiline();
          const lignes = texte.split("\n").length + Math.floor(texte.length / 95);
          if (lignes > 4) tf.setFontSize(lignes > 7 ? 6 : 7);   // texte long : police réduite pour tenir dans le cadre
        }
        tf.setText(texte);
      }
    } catch (e) { /* champ absent de cette version du PDF : ignoré */ }
  }
  const police = await doc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(police);
  form.flatten();

  // Signatures du bon apposées dans les cadres « Date et signature »
  const page = doc.getPage(0);
  for (const [qui, zone] of Object.entries(m.SIGNATURES || {})) {
    const img = signatures[qui];
    if (!estImage(img)) continue;
    try {
      const octets = Buffer.from(img.split(",")[1], "base64");
      const image = /png/i.test(img.slice(0, 20)) ? await doc.embedPng(octets) : await doc.embedJpg(octets);
      const k = Math.min(zone.w / image.width, zone.h / image.height);
      page.drawImage(image, { x: zone.x, y: zone.y, width: image.width * k, height: image.height * k });
    } catch (e) { /* image illisible : ignorée */ }
  }
  return Buffer.from(await doc.save());
}

/* Ajoute des PDF (Buffers) à la suite d'un PDF principal. */
export async function assemblerPdf(principal, annexes) {
  if (!annexes || !annexes.length) return principal;
  const doc = await PDFDocument.load(principal);
  for (const a of annexes) {
    const src = await PDFDocument.load(a);
    const pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach(p => doc.addPage(p));
  }
  return Buffer.from(await doc.save());
}
