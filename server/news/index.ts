import type { NewsDigest, NewsRaw, NewsSection } from '../../shared/types.js';
import { config } from '../config.js';
import { audit, save, state } from '../store.js';
import { discoverFeeds, parseFeed, safeLink, storyId } from './parse.js';
import { NEWS_SOURCES, SAUDI_WORDS, type NewsSource } from './sources.js';

/** Reads the trusted news sources (and only those) and keeps the latest headlines. */

const MAX_BYTES = 2_000_000;
const MAX_AGE_MS = 4 * 86_400_000;
const PER_SOURCE = 25;
const MAX_ITEMS = 300;
const AGENT = 'MAAI/1.0 (personal assistant; news reader)';

/** Hosts that carry a source's feed but not its pages (a feed on its own subdomain). */
const FEED_HOSTS = ['feeds.bbci.co.uk', 'feeds.arstechnica.com'];

export const newsEnabled = (process.env.MAAI_NEWS ?? 'on').trim().toLowerCase() !== 'off';

const hostOk = (url: URL, source: NewsSource) => {
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && !/^[\d.]+$|:/.test(host) && !url.username && (url.port === '' || url.port === '443') && [...source.hosts, ...FEED_HOSTS].some((h) => host === h || host.endsWith(`.${h}`));
};

/** One address, read safely: https only, only the source's own sites (also across redirects), a time limit and a size limit. */
async function readText(address: string, source: NewsSource, fetcher: typeof fetch = fetch): Promise<string> {
  let current = new URL(address);
  for (let hop = 0; hop < 4; hop++) {
    if (!hostOk(current, source)) throw new Error(`${current.hostname} is not one of this source's own sites`);
    const res = await fetcher(current, { redirect: 'manual', headers: { 'User-Agent': AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.5' }, signal: AbortSignal.timeout(10_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location')!, current);
      continue;
    }
    if (!res.ok) throw new Error(`answered ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error('the feed is too large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('too many redirects');
}

/** Headlines from one source: its known feed addresses first, then any feed its front page advertises. */
export async function readSource(source: NewsSource, fetcher: typeof fetch = fetch, now = Date.now()): Promise<{ items: NewsRaw[]; error?: string }> {
  let lastError = 'no feed found';
  let feedError = '';
  const tried = new Set<string>();
  const attempt = async (address: string): Promise<NewsRaw[] | null> => {
    if (tried.has(address)) return null;
    tried.add(address);
    try {
      const entries = parseFeed(await readText(address, source, fetcher));
      if (!entries.length) {
        lastError = 'the feed had no stories';
        return null;
      }
      const items: NewsRaw[] = [];
      for (const entry of entries) {
        const url = safeLink(entry.link, source.hosts);
        const age = now - Date.parse(entry.publishedAt);
        if (!url || age > MAX_AGE_MS || age < -3_600_000) continue;
        if (source.needsTopic && !SAUDI_WORDS.test(`${entry.title} ${entry.snippet}`)) continue;
        items.push({ id: storyId(url), section: source.section, source: source.name, title: entry.title, snippet: entry.snippet, url, publishedAt: entry.publishedAt });
      }
      return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, PER_SOURCE);
    } catch (error) {
      lastError = (error as Error).message;
      return null;
    }
  };

  for (const address of source.feeds) {
    const items = await attempt(address);
    if (items) return { items };
    feedError ||= lastError; // the first problem with the usual address is the one worth reporting
  }
  try {
    for (const address of discoverFeeds(await readText(source.home, source, fetcher), source.home)) {
      const items = await attempt(address);
      if (items) return { items };
    }
  } catch (error) {
    lastError = (error as Error).message;
  }
  return { items: [], error: (feedError || lastError).slice(0, 160) };
}

let running: Promise<void> | null = null;

/** Reads every source and keeps the result. A source that fails keeps its older headlines. Two calls at once share one read. */
export function refreshNews({ minAgeMs = 0, fetcher = fetch, now = Date.now() }: { minAgeMs?: number; fetcher?: typeof fetch; now?: number } = {}): Promise<void> {
  if (!newsEnabled) return Promise.resolve();
  if (minAgeMs && state.news.fetchedAt && now - Date.parse(state.news.fetchedAt) < minAgeMs) return Promise.resolve();
  running ??= (async () => {
    const results = await Promise.all(NEWS_SOURCES.map(async (source) => ({ source, ...(await readSource(source, fetcher, now)) })));
    const fresh = results.flatMap((r) => r.items);
    const readOk = new Set(results.filter((r) => r.items.length).map((r) => r.source.name));
    // A source that could not be read keeps what it had, until that gets too old.
    const kept = state.news.items.filter((i) => !readOk.has(i.source) && now - Date.parse(i.publishedAt) < MAX_AGE_MS);
    const byId = new Map<string, NewsRaw>();
    for (const item of [...fresh, ...kept]) byId.set(item.id, item);
    state.news = {
      fetchedAt: new Date(now).toISOString(),
      items: [...byId.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, MAX_ITEMS),
      sources: results.map((r) => ({ name: r.source.name, section: r.source.section, ok: r.items.length > 0, items: r.items.length, error: r.error })),
    };
    save();
  })().finally(() => {
    running = null;
  });
  return running;
}

export const newsSourceStatus = (): NewsDigest['sources'] => state.news.sources;

export function newsStatus() {
  const sources = state.news.sources;
  return { updatedAt: state.news.fetchedAt, sourcesOk: sources.filter((s) => s.ok).length, sources: sources.length || NEWS_SOURCES.length };
}

export const itemsFor = (section: NewsSection): NewsRaw[] => state.news.items.filter((i) => i.section === section);
export const weightOf = (name: string): number => NEWS_SOURCES.find((s) => s.name === name)?.weight ?? 5;

/** Reads the news soon after start-up if it is out of date, then every few hours. */
export function startNews() {
  if (!newsEnabled) return;
  const every = config.newsHours * 3_600_000;
  const stale = !state.news.fetchedAt || Date.now() - Date.parse(state.news.fetchedAt) > every;
  if (stale) setTimeout(() => void refreshNews().catch((e) => console.error('News refresh failed:', e)), 15_000);
  setInterval(() => {
    void refreshNews()
      .then(() => {
        const down = state.news.sources.filter((s) => !s.ok).map((s) => s.name);
        audit(down.length ? `News updated; could not read: ${down.join(', ')}` : 'News updated from all trusted sources', 'MAAI', down.length ? 'error' : 'done');
      })
      .catch((e) => console.error('News refresh failed:', e));
  }, every);
}
