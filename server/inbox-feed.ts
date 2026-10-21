import type { FeedItem, InboxFeed, Lang, MailDigest, WhatsAppDigest } from '../shared/types.js';
import { digestInbox } from './ai/mail.js';
import { digestWhatsApp, threads } from './ai/whatsapp.js';
import { botStatus } from './bot.js';
import { inboxConfigured } from './gmail-inbox.js';
import { state } from './store.js';

/**
 * The Inbox as one list, newest first: Gmail (read by MAAI), and the WhatsApp and email the device bot
 * or the business number delivered, each line tagged with where it came from. MAAI's read of each one
 * (gist, priority, suggestion) comes from the two digests, which are only rewritten when something changed.
 */

function fromMail(digest: MailDigest): FeedItem[] {
  return digest.emails.map((m) => ({
    key: `mail:${m.uid}`,
    channel: 'email',
    source: 'gmail',
    from: m.fromName,
    subject: m.subject,
    text: m.insight?.gist ?? m.body.slice(0, 160),
    body: m.body,
    at: m.date,
    waiting: !m.handled && m.insight?.category !== 'ignore' && (m.unread || m.insight?.category === 'decide' || m.insight?.category === 'reply'),
    priority: m.insight?.priority,
    suggestion: m.insight?.category === 'ignore' ? undefined : m.insight?.suggestion,
    options: m.insight?.options?.length ? m.insight.options : undefined,
    uid: m.uid,
    handled: Boolean(m.handled),
  }));
}

function fromMessages(digest: Pick<WhatsAppDigest, 'threads'>): FeedItem[] {
  return digest.threads.map((thread) => {
    const last = thread.messages[thread.messages.length - 1];
    const ins = thread.insight;
    return {
      key: `msg:${thread.key}`,
      channel: last.channel === 'email' ? 'email' : 'whatsapp',
      source: last.via ?? 'manual',
      from: thread.name,
      subject: last.subject,
      text: ins?.gist ?? last.text.slice(0, 160),
      body: thread.messages.map((m) => m.text).join('\n\n'),
      at: thread.lastAt,
      waiting: thread.unanswered > 0 && ins?.category !== 'ignore',
      priority: ins?.priority,
      suggestion: ins?.category === 'ignore' ? undefined : ins?.suggestion,
      options: ins?.options?.length ? ins.options : undefined,
      message: last,
      intake: thread.phone ? state.intake[thread.phone]?.summary : undefined,
      handled: thread.unanswered === 0,
    };
  });
}

export async function inboxFeed(lang: Lang, refresh = false): Promise<InboxFeed> {
  // One source failing (Gmail down, messaging switched off) must not empty the whole Inbox.
  const [mail, messages] = await Promise.allSettled([inboxConfigured ? digestInbox(lang, refresh) : Promise.resolve(null), digestWhatsApp(lang)]);
  const items = [
    ...(mail.status === 'fulfilled' && mail.value ? fromMail(mail.value) : []),
    // Without MAAI's read (Claude unreachable) the messages are still listed, just not summarised.
    ...fromMessages(messages.status === 'fulfilled' ? messages.value : { threads: threads() }),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const summary = [mail.status === 'fulfilled' && mail.value?.emails.length ? mail.value.summary : '', messages.status === 'fulfilled' && messages.value.threads.length ? messages.value.summary : '']
    .filter(Boolean)
    .join(' ');
  const failed = [mail, messages].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  for (const f of failed) console.error('Inbox summary failed:', (f.reason as Error)?.message);
  const ar = lang === 'ar';
  // The reasons stay in the server log; the user is told only that the summary is missing.
  const fallback = failed.length ? (ar ? 'تعذّر تلخيص الوارد الآن. الرسائل معروضة بالأسفل.' : 'MAAI could not summarise your inbox right now. The messages are listed below.') : ar ? 'لا شيء جديد في الوارد.' : 'Nothing new in your inbox.';
  return { fetchedAt: new Date().toISOString(), summary: summary || fallback, items, bot: botStatus() };
}
