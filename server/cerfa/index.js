// ─────────────────────────────────────────────────────────────
// cerfa/index.js — Catalogue des CERFA joignables à un bon d'intervention
// ─────────────────────────────────────────────────────────────
// Chaque CERFA = un module de définition (sections de saisie PC, saisie
// mobile, pré-remplissage, signatures) et, selon le cas :
//   - MODE "formulaire" (défaut) : PDF officiel remplissable (champs AcroForm) ;
//   - MODE "superpose"           : PDF officiel SANS champs : le texte est écrit
//                                  aux positions indiquées (champ.pos) ;
//   - MODE "fiche"               : pas de PDF officiel utilisable (ex. Consuel,
//                                  formulaire payant) : une fiche de préparation
//                                  est générée avec les mêmes rubriques.
// Ajouter un CERFA : écrire son module (et déposer son PDF), l'inscrire ci-dessous.
// ─────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import * as c15497 from "./cerfa15497.js";
import * as c13408 from "./cerfa13408.js";
import * as c16026 from "./cerfa16026.js";
import { CONSUEL } from "./cerfaConsuel.js";
import { demarche } from "./demarches.js";

const DOSSIER = path.dirname(fileURLToPath(import.meta.url));
export const MODELES = Object.fromEntries(
  [c15497, ...CONSUEL, c16026, c13408].map(m => [m.CODE, m])
);

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

/* Texte compatible avec la police standard Helvetica (WinAnsi). */
function propre(t) {
  return String(t ?? "")
    .replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/Ω/g, "ohms").replace(/[“”«»]/g, '"').replace(/\t/g, " ")
    .replace(/[^\n\x20-\x7E -ÿŒœ€’–—…•]/g, "");
}
/* Valeur d'un champ « en peigne » (une case par caractère) : sans séparateurs. */
const pourPeigne = (val, n) => String(val).replace(/[\s\/.\-]/g, "").slice(0, n);

/* PDF rempli + signatures apposées. Renvoie un Buffer. */
export async function remplirCerfa(code, valeurs, signatures = {}) {
  const m = MODELES[code];
  if (!m) throw new Error("CERFA inconnu : " + code);
  const v = m.completer ? m.completer(valeurs || {}) : (valeurs || {});
  if (m.MODE === "fiche") return genererFiche(m, v, signatures);

  const doc = await PDFDocument.load(fs.readFileSync(path.join(DOSSIER, m.FICHIER)));
  const police = await doc.embedFont(StandardFonts.Helvetica);

  if (m.MODE === "superpose") ecrireSuperpose(doc, police, m, v);
  else {
    const form = doc.getForm();
    // COCHE_VECTORIELLE : coche redessinée par pdf-lib (trait), quand la coche
    // d'origine du PDF utilise une police de symboles mal affichée par certains lecteurs.
    const coche = cb => { if (m.COCHE_VECTORIELLE) try { cb.updateAppearances(); } catch (e) { /* aspect d'origine conservé */ } };
    for (const s of m.SECTIONS) for (const c of s.champs) {
      const val = v[c.pdf];
      try {
        if (c.type === "case") { const cb = form.getCheckBox(c.pdf); val ? cb.check() : cb.uncheck(); coche(cb); }
        else if (c.type === "radio") {
          if (!val) continue;
          if (c.cases) {        // options = cases à cocher distinctes dans le PDF
            for (const [opt, nomCase] of Object.entries(c.cases)) {
              const cb = form.getCheckBox(nomCase); opt === String(val) ? cb.check() : cb.uncheck(); coche(cb);
            }
          } else { const rg = form.getRadioGroup(c.pdf); rg.select(String(val)); }
        }
        else if (val != null && String(val).trim()) {
          const tf = form.getTextField(c.pdf);
          let texte = propre(val);
          if (c.peigne) { texte = pourPeigne(texte, c.peigne); tf.setMaxLength(c.peigne); tf.enableCombing(); }
          if (c.type === "zone") {
            tf.enableMultiline();
            const lignes = texte.split("\n").length + Math.floor(texte.length / 95);
            if (lignes > 4) tf.setFontSize(lignes > 7 ? 6 : 7);   // texte long : police réduite pour tenir dans le cadre
          }
          tf.setText(texte);
        }
      } catch (e) { /* champ absent de cette version du PDF : ignoré */ }
    }
    // Champs masqués du formulaire (ex. nom et n° du CERFA en en-tête) : vidés,
    // sinon l'aplatissement les dessinerait par-dessus le logo.
    for (const f of form.getFields()) {
      const masque = f.acroField.getWidgets().every(w => (w.getFlags?.() ?? 0) & 2);
      if (masque && typeof f.setText === "function") { try { f.setText(""); } catch (e) { /* ignoré */ } }
    }
    form.updateFieldAppearances(police);
    form.flatten();
  }

  // Signatures du bon apposées dans les cadres prévus (page indiquée, 1re page par défaut)
  for (const [qui, zone] of Object.entries(m.SIGNATURES || {})) {
    const img = signatures[qui];
    if (!estImage(img)) continue;
    try {
      const page = doc.getPage(zone.page || 0);
      const octets = Buffer.from(img.split(",")[1], "base64");
      const image = /png/i.test(img.slice(0, 20)) ? await doc.embedPng(octets) : await doc.embedJpg(octets);
      const k = Math.min(zone.w / image.width, zone.h / image.height);
      page.drawImage(image, { x: zone.x, y: zone.y, width: image.width * k, height: image.height * k });
    } catch (e) { /* image illisible : ignorée */ }
  }
  return Buffer.from(await doc.save());
}

/* ── MODE "superpose" : texte écrit aux positions du formulaire officiel ──
   pos = { page, x, y, w?, taille?, lignes? } avec y mesuré depuis le HAUT de
   la page (comme dans un relevé de positions), ligne de base du texte.
   Case : pos = position de la case (coin gauche, centre vertical) → « X ».
   Radio : posOptions = { valeur: pos } → « X » dans la case de l'option choisie. */
function ecrireSuperpose(doc, police, m, v) {
  const croix = (p) => {
    const page = doc.getPage(p.page || 0), H = page.getHeight();
    page.drawText("X", { x: p.x + 0.6, y: H - p.y - 2.6, size: 7, font: police, color: rgb(0, 0, 0.55) });
  };
  for (const s of m.SECTIONS) for (const c of s.champs) {
    const val = v[c.pdf];
    if (c.type === "case") { if (val && c.pos) croix(c.pos); continue; }
    if (c.type === "radio") { if (val && c.posOptions && c.posOptions[val]) croix(c.posOptions[val]); continue; }
    if (!c.pos || val == null || !String(val).trim()) continue;
    const p = c.pos, page = doc.getPage(p.page || 0), H = page.getHeight();
    let taille = p.taille || 8;
    const texte = propre(val);
    const largeur = p.w || 200;
    const maxLignes = p.lignes || 1;
    let lignes = couper(texte, police, taille, largeur);
    while (lignes.length > maxLignes && taille > 5) { taille -= 0.5; lignes = couper(texte, police, taille, largeur); }
    lignes = lignes.slice(0, maxLignes);
    if (maxLignes === 1) {       // une seule ligne : réduire jusqu'à tenir dans la largeur
      while (police.widthOfTextAtSize(lignes[0] || "", taille) > largeur && taille > 4.5) taille -= 0.5;
    }
    lignes.forEach((l, i) => page.drawText(l, { x: p.x, y: H - p.y - i * (taille + 1.5), size: taille, font: police, color: rgb(0, 0, 0.55) }));
  }
}

/* Découpe un texte en lignes tenant dans la largeur donnée. */
function couper(texte, police, taille, largeur) {
  const out = [];
  for (const para of String(texte).split("\n")) {
    let ligne = "";
    for (const mot of para.split(/\s+/)) {
      if (!mot) continue;
      const essai = ligne ? ligne + " " + mot : mot;
      if (police.widthOfTextAtSize(essai, taille) <= largeur) { ligne = essai; continue; }
      if (ligne) out.push(ligne);
      ligne = mot;
      while (police.widthOfTextAtSize(ligne, taille) > largeur && ligne.length > 1) {   // mot trop long
        let k = ligne.length - 1;
        while (k > 1 && police.widthOfTextAtSize(ligne.slice(0, k), taille) > largeur) k--;
        out.push(ligne.slice(0, k)); ligne = ligne.slice(k);
      }
    }
    out.push(ligne);
  }
  return out;
}

/* ── MODE "fiche" : fiche de préparation générée (A4) ── */
async function genererFiche(m, v, signatures) {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const gras = await doc.embedFont(StandardFonts.HelveticaBold);
  const L = 595.28, H = 841.89, M = 36, LARG = L - 2 * M;
  const [cr, cg, cb] = m.COULEUR || [0.2, 0.3, 0.5];
  const accent = rgb(cr, cg, cb);
  const encre = rgb(0.1, 0.12, 0.16), gris = rgb(0.4, 0.43, 0.48), bleu = rgb(0, 0, 0.55);
  let page, y;

  const nouvellePage = () => {
    page = doc.addPage([L, H]);
    page.drawRectangle({ x: 0, y: H - 10, width: L, height: 10, color: accent });
    y = H - 30;
  };
  const place = h => { if (y - h < 40) { nouvellePage(); } };
  const texte = (t, x, yy, taille, police = helv, couleur = encre) => page.drawText(propre(t), { x, y: yy, size: taille, font: police, color: couleur });
  const caseX = (x, yy, coche) => {
    page.drawRectangle({ x, y: yy - 1, width: 7, height: 7, borderColor: gris, borderWidth: 0.7 });
    if (coche) texte("X", x + 1.2, yy, 7, gras, bleu);
  };

  // En-tête
  nouvellePage();
  texte(m.NUMERO ? "CERFA n° " + m.NUMERO : "CERFA", M, y, 9, gras, gris);
  y -= 18;
  for (const l of couper(m.INTITULE || m.TITRE, gras, 14, LARG)) { texte(l, M, y, 14, gras); y -= 17; }
  y -= 2;
  texte("FICHE DE PRÉPARATION — à reporter sur l'attestation officielle", M, y, 9, gras, accent);
  y -= 14;
  if (m.AVERTISSEMENT) {
    const lignes = couper(propre(m.AVERTISSEMENT), helv, 7.5, LARG - 16);
    const h = lignes.length * 9.5 + 10;
    page.drawRectangle({ x: M, y: y - h + 8, width: LARG, height: h, color: rgb(1, 0.98, 0.92), borderColor: rgb(0.99, 0.9, 0.54), borderWidth: 0.7 });
    lignes.forEach((l, i) => texte(l, M + 8, y - i * 9.5, 7.5, helv, rgb(0.47, 0.21, 0.06)));
    y -= h + 4;
  }

  for (const s of m.SECTIONS) {
    if (s.horsFiche) continue;
    place(40);
    y -= 6;
    page.drawRectangle({ x: M, y: y - 4, width: LARG, height: 15, color: accent });
    texte(s.titre, M + 6, y, 9.5, gras, rgb(1, 1, 1));
    y -= 20;
    let xFlux = M + 4;                 // cases à cocher posées en ligne
    const finFlux = () => { if (xFlux > M + 4) { y -= 13; xFlux = M + 4; } };
    for (const c of s.champs) {
      const val = v[c.pdf];
      if (c.type === "case") {
        const w = 12 + helv.widthOfTextAtSize(propre(c.label), 8) + 14;
        if (xFlux + w > M + LARG) finFlux();
        place(14);
        caseX(xFlux, y, !!val);
        texte(c.label, xFlux + 11, y, 8);
        xFlux += w;
        continue;
      }
      finFlux();
      if (c.type === "radio") {
        place(14);
        texte(c.label + " :", M + 4, y, 8, gras);
        let x = M + 10 + gras.widthOfTextAtSize(propre(c.label + " :"), 8);
        for (const [cle, lib] of c.options) {
          const w = 12 + helv.widthOfTextAtSize(propre(lib), 8) + 12;
          if (x + w > M + LARG) { y -= 12; x = M + 20; place(14); }
          caseX(x, y, String(val) === cle);
          texte(lib, x + 11, y, 8);
          x += w;
        }
        y -= 14;
        continue;
      }
      // texte / zone : libellé puis valeur soulignée
      const lib = propre(c.label) + " :";
      const wLib = gras.widthOfTextAtSize(lib, 8);
      const valeur = val == null ? "" : String(val);
      const enLigne = c.type !== "zone" && wLib < LARG * 0.45;
      if (enLigne) {
        const lignes = couper(propre(valeur), helv, 8.5, LARG - wLib - 14);
        place(12 * Math.max(1, lignes.length) + 2);
        texte(lib, M + 4, y, 8, gras);
        page.drawLine({ start: { x: M + wLib + 8, y: y - 2.5 }, end: { x: M + LARG, y: y - 2.5 }, thickness: 0.4, color: rgb(0.8, 0.82, 0.86) });
        lignes.forEach((l, i) => { if (i) place(12); texte(l, M + wLib + 10, y - i * 11, 8.5, helv, bleu); });
        y -= 11 * Math.max(1, lignes.length) + 3;
      } else {
        const lignes = valeur.trim() ? couper(propre(valeur), helv, 8.5, LARG - 12) : ["", ""];
        place(12 + lignes.length * 11);
        texte(lib, M + 4, y, 8, gras);
        y -= 12;
        lignes.forEach(l => {
          place(12);
          page.drawLine({ start: { x: M + 4, y: y - 2.5 }, end: { x: M + LARG, y: y - 2.5 }, thickness: 0.4, color: rgb(0.8, 0.82, 0.86) });
          texte(l, M + 6, y, 8.5, helv, bleu);
          y -= 11;
        });
        y -= 3;
      }
    }
    finFlux();
  }

  // Signatures
  if (m.SIGNATURES) {
    place(95);
    y -= 8;
    const cadres = Object.entries(m.SIGNATURES);
    const w = (LARG - 12 * (cadres.length - 1)) / cadres.length;
    cadres.forEach(([qui, z], i) => {
      const x = M + i * (w + 12);
      page.drawRectangle({ x, y: y - 72, width: w, height: 80, borderColor: gris, borderWidth: 0.6 });
      texte(z.titre || qui, x + 6, y - 2, 8, gras);
      const nom = z.champNom ? v[z.champNom] : "";
      if (nom) texte(nom, x + 6, y - 13, 8, helv, bleu);
      z._x = x; z._w = w;
    });
    for (const [qui, z] of cadres) {
      const img = signatures[qui];
      if (!estImage(img)) continue;
      try {
        const octets = Buffer.from(img.split(",")[1], "base64");
        const image = /png/i.test(img.slice(0, 20)) ? await doc.embedPng(octets) : await doc.embedJpg(octets);
        const k = Math.min((z._w - 16) / image.width, 50 / image.height);
        page.drawImage(image, { x: z._x + 8, y: y - 68, width: image.width * k, height: image.height * k });
      } catch (e) { /* image illisible : ignorée */ }
    }
    y -= 84;
  }

  // Pied de page
  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(propre(`${m.TITRE} — fiche générée par Suiv'Heures — ${i + 1}/${pages.length}`),
    { x: M, y: 20, size: 6.5, font: helv, color: gris }));
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
