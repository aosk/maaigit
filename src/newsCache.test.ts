import { beforeEach, describe, expect, it } from 'vitest';
import type { NewsDigest } from '../shared/types';
import { readNews, saveNews } from './newsCache';

const digest = (brief: string): NewsDigest => ({ source: 'claude', sections: { tech: [], saudi: [], models: [] }, brief: [brief], sources: [], everyHours: 12 });
const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) } });
});

describe('the saved news', () => {
  it('comes back for the language it was saved in, and only that one', () => {
    saveNews('ar', digest('عربي'));
    expect(readNews('ar')?.brief).toEqual(['عربي']);
    expect(store.get('maai.news.ar')).toContain('عربي');
    expect(readNews('en')).toBeNull();
  });

  it('ignores a saved copy of the wrong shape (an older version of the app)', () => {
    store.set('maai.news.en', JSON.stringify({ sections: { tech: [], saudi: [] } }));
    expect(readNews('en')).toBeNull();
    store.set('maai.news.en', 'not json');
    expect(readNews('en')).toBeNull();
  });

  it('still works from memory when storage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    saveNews('ar', digest('x'));
    expect(readNews('ar')?.brief).toEqual(['x']);
  });
});
