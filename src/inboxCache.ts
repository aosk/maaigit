import type { InboxFeed, Lang } from '../shared/types';
import { forgetSeen } from './inboxSeen';

/**
 * The last Inbox MAAI showed, so the Inbox opens at once with it and updates quietly behind it, instead of an
 * empty screen while the server reads mail and WhatsApp. Kept in memory and, for the next time the app opens,
 * on this device; signing out clears both. Storage can be unavailable (private mode): then it is memory only.
 */
const KEY = 'maai.inbox';
const memory: Partial<Record<Lang, InboxFeed>> = {};

/**
 * The saved copy is shown only after the server has answered an authenticated request in this page's life:
 * a locked or expired app must not paint mail from storage. Offline later in the same page stays friendly.
 */
let confirmed = false;
const onConfirm = new Set<() => void>();
const onForget = new Set<() => void>();


/** The server accepted the session: the saved Inbox may now be shown. */
export function confirmSession(): void {
  if (confirmed) return;
  confirmed = true;
  onConfirm.forEach((f) => f());
}

/** Calls `f` when the session is confirmed. Returns the unsubscribe function. */
export function whenConfirmed(f: () => void): () => void {
  onConfirm.add(f);
  return () => void onConfirm.delete(f);
}

/** Calls `f` when the saved Inbox is wiped (lock, sign-out, idle), so a screen can drop what it holds. */
export function whenForgotten(f: () => void): () => void {
  onForget.add(f);
  return () => void onForget.delete(f);
}

/** True when nothing was done for `minutes` (the app's lock time): then the saved Inbox must go. */
export const idleTooLong = (lastActive: number, now: number, minutes: number): boolean => now - lastActive > minutes * 60_000;

export function cachedFeed(lang: Lang): InboxFeed | null {
  if (!confirmed) return null;
  if (memory[lang]) return memory[lang];
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { lang?: Lang; feed?: InboxFeed } | null;
    // A feed saved by an older version (without the source states) is not shown: it would be missing fields.
    if (saved?.lang === lang && saved.feed && Array.isArray(saved.feed.items) && saved.feed.sources) return (memory[lang] = saved.feed);
  } catch {
    // Unreadable or blocked: start empty.
  }
  return null;
}

export function keepFeed(lang: Lang, feed: InboxFeed): void {
  memory[lang] = feed;
  try {
    localStorage.setItem(KEY, JSON.stringify({ lang, feed }));
  } catch {
    // Full or blocked: memory only.
  }
}

/** On sign-out: nothing of the Inbox stays on this device. */
export function forgetFeeds(): void {
  confirmed = false;
  for (const lang of Object.keys(memory) as Lang[]) delete memory[lang];
  forgetSeen();
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to remove.
  }
  onForget.forEach((f) => f());
}
