import type { InboxFeed, Lang } from '../shared/types';

/**
 * The last Inbox MAAI showed, so the Inbox opens at once with it and updates quietly behind it, instead of an
 * empty screen while the server reads mail and WhatsApp. Kept in memory and, for the next time the app opens,
 * on this device; signing out clears both. Storage can be unavailable (private mode): then it is memory only.
 */
const KEY = 'maai.inbox';
const memory: Partial<Record<Lang, InboxFeed>> = {};

export function cachedFeed(lang: Lang): InboxFeed | null {
  if (memory[lang]) return memory[lang];
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { lang?: Lang; feed?: InboxFeed } | null;
    if (saved?.lang === lang && saved.feed && Array.isArray(saved.feed.items)) return (memory[lang] = saved.feed);
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
  for (const lang of Object.keys(memory) as Lang[]) delete memory[lang];
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to remove.
  }
}
