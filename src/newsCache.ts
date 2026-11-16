import type { Lang, NewsDigest } from '../shared/types';

/**
 * The last news MAAI showed, so the News tab opens at once with it (and keeps it while an update runs behind
 * it). News is public, so unlike the Inbox it needs no lock: on this device only, per language. Storage can be
 * unavailable (private mode): then it is memory only.
 */
const key = (lang: Lang) => `maai.news.${lang}`;
const memory: Partial<Record<Lang, NewsDigest>> = {};

const looksRight = (v: unknown): v is NewsDigest => {
  const d = v as NewsDigest | null;
  return !!d && typeof d === 'object' && !!d.sections && Array.isArray(d.sections.tech) && Array.isArray(d.sections.saudi) && Array.isArray(d.sections.models);
};

export function readNews(lang: Lang): NewsDigest | null {
  const have = memory[lang];
  if (have) return have;
  try {
    const raw = localStorage.getItem(key(lang));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (looksRight(parsed)) return (memory[lang] = parsed);
  } catch {
    // nothing saved, or storage is unavailable
  }
  return null;
}

export function saveNews(lang: Lang, digest: NewsDigest): void {
  memory[lang] = digest;
  try {
    localStorage.setItem(key(lang), JSON.stringify(digest));
  } catch {
    // memory only
  }
}
