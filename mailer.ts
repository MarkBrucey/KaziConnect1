// Sends emails (only password resets for now).
//
// With BREVO_API_KEY and MAIL_FROM set, emails go out through Brevo's free
// transactional email API. Without them, nothing is emailed: the message is
// written to the server log instead, so the reset flow can still be tested.

import { singleton } from './lib/singleton';

export interface OutboxMessage {
  to: string;
  subject: string;
  text: string;
  at: Date;
}

// Messages that were not emailed (no email service set up), newest last. One list per process,
// however many copies of this module Next makes, so a test can read what a route handler wrote.
export const outbox: OutboxMessage[] = singleton('mailer.outbox', () => []);

// Links in emails always use the site's own address, never the Host header
// of the incoming request, which an attacker could fake to steal reset links.
export function siteAddress(): string {
  const base = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
  return base.replace(/\/+$/, '');
}

interface Mail {
  to: string;
  name: string;
  subject: string;
  text: string;
  html: string;
}

async function send({ to, name, subject, text, html }: Mail): Promise<{ emailed: boolean }> {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    outbox.push({ to, subject, text, at: new Date() });
    if (outbox.length > 20) outbox.shift();
    if (!process.env.JEST_WORKER_ID) {
      console.log(`[email not set up] Not emailed to ${to}: "${subject}"\n${text}`);
    }
    return { emailed: false };
  }
  const res = await fetch(process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: from, name: process.env.MAIL_FROM_NAME || 'Kazi Connect' },
      to: [{ email: to, name }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    console.error(`Email to ${to} failed: Brevo answered ${res.status} ${await res.text()}`);
    return { emailed: false };
  }
  return { emailed: true };
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s: string): string => String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

export function sendPasswordReset({ to, name, token }: { to: string; name: string; token: string }): Promise<{ emailed: boolean }> {
  const link = `${siteAddress()}/#reset=${token}`;
  const text = [
    `Hi ${name},`,
    '',
    'Someone asked to reset the password for your Kazi Connect account.',
    'Use this link within 30 minutes to choose a new password:',
    link,
    '',
    'If that was not you, ignore this email. Your password stays the same.',
  ].join('\n');
  const html = `<p>Hi ${escapeHtml(name)},</p>
<p>Someone asked to reset the password for your Kazi Connect account.</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#554A40;color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600">Choose a new password</a></p>
<p>This link works for 30 minutes, and only once.</p>
<p>If that was not you, ignore this email. Your password stays the same.</p>`;
  return send({ to, name, subject: 'Reset your Kazi Connect password', text, html });
}
