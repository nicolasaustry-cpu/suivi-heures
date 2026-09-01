// Service d'envoi d'e-mails (SMTP, via nodemailer).
// nodemailer est chargé dynamiquement : si la librairie n'est pas installée
// ou si le SMTP n'est pas configuré, les envois sont ignorés sans planter l'appli.
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//   SMTP_SECURE = "true" pour le port 465 (sinon 587/STARTTLS)
//   SMTP_FROM   = adresse d'expédition affichée (ex. "contact@volitis.net")
//   APP_URL     = URL de l'application (ex. "https://suivi-heures.volitis.net")

let _transport = null;

async function transport() {
  if (_transport) return _transport;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null; // non configuré
  let nodemailer;
  try {
    nodemailer = (await import("nodemailer")).default;
  } catch (e) {
    console.warn("nodemailer non installé : e-mails désactivés.");
    return null;
  }
  _transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "587", 10),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  return _transport;
}

function _fmtDate(d) {
  try {
    return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
  } catch { return ""; }
}

// ── E-mail de confirmation d'auto-inscription à l'essai ──
export async function envoyerMailEssai({ email, nomClient, code, dateExpiration }) {
  const t = await transport();
  if (!t) { console.warn("SMTP non configuré : e-mail de confirmation non envoyé."); return false; }

  const from   = process.env.SMTP_FROM || process.env.SMTP_USER;
  const appUrl = process.env.APP_URL || "https://suivi-heures.volitis.net";
  const fin    = _fmtDate(dateExpiration);
  const nom    = (nomClient || "").trim();

  const text =
    `Bienvenue sur Suiv'Heures !\n\n` +
    `Votre espace d'essai est créé.\n` +
    `Votre code d'accès : ${code}\n` +
    (fin ? `Essai gratuit valable jusqu'au ${fin}.\n` : "") +
    `\nCe code sert à vous connecter sur ORDINATEUR, pour configurer votre espace (salariés, chantiers, planning).\n` +
    `Ce n'est pas le code de l'application mobile : celle-ci est réservée à vos salariés, pour pointer.\n` +
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
        &#128187; <strong>Ce code se connecte sur ordinateur</strong>, &agrave; l'adresse suivi-heures.volitis.net, pour configurer votre espace (salari&eacute;s, chantiers, planning&hellip;).<br>
        Ce n'est pas le code de l'application mobile&nbsp;: celle-ci est r&eacute;serv&eacute;e &agrave; vos salari&eacute;s, pour pointer.
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

  await t.sendMail({
    from: `"Suiv'Heures" <${from}>`,
    to: email,
    subject: "Bienvenue sur Suiv'Heures — votre essai de 30 jours",
    text,
    html
  });
  return true;
}
