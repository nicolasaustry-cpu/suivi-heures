// ─────────────────────────────────────────────────────────────
// cerfa/outils.js — Aides communes aux modules CERFA
// ─────────────────────────────────────────────────────────────

export const T = (pdf, label, extra = {}) => ({ pdf, label, type: "texte", ...extra });
export const Z = (pdf, label, extra = {}) => ({ pdf, label, type: "zone", ...extra });
export const C = (pdf, label, extra = {}) => ({ pdf, label, type: "case", ...extra });
export const R = (pdf, label, options, extra = {}) => ({ pdf, label, type: "radio", options, ...extra });
export const N = (pdf, label, extra = {}) => ({ pdf, label, type: "nombre", ...extra });   // mobile uniquement

/* « 2026-11-08… » → « 08/11/2026 » */
export const jjmmaaaa = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ""); return m ? `${m[3]}/${m[2]}/${m[1]}` : ""; };

/* Nom du client sans le n° de devis Henrri (« MARY GERARD 26-10-3 » → « MARY GERARD »). */
export const nomClient = chantier => String(chantier || "").replace(/\s+\d{2}-\d{2}-\d+\s*$/, "").trim();

/* Personne morale ? (SARL, SCI, mairie…) */
export const estSociete = nom => /\b(SARL|SAS|SASU|SCI|EURL|SA|SNC|SCP|SCM|GAEC|EARL|ASSOCIATION|MAIRIE|COMMUNE|SYNDIC|COPROPRI|SOCIETE|SOCIÉTÉ|ENTREPRISE|CABINET|OFFICE|HABITAT|ETS|STE)\b/i.test(nom || "");

/* Code postal et ville d'après les coordonnées du chantier
   (« 72000 Le Mans » dans la ville ou à la fin de l'adresse). */
export function cpVille(coord = {}) {
  const ville = String(coord.ville || "").trim();
  const adresse = String(coord.adresse || "").trim();
  let m = /^(\d{5})\s+(.+)$/.exec(ville);
  if (m) return { cp: m[1], ville: m[2], rue: adresse };
  m = /^(.*?)[,\s]+(\d{5})\s+([^,\d][^,]*)$/.exec(adresse);
  if (m) return { cp: m[2], ville: ville || m[3].trim(), rue: m[1].trim() };
  return { cp: "", ville, rue: adresse };
}

/* Bloc identité de l'entreprise (nom, adresse, SIRET, téléphone). */
export function blocEntreprise(e = {}) {
  return [
    e.nom,
    e.adresse,
    [e.codePostal, e.ville].filter(Boolean).join(" "),
    e.siret ? "SIRET " + e.siret : "",
    e.telephone ? "Tél. " + e.telephone : ""
  ].filter(x => String(x || "").trim()).join("\n");
}

/* Nom du signataire client saisi sur le bon (champ signature « client »). */
export function signataireClient(bon, champs = []) {
  const rep = bon.reponses || {};
  const c = champs.find(x => x.type === "signature" && x.signataire === "client");
  return c ? String(rep[c.id + "__nom"] || "").trim() : "";
}

/* Texte du rapport / des observations du bon (premier champ texte qui s'y rapporte). */
export function rapportDuBon(bon, champs = []) {
  const rep = bon.reponses || {};
  const c = champs.find(x => x.type === "texte" && /rapport|observ|compte.?rendu|travaux/i.test(x.libelle || ""));
  return c && rep[c.id] ? String(rep[c.id]).replace(/\s*\n+\s*/g, " ").trim() : "";
}

/* Libellé de l'équipement du bon. */
export function libelleEq(eq = {}) {
  return [[eq.type, eq.marque].filter(Boolean).join(" "), eq.modele].filter(Boolean).join(" ");
}
