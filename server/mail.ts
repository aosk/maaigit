import nodemailer from 'nodemailer';

/**
 * Sends email from the user's own Gmail through an App Password
 * (myaccount.google.com/apppasswords). Nothing is sent unless the user approves.
 */

const user = process.env.GMAIL_USER?.trim() ?? '';
// Google shows the App Password in groups of four; spaces are not part of it.
const pass = (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, '');

const transport = user && pass ? nodemailer.createTransport({ service: 'gmail', auth: { user, pass } }) : null;

export const mailConfigured = Boolean(transport);
export const mailFrom = user;

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i;
export const isEmail = (value: string) => EMAIL.test(value.trim());

export class MailError extends Error {}

/** A header value on one line: a line break in a subject could add headers (a hidden Bcc, say). */
export const oneLine = (value: string) => value.replace(/[\r\n\u2028\u2029]+/g, ' ').trim();

export async function sendMail(mail: { to: string; subject: string; body: string }): Promise<void> {
  if (!transport) throw new MailError('Gmail is not connected. Add GMAIL_USER and GMAIL_APP_PASSWORD in Render → Environment.');
  if (!isEmail(mail.to)) throw new MailError(`"${mail.to}" is not a valid email address.`);
  try {
    await transport.sendMail({ from: user, to: mail.to.trim(), subject: oneLine(mail.subject), text: mail.body });
  } catch (error) {
    const message = (error as Error).message ?? '';
    console.error('Gmail send failed:', message);
    if (/535|Username and Password not accepted|BadCredentials|Invalid login/i.test(message)) {
      throw new MailError('Gmail refused the sign-in. Check GMAIL_USER and the App Password in Render → Environment.');
    }
    throw new MailError('Gmail could not send the email. Try again in a moment.');
  }
}
