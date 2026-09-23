// Service d'envoi d'e-mails via l'API HTTPS de Resend.
// Railway bloque le SMTP sortant : on envoie donc par l'API REST de Resend (port 443),
// avec un simple fetch (intégré à Node 18+, aucune librairie à installer).
//   RESEND_API_KEY = clé API Resend (commence par "re_")
//   MAIL_FROM      = adresse d'expédition, sur un domaine vérifié dans Resend
//                    (ex. "contact@volitis.net")
//   APP_URL        = URL de l'application (ex. "https://suivi-heures.volitis.net")

function _fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  } catch { return ""; }
}

// ── E-mail de confirmation d'auto-inscription à l'essai ──
export async function envoyerMailEssai({ email, nomClient, code, dateExpiration }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY non configurée : e-mail de confirmation non envoyé.");
    return false;
  }

  const from   = process.env.MAIL_FROM || process.env.SMTP_FROM || "contact@volitis.net";
  const appUrl = process.env.APP_URL || "https://suivi-heures.volitis.net";
  const fin    = _fmtDate(dateExpiration);
  const nom    = (nomClient || "").trim();

  const text =
    `Bienvenue sur Suiv'Heures !\n\n` +
    `Votre espace d'essai est créé.\n` +
    `Votre code d'accès : ${code}\n` +
    (fin ? `Essai gratuit valable jusqu'au ${fin}.\n` : "") +
    `\nSur ORDINATEUR, rendez-vous sur ${appUrl} et connectez-vous avec ce code pour configurer votre espace : salaries, chantiers, planning.\n` +
    `Le code mobile de vos salaries (pour pointer depuis leur telephone) se cree ensuite, directement dans l'outil, une fois votre espace configure.\n` +
    `\nConnectez-vous sur ordinateur ici : ${appUrl}\n` +
    `Conservez bien ce code : il vous permettra de vous reconnecter.\n\n` +
    `L'équipe Volitis`;

  const html = `<!DOCTYPE html><html lang="fr"><body style="margin:0;padding:0;background:#e9edf3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e9edf3;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;box-shadow:0 6px 24px rgba(15,23,42,.12);">
    <tr><td style="background:#0f3a8a;padding:20px 28px;color:#ffffff;font-size:20px;font-weight:bold;">Suiv'Heures</td></tr>
    <tr><td style="padding:28px 28px 30px;">
      <div style="font-size:22px;font-weight:bold;color:#0f3a8a;">Votre espace d'essai est créé&nbsp;!</div>
      <div style="font-size:16px;color:#475569;line-height:1.55;margin-top:10px;">
        Bonjour${nom ? " " + nom : ""}, vous disposez de <strong>30 jours d'essai gratuit</strong>, avec toutes les fonctionnalités.
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">
        <tr><td style="background:#f1f5f9;border:1px dashed #94a3b8;border-radius:10px;padding:14px 26px;text-align:center;">
          <div style="font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Votre code d'accès</div>
          <div style="font-size:26px;font-weight:bold;color:#0f3a8a;letter-spacing:1px;">${code}</div>
        </td></tr>
      </table>
      ${fin ? `<div style="font-size:14px;color:#64748b;margin-bottom:22px;">Essai gratuit valable jusqu'au <strong>${fin}</strong>.</div>` : `<div style="margin-bottom:22px;"></div>`}
      <div style="font-size:14px;color:#475569;line-height:1.55;background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:12px 14px;margin:0 0 20px;">
        &#128187; <strong>Sur ordinateur</strong>, rendez-vous sur suivi-heures.volitis.net et connectez-vous avec ce code pour configurer votre espace&nbsp;: salari&eacute;s, chantiers, planning.<br><br>
        &#128241; Le <strong>code mobile de vos salari&eacute;s</strong> (pour pointer depuis leur t&eacute;l&eacute;phone) se cr&eacute;e ensuite, directement dans l'outil, une fois votre espace configur&eacute;.
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
        <tr><td align="center" bgcolor="#f59e0b" style="border-radius:8px;">
          <a href="${appUrl}/?pc=1" target="_blank" style="display:inline-block;padding:14px 32px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#412402;text-decoration:none;border-radius:8px;">Acc&eacute;der sur ordinateur&nbsp;&rarr;</a>
        </td></tr>
      </table>
      <div style="font-size:13px;color:#94a3b8;">Conservez bien ce code : il vous permettra de vous reconnecter.</div>
    </td></tr>
    <tr><td style="background:#f8fafc;padding:16px 28px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;">
      Suiv'Heures — par Volitis · <a href="${appUrl}" style="color:#0f3a8a;text-decoration:none;">suivi-heures.volitis.net</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: `Suiv'Heures <${from}>`,
      to: [email],
      subject: "Bienvenue sur Suiv'Heures — votre essai de 30 jours",
      text,
      html
    })
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`Resend ${resp.status} : ${detail}`);
  }
  return true;
}

// ════════════════ COMMUNICATION CLIENTS (envoi groupé depuis l'admin) ════════════════

function _esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Transforme le texte saisi dans l'admin en blocs :
//   ligne vide           → nouveau paragraphe
//   ligne « - » ou « • » → puce
// Renvoie [{ type:'p', lignes:[…] } | { type:'ul', items:[…] }]
function _blocs(message) {
  const blocs = [];
  let cur = null;
  String(message || "").replace(/\r/g, "").split("\n").forEach(brut => {
    const l = brut.trim();
    if (!l) { cur = null; return; }
    const puce = l.match(/^[-•*]\s+(.*)$/);
    if (puce) {
      if (!cur || cur.type !== "ul") { cur = { type: "ul", items: [] }; blocs.push(cur); }
      cur.items.push(puce[1]);
    } else {
      if (!cur || cur.type !== "p") { cur = { type: "p", lignes: [] }; blocs.push(cur); }
      cur.lignes.push(l);
    }
  });
  return blocs;
}

// **gras** → <strong>
function _gras(s) { return _esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); }

/* Construit le mail (html + texte) d'une communication.
   {entreprise} dans l'objet ou le message est remplacé par le nom du client.
   L'image (si fournie) est placée sous le premier paragraphe (après « Bonjour, »). */
export function construireMailCommunication({ sujet, message, nomClient, imageUrl, boutonTexte, boutonUrl }) {
  const appUrl = process.env.APP_URL || "https://suivi-heures.volitis.net";
  const nom = (nomClient || "").trim();
  const perso = (s) => String(s || "").replace(/\{entreprise\}/gi, nom || "");
  const sujetFinal = perso(sujet).trim();
  const blocs = _blocs(perso(message));

  // L'image se place sous le premier vrai paragraphe : si le message commence
  // par une formule d'appel courte (« Bonjour, »), on la saute.
  const salut = blocs[0] && blocs[0].type === "p" && blocs[0].lignes.length === 1 && blocs[0].lignes[0].length <= 30;
  const idxImage = salut && blocs.length > 1 ? 1 : 0;

  let corps = "";
  blocs.forEach((b, i) => {
    if (b.type === "p") {
      corps += `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">${b.lignes.map(_gras).join("<br>")}</p>`;
    } else {
      corps += `<ul style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.6;color:#334155;">${b.items.map(it => `<li style="margin:0 0 4px;">${_gras(it)}</li>`).join("")}</ul>`;
    }
    if (i === idxImage && imageUrl) {
      corps += `<div style="margin:6px 0 18px;"><img src="${_esc(imageUrl)}" alt="" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:8px;"></div>`;
    }
  });
  if (!blocs.length && imageUrl) {
    corps += `<div style="margin:0 0 18px;"><img src="${_esc(imageUrl)}" alt="" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;border-radius:8px;"></div>`;
  }

  const lienBouton = (boutonUrl || "").trim() || appUrl;
  const bouton = (boutonTexte || "").trim()
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 6px;">
        <tr><td align="center" bgcolor="#f59e0b" style="border-radius:8px;">
          <a href="${_esc(lienBouton)}" target="_blank" style="display:inline-block;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#412402;text-decoration:none;border-radius:8px;">${_esc(boutonTexte.trim())}&nbsp;&rarr;</a>
        </td></tr>
      </table>`
    : "";

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${_esc(sujetFinal)}</title></head><body style="margin:0;padding:0;background:#e9edf3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e9edf3;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;box-shadow:0 6px 24px rgba(15,23,42,.12);">
    <tr><td style="background:#0f3a8a;padding:20px 28px;color:#ffffff;font-size:20px;font-weight:bold;">Suiv'Heures</td></tr>
    <tr><td style="padding:26px 28px 28px;">
      <div style="font-size:21px;font-weight:bold;color:#0f3a8a;margin:0 0 16px;">${_esc(sujetFinal)}</div>
      ${corps}
      ${bouton}
    </td></tr>
    <tr><td style="background:#f8fafc;padding:16px 28px;font-size:12px;line-height:1.5;color:#94a3b8;border-top:1px solid #e2e8f0;">
      Vous recevez ce message en tant qu'utilisateur de Suiv'Heures. Une question&nbsp;? Répondez simplement à ce mail.<br>
      Suiv'Heures — par Volitis · <a href="${_esc(appUrl)}" style="color:#0f3a8a;text-decoration:none;">suivi-heures.volitis.net</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;

  const text =
    sujetFinal + "\n\n" +
    blocs.map(b => b.type === "p" ? b.lignes.join("\n") : b.items.map(it => "- " + it).join("\n")).join("\n\n").replace(/\*\*(.+?)\*\*/g, "$1") +
    ((boutonTexte || "").trim() ? `\n\n${boutonTexte.trim()} : ${lienBouton}` : "") +
    `\n\n--\nSuiv'Heures — par Volitis · ${appUrl}`;

  return { sujet: sujetFinal, html, text };
}

const _pause = (ms) => new Promise(r => setTimeout(r, ms));

/* Envoie une liste de mails individuels (chaque destinataire reçoit SON mail,
   aucune adresse n'est visible des autres) via l'API « batch » de Resend :
   jusqu'à 100 mails par appel, avec une pause entre deux appels pour rester
   sous la limite de débit de Resend.
   mails : [{ email, sujet, html, text }]
   Renvoie un tableau de même longueur : [{ ok:true } | { ok:false, erreur }].
   Ne lève pas d'exception pour un échec d'envoi : l'échec est reporté par mail. */
export async function envoyerMailsCommunication(mails) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return mails.map(() => ({ ok: false, erreur: "RESEND_API_KEY non configurée sur le serveur" }));
  }
  const from    = process.env.MAIL_FROM || process.env.SMTP_FROM || "contact@volitis.net";
  const replyTo = process.env.MAIL_REPLY_TO || from;

  const resultats = [];
  for (let i = 0; i < mails.length; i += 100) {
    const lot = mails.slice(i, i + 100);
    try {
      const resp = await fetch("https://api.resend.com/emails/batch", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(lot.map(m => ({
          from: `Suiv'Heures <${from}>`,
          to: [m.email],
          reply_to: replyTo,
          subject: m.sujet,
          html: m.html,
          text: m.text
        })))
      });
      if (resp.ok) {
        lot.forEach(() => resultats.push({ ok: true }));
      } else {
        const detail = (await resp.text().catch(() => "")).slice(0, 300);
        lot.forEach(() => resultats.push({ ok: false, erreur: `Resend ${resp.status} : ${detail}` }));
      }
    } catch (err) {
      lot.forEach(() => resultats.push({ ok: false, erreur: err.message }));
    }
    if (i + 100 < mails.length) await _pause(1000);
  }
  return resultats;
}
