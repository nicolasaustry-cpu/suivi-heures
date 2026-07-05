import mongoose from "mongoose";
import crypto from "crypto";

/*
 * Demande de signature électronique simple (SES) d'un contrat de licence.
 *
 * Principe : au moment où le gérant crée la demande, les conditions du
 * contrat sont FIGÉES dans ce document (elles ne peuvent plus changer).
 * Le client ouvre un lien unique (/signer/<token>), lit le contrat, coche
 * « Lu et approuvé », tape son nom et signe. Le serveur enregistre alors
 * l'empreinte du document + le dossier de preuve (date, IP, navigateur).
 * L'ensemble constitue une signature électronique simple, valable pour ce
 * type de contrat B2B (art. 1366-1367 du Code civil).
 */
const signatureSchema = new mongoose.Schema({

  // Jeton aléatoire présent dans l'URL de signature : /signer/<token>
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: () => crypto.randomBytes(24).toString("hex")
  },

  statut: {
    type: String,
    enum: ["en_attente", "signe", "refuse", "expire"],
    default: "en_attente"
  },

  codeClient: { type: String, default: "", uppercase: true, trim: true }, // rattachement Suiv'Heures (facultatif)

  // ── Conditions figées du contrat (snapshot au moment de la création) ──
  contrat: {
    raisonSociale:        { type: String, default: "" },
    formeJuridique:       { type: String, default: "" },
    capital:              { type: String, default: "" },
    siren:                { type: String, default: "" },
    greffe:               { type: String, default: "" },
    adresseSiege:         { type: String, default: "" },
    representantCivilite: { type: String, default: "Monsieur" },
    representantNom:      { type: String, default: "" },
    representantQualite:  { type: String, default: "" },
    formule:              { type: String, enum: ["Standard", "Plus"], default: "Standard" },
    effectif:             { type: Number, default: 0 },
    forfaitHT:            { type: Number, default: 0 },
    forfaitTTC:           { type: Number, default: 0 },
    fraisOuvertureHT:     { type: Number, default: 0 },
    fraisOuvertureTTC:    { type: Number, default: 0 },
    villeSignature:       { type: String, default: "" },
    dateContrat:          { type: String, default: "" }  // AAAA-MM-JJ tel que saisi
  },

  // Signataire attendu (pré-rempli à la création de la demande)
  signataire: {
    nom:   { type: String, default: "" },
    email: { type: String, default: "" }
  },

  // Empreinte SHA-256 du document exact affiché puis signé (garantie d'intégrité)
  documentHash: { type: String, default: "" },

  // ── Dossier de preuve, constitué au moment de la signature ──
  preuve: {
    nomTape:      { type: String,  default: "" },   // nom saisi par le signataire
    consentement: { type: Boolean, default: false },// case « Lu et approuvé » cochée
    signeLe:      { type: Date,    default: null },  // horodatage serveur (fait foi)
    ip:           { type: String,  default: "" },   // adresse IP du signataire
    userAgent:    { type: String,  default: "" }    // navigateur / appareil
  },

  creePar:  { type: String, default: "" },                                      // gérant/admin ayant créé la demande
  creeLe:   { type: Date,   default: Date.now },
  expireLe: { type: Date,   default: () => new Date(Date.now() + 30 * 24 * 3600 * 1000) } // 30 jours par défaut
});

export default mongoose.model("Signature", signatureSchema);
