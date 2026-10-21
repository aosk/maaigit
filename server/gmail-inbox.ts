import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { MailItem } from '../shared/types.js';
import { MailError } from './mail.js';
import { failed, ok } from './signals.js';

/**
 * Reads recent Gmail messages over IMAP with the same App Password used for
 * sending. Read-only: the mailbox is opened read-only, so nothing is marked
 * as read, moved or deleted. Messages are kept in memory only, never on disk.
 */

const user = process.env.GMAIL_USER?.trim() ?? '';
const pass = (process.env.GMAIL_APP_PASSWORD ?? '').replace(/\s+/g, '');

/** MAAI_DEMO_INBOX=1 shows sample emails, to try the screen without connecting Gmail. */
const demo = process.env.MAAI_DEMO_INBOX === '1' && !(user && pass);

export const inboxConfigured = Boolean(user && pass) || demo;

function demoInbox(): MailItem[] {
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  return [
    { uid: 101, fromName: 'Sara Al-Harbi', fromAddress: 'sara@example.com', subject: 'Q4 report: which version do we send?', date: ago(1), unread: true, body: 'Hi, the client wants the Q4 report by Thursday. We can send the short version now, or wait until Sunday for the full analysis. Which do you prefer?\n\nSara' },
    { uid: 102, fromName: 'Ahmed', fromAddress: 'ahmed@example.com', subject: 'Dinner on Friday?', date: ago(3), unread: true, body: 'Are you free for dinner on Friday after Isha? Let me know.' },
    { uid: 103, fromName: 'Bank', fromAddress: 'noreply@bank.example.com', subject: 'Your monthly statement is ready', date: ago(9), unread: false, body: 'Your statement for this month is available in online banking.' },
    { uid: 104, fromName: 'Deals Weekly', fromAddress: 'news@deals.example.com', subject: '50% off this weekend only', date: ago(20), unread: true, body: 'Big sale this weekend on electronics.' },
  ];
}

/** How much of each email Claude and the app see. */
const BODY_CHARS = 4000;
const CACHE_MS = 5 * 60_000;

let cache: { at: number; days: number; items: MailItem[] } | null = null;

/** The most recent fetch, if any; used to give the assistant inbox context. */
export const cachedInbox = () => cache?.items ?? [];

/** Strips quoted earlier messages and signature noise so the summary sees what is new. */
function cleanBody(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  const cut = lines.findIndex((l) => /^On .+ wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l) || /^>/.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, BODY_CHARS);
}

export async function fetchInbox(opts: { days?: number; max?: number; refresh?: boolean } = {}): Promise<MailItem[]> {
  if (!inboxConfigured) throw new MailError('Gmail is not connected. Add GMAIL_USER and GMAIL_APP_PASSWORD in Render → Environment.');
  const days = opts.days ?? 2;
  const max = opts.max ?? 25;
  if (!opts.refresh && cache && cache.days === days && Date.now() - cache.at < CACHE_MS) return cache.items;
  if (demo) {
    cache = { at: Date.now(), days, items: demoInbox() };
    return cache.items;
  }

  const started = Date.now();
  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
  // A dropped connection is reported as an error event; with no listener Node would stop the whole server.
  client.on('error', (error: Error) => console.error('Gmail inbox connection error:', error.message));
  try {
    await client.connect();
  } catch (error) {
    const message = (error as { responseText?: string; message?: string }).responseText ?? (error as Error).message ?? '';
    console.error('Gmail inbox sign-in failed:', message);
    failed('gmail', /AUTHENTICATIONFAILED|Invalid credentials|auth/i.test(message) ? 'Gmail refused the sign-in (App Password)' : 'Could not reach Gmail');
    if (/AUTHENTICATIONFAILED|Invalid credentials|auth/i.test(message)) {
      throw new MailError('Gmail refused the sign-in for reading. Check GMAIL_USER and the App Password in Render → Environment.');
    }
    throw new MailError('Could not reach Gmail. Try again in a moment.');
  }

  const items: MailItem[] = [];
  try {
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      // Gmail's own search: the Primary tab only, so promotions and social updates stay out.
      let uids = await client.search({ gmraw: `category:primary newer_than:${days}d` }, { uid: true }).catch(() => false as const);
      if (!uids) uids = await client.search({ since: new Date(Date.now() - days * 86_400_000) }, { uid: true });
      const recent = (uids || []).slice(-max);
      if (recent.length) {
        for await (const msg of client.fetch(recent, { uid: true, flags: true, source: { maxLength: 300_000 } }, { uid: true })) {
          if (!msg.source) continue;
          const mail = await simpleParser(msg.source);
          const from = mail.from?.value[0];
          items.push({
            uid: msg.uid,
            fromName: from?.name || from?.address || 'Unknown',
            fromAddress: from?.address ?? '',
            subject: mail.subject ?? '(no subject)',
            date: (mail.date ?? new Date()).toISOString(),
            unread: !msg.flags?.has('\\Seen'),
            body: cleanBody(mail.text ?? ''),
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  items.sort((a, b) => b.date.localeCompare(a.date));
  cache = { at: Date.now(), days, items };
  ok('gmail', Date.now() - started);
  return items;
}

export async function getEmail(uid: number): Promise<MailItem | undefined> {
  return cachedInbox().find((m) => m.uid === uid) ?? (await fetchInbox({ days: 14, max: 80 })).find((m) => m.uid === uid);
}
