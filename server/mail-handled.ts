import { cachedInbox } from './gmail-inbox.js';
import { save, state } from './store.js';

/**
 * Remembers which inbox emails the user already dealt with through MAAI, so a "needs your decision"
 * email stops asking once its reply was sent or its meeting booked.
 */

const KEEP = 500;

type HandledMail = { how: 'replied' | 'meeting'; at: string };

export function markHandled(uid: number | undefined, how: HandledMail['how']): void {
  if (!Number.isInteger(uid) || !uid || uid < 0) return;
  state.handledMail[String(uid)] = { how, at: new Date().toISOString() };
  const keys = Object.keys(state.handledMail);
  if (keys.length > KEEP) {
    for (const key of keys.sort((a, b) => state.handledMail[a].at.localeCompare(state.handledMail[b].at)).slice(0, keys.length - KEEP)) delete state.handledMail[key];
  }
  save();
}

/** For a reply the model did not tag with an email number: the newest inbox email from that address. */
export function markReplyTo(address: string, how: HandledMail['how']): void {
  const wanted = address.trim().toLowerCase();
  const mail = cachedInbox()
    .filter((m) => m.fromAddress.toLowerCase() === wanted)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (mail) markHandled(mail.uid, how);
}

export const handledOf = (uid: number): HandledMail | undefined => state.handledMail[String(uid)];
