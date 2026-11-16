import type { BotCommand, ExchangeLine, InboxMessage, SentMessage } from '../shared/types.js';
import { state } from './store.js';

/**
 * What went out on WhatsApp through the device bot, for the user to look back at: MAAI's own replies, team reminders,
 * what couriers were sent, notices to the user's own number, and the replies the user approved. It is what MAAI
 * queued (the last 200 are kept); a message the user typed in WhatsApp themselves is not here, since MAAI never keeps those.
 */

const kindOf = (c: BotCommand): SentMessage['kind'] => c.tag ?? (c.automatic ? 'reply' : 'approved');

const toSent = (c: BotCommand): SentMessage => ({
  id: c.id,
  phone: c.phone ?? '',
  toName: c.toName,
  text: c.text,
  at: c.sentAt ?? c.createdAt,
  kind: kindOf(c),
  status: c.status,
  problem: c.status === 'failed' ? c.result?.slice(0, 200) : undefined,
  withPicture: c.attachment ? true : undefined,
});

/** Every WhatsApp message MAAI queued, newest first. */
export function sentMessages(): SentMessage[] {
  return state.bot.commands
    .filter((c) => c.kind === 'reply' && c.phone)
    .map(toSent)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** One conversation in order: what they wrote and what went out to them (never the notices to the user's own number). */
export function exchangeWith(phone: string, theirs: InboxMessage[]): ExchangeLine[] {
  const sent = sentMessages().filter((m) => m.phone === phone && m.kind !== 'self');
  const since = theirs.length ? theirs[0].receivedAt : '';
  return [
    ...theirs.map((m): ExchangeLine => ({ who: 'them', text: m.text, at: m.receivedAt })),
    // Only what went out since the first message shown, so an old reminder does not head a new conversation.
    ...sent.filter((m) => m.at >= since).map((m): ExchangeLine => ({ who: 'sent', text: m.text, at: m.at, kind: m.kind, status: m.status })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}
