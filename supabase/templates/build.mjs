// Writes the five login email templates for Supabase (Authentication → Emails → Templates).
// Change SHOP to the shop's name, run `node supabase/templates/build.mjs`, then paste each file.
// Every button goes to /auth/confirm with a one-time token, so links work on the shop's own site.
// Email-safe on purpose: tables, inline styles, system fonts, no images or SVG (Gmail blocks SVG).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHOP = 'Power Store';
const here = path.dirname(fileURLToPath(import.meta.url));
const link = (type) => `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${type}`;

const mails = [
  { file: 'invite', subject: `You're invited to the ${SHOP} team`, title: 'Welcome to the team', body: `You've been added to the ${SHOP} team as {{ .Email }}. Set your password to start using your screens.`, button: 'Set my password', type: 'invite' },
  { file: 'reset-password', subject: `Reset your ${SHOP} password`, title: 'Choose a new password', body: `Someone asked to reset the password for {{ .Email }}. If it was you, choose a new one below.`, button: 'Choose a new password', type: 'recovery', after: 'If you didn&#39;t ask for this, ignore this email. Your password stays the same.' },
  { file: 'magic-link', subject: `Your ${SHOP} sign-in link`, title: 'Your sign-in link', body: `Tap the button to sign in to ${SHOP} as {{ .Email }}.`, button: 'Sign me in', type: 'magiclink', after: 'If you didn&#39;t try to sign in, ignore this email.' },
  { file: 'change-email', subject: 'Confirm your new email address', title: 'Confirm your new email', body: `Confirm that {{ .NewEmail }} should replace {{ .Email }} for your ${SHOP} login.`, button: 'Confirm new email', type: 'email_change', after: 'If you didn&#39;t ask for this, tell the owner straight away.' },
  { file: 'confirm-signup', subject: `Confirm your email for ${SHOP}`, title: 'Confirm your email', body: `Confirm {{ .Email }} to finish setting up your ${SHOP} login.`, button: 'Confirm my email', type: 'signup' },
];

const page = (m) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${m.subject}</title></head>
<body style="margin:0;padding:0;background:#EEF1F4;">
  <div style="display:none;max-height:0;overflow:hidden;">${m.body.replace(/{{[^}]+}}/g, '').replace(/\s+/g, ' ')}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#EEF1F4;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;">
        <tr><td style="padding:0 4px 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td width="34" height="34" align="center" valign="middle" style="background:#10161E;border-radius:10px;font-size:17px;line-height:34px;color:#FFD25E;">&#9889;</td>
            <td style="padding-left:10px;font-size:17px;font-weight:700;letter-spacing:-0.2px;color:#10161E;">${SHOP}</td>
          </tr></table>
        </td></tr>
        <tr><td style="background:#FFFFFF;border:1px solid #E3E7EC;border-radius:20px;padding:32px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <h1 style="margin:0;font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-0.4px;color:#10161E;">${m.title}</h1>
          <p style="margin:12px 0 0;font-size:15.5px;line-height:1.6;color:#434E5A;">${m.body}</p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 0;"><tr>
            <td align="center" bgcolor="#1B5CF0" style="border-radius:13px;">
              <a href="${link(m.type)}" style="display:inline-block;padding:14px 26px;font-size:15.5px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:13px;">${m.button}</a>
            </td>
          </tr></table>
          <p style="margin:22px 0 0;font-size:13px;line-height:1.55;color:#6B7682;">This link works once and expires soon.${m.after ? ` ${m.after}` : ''}</p>
        </td></tr>
        <tr><td style="padding:18px 6px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12.5px;line-height:1.55;color:#6B7682;">
          ${SHOP} will never ask for your password by email, phone or WhatsApp.<br>Sent because of your login at {{ .SiteURL }}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
`;

for (const m of mails) fs.writeFileSync(path.join(here, `${m.file}.html`), page(m));
fs.writeFileSync(path.join(here, 'subjects.txt'), mails.map((m) => `${m.file}.html  →  Subject: ${m.subject}`).join('\n') + '\n');
console.log(`${mails.length} templates written for ${SHOP}.`);
