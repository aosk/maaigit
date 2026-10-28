import type { FeedItem, InboxFeed, Lang, MailDigest, SourceState, WhatsAppDigest } from '../shared/types.js';
import { client } from './ai/claude.js';
import { digestInbox } from './ai/mail.js';
import { digestWhatsApp, threads } from './ai/whatsapp.js';
import { botStatus } from './bot.js';
import { config } from './config.js';
import { fetchInbox, inboxConfigured } from './gmail-inbox.js';
import { save, state } from './store.js';
import { whatsappConfigured } from './whatsapp.js';

/**
 * The Inbox as one list, newest first: Gmail (read by MAAI), and the WhatsApp and email the device bot
 * or the business number delivered, each line tagged with where it came from. MAAI's read of each one
 * (gist, priority, suggestion) comes from the two digests, which are only rewritten when something changed.
 */

/** How far back Gmail is read (the digest's own window). */
const EMAIL_DAYS = 2;

/** The sender's own word for urgent, in Arabic or English. MAAI's priority is a separate thing. */
const URGENT = /عاجل|ضروري|بأسرع وقت|(?:^|[^a-z])(?:urgent|asap)(?:[^a-z]|$)/i;

type Category = 'decide' | 'reply' | 'fyi' | 'ignore' | undefined;

/** Needs an answer: yes for MAAI's "decide" and "reply", no for "fyi" and "ignore" or once answered, maybe when unread without a read. */
function needsReplyOf(category: Category, answered: boolean, unread: boolean): FeedItem['needsReply'] {
  if (answered) return 'no';
  if (category === 'decide' || category === 'reply') return 'yes';
  if (category === 'fyi' || category === 'ignore') return 'no';
  return unread ? 'maybe' : 'no';
}

/** The user's correction wins until the sender writes again. */
function withLabel(item: FeedItem): FeedItem {
  const label = state.feedLabels[item.key];
  if (!label || label.at < item.at) return item;
  return { ...item, needsReply: label.needsReply, labelled: true, waiting: label.needsReply === 'yes' || (item.waiting && label.needsReply !== 'no') };
}

function fromMail(digest: Pick<MailDigest, 'emails'>): FeedItem[] {
  return digest.emails.map((m) => ({
    key: `mail:${m.uid}`,
    channel: 'email',
    source: 'gmail',
    from: m.fromName,
    address: m.fromAddress,
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
    needsReply: needsReplyOf(m.insight?.category, Boolean(m.handled), m.unread),
    unread: m.unread,
    urgentSaid: URGENT.test(`${m.subject}\n${m.body}`),
    analysed: Boolean(m.insight),
  }));
}

function fromMessages(digest: Pick<WhatsAppDigest, 'threads'>): FeedItem[] {
  return digest.threads.map((thread) => {
    const last = thread.messages[thread.messages.length - 1];
    const ins = thread.insight;
    const unanswered = thread.messages.slice(-Math.max(1, thread.unanswered));
    return {
      key: `msg:${thread.key}`,
      channel: last.channel === 'email' ? 'email' : 'whatsapp',
      source: last.via ?? 'manual',
      from: thread.name,
      address: last.email,
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
      needsReply: needsReplyOf(ins?.category, thread.unanswered === 0, thread.unanswered > 0),
      urgentSaid: thread.unanswered > 0 && unanswered.some((m) => URGENT.test(`${m.subject ?? ''}\n${m.text}`)),
      analysed: Boolean(ins),
    };
  });
}

/** Keeps the user's correction of "needs a reply" for one conversation or email (or clears it). */
export function labelFeedItem(key: string, needsReply: 'yes' | 'no' | null): void {
  if (needsReply) state.feedLabels[key] = { needsReply, at: new Date().toISOString() };
  else delete state.feedLabels[key];
  const keys = Object.keys(state.feedLabels);
  if (keys.length > 500) {
    for (const old of keys.sort((a, b) => state.feedLabels[a].at.localeCompare(state.feedLabels[b].at)).slice(0, keys.length - 500)) delete state.feedLabels[old];
  }
  save();
}

export async function inboxFeed(lang: Lang, refresh = false): Promise<InboxFeed> {
  // One source failing (Gmail down, messaging switched off) must not empty the whole Inbox.
  const [mail, messages] = await Promise.allSettled([inboxConfigured ? digestInbox(lang, refresh) : Promise.resolve(null), digestWhatsApp(lang)]);
  // When MAAI's read of the mail failed, the mail itself is still listed (it is cached, so this costs nothing).
  let emails: Pick<MailDigest, 'emails'> | null = mail.status === 'fulfilled' ? mail.value : null;
  let email: SourceState = inboxConfigured ? 'ok' : 'off';
  if (inboxConfigured && mail.status === 'rejected') {
    emails = await fetchInbox()
      .then((list) => ({ emails: list }))
      .catch(() => null);
    if (!emails) email = 'failed';
  }
  const items = [
    ...(emails ? fromMail(emails) : []),
    // Without MAAI's read (Claude unreachable) the messages are still listed, just not summarised.
    ...fromMessages(messages.status === 'fulfilled' ? messages.value : { threads: threads() }),
  ]
    .map(withLabel)
    .sort((a, b) => b.at.localeCompare(a.at));
  const summary = [mail.status === 'fulfilled' && mail.value?.emails.length ? mail.value.summary : '', messages.status === 'fulfilled' && messages.value.threads.length ? messages.value.summary : '']
    .filter(Boolean)
    .join(' ');
  const failed = [mail, messages].filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  for (const f of failed) console.error('Inbox summary failed:', (f.reason as Error)?.message);
  const ar = lang === 'ar';
  // The reasons stay in the server log; the user is told only that the summary is missing.
  const fallback = failed.length ? (ar ? 'تعذّر تلخيص رسائلك الآن. الرسائل معروضة بالأسفل.' : 'MAAI could not summarise your messages right now. They are listed below.') : ar ? 'لا شيء جديد في رسائلك.' : 'Nothing new in your messages.';
  const bot = botStatus();
  const whatsapp: SourceState = bot.connected ? (bot.stale ? 'stale' : 'ok') : whatsappConfigured || items.some((i) => i.channel === 'whatsapp') ? 'ok' : 'off';
  return {
    fetchedAt: new Date().toISOString(),
    summary: summary || fallback,
    items,
    bot,
    analysis: !client ? 'off' : failed.length ? 'failed' : 'ok',
    sources: { email, whatsapp },
    window: { emailDays: EMAIL_DAYS, whatsappDays: config.whatsappDays },
  };
}
