// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import type { InboxFeed } from '../shared/types';

const feed = { items: [], sources: { email: 'ok', whatsapp: 'ok' } } as unknown as InboxFeed;
const store = new Map<string, string>();
Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } });

const cache = await import('./inboxCache');

describe('the saved Inbox', () => {
  beforeEach(() => cache.forgetFeeds());

  it('is hidden until the server has confirmed the session', () => {
    cache.keepFeed('en', feed);
    expect(cache.cachedFeed('en')).toBeNull();
    cache.confirmSession();
    expect(cache.cachedFeed('en')).toBe(feed);
  });

  it('is read back from storage only once confirmed, and wiped by a lock', () => {
    cache.keepFeed('en', feed);
    cache.confirmSession();
    cache.forgetFeeds();
    expect(store.has('maai.inbox')).toBe(false);
    cache.confirmSession();
    expect(cache.cachedFeed('en')).toBeNull();
  });

  it('tells screens when it is confirmed and when it is wiped', () => {
    const seen: string[] = [];
    const off = [cache.whenConfirmed(() => seen.push('confirmed')), cache.whenForgotten(() => seen.push('forgotten'))];
    cache.confirmSession();
    cache.forgetFeeds();
    off.forEach((f) => f());
    expect(seen).toEqual(['confirmed', 'forgotten']);
  });

  it('counts the lock time as idle only after that many minutes', () => {
    expect(cache.idleTooLong(0, 30 * 60_000, 30)).toBe(false);
    expect(cache.idleTooLong(0, 30 * 60_000 + 1, 30)).toBe(true);
  });
});
