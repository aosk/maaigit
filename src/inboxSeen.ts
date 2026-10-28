import type { FeedItem } from '../shared/types';

/**
 * Which messages were opened in maai, kept on this device. Gmail says what is unread; WhatsApp does not, so a
 * conversation counts as unread until it is opened here (or marked read). Nothing is changed in Gmail or WhatsApp.
 * Messages from before maai first kept track count as read, so the list does not start out all unread.
 */

const KEY = 'maai.inboxSeen';
const KEEP = 400;

interface Seen {
  since: string;
  /** Feed key → the time of the newest message when it was read; null when marked unread on purpose. */
  read: Record<string, string | null>;
}

function loadSeen(): Seen {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Seen | null;
    if (saved && typeof saved.since === 'string' && saved.read && typeof saved.read === 'object') return saved;
  } catch {
    // Private mode or a damaged value: start again.
  }
  return { since: new Date().toISOString(), read: {} };
}

let seen = loadSeen();

function keep() {
  const keys = Object.keys(seen.read);
  if (keys.length > KEEP) for (const old of keys.slice(0, keys.length - KEEP)) delete seen.read[old];
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    // Not kept on this device; it still works until the app is closed.
  }
}
keep();

export function isUnread(item: FeedItem): boolean {
  const mark = seen.read[item.key];
  if (mark === null) return true;
  if (mark && mark >= item.at) return false;
  if (item.source === 'gmail') return Boolean(item.unread);
  // A conversation already answered is not waiting to be read.
  return !item.handled && item.at > seen.since;
}

export function markSeen(item: FeedItem, read: boolean): void {
  seen = { ...seen, read: { ...seen.read, [item.key]: read ? item.at : null } };
  keep();
}

/** Forgets everything (on sign-out). */
export function forgetSeen(): void {
  seen = { since: new Date().toISOString(), read: {} };
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing kept.
  }
}
