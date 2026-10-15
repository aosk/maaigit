import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/news-data', MAAI_DATA_FILE: '/tmp/claude-0/news-data/store.json', ANTHROPIC_API_KEY: '', ASANA_TOKEN: '', GOOGLE_CALENDAR_ICS_URL: '' });
});

import type { NewsRaw } from '../../shared/types';
import { discoverFeeds, parseFeed, plain, safeLink } from './parse';
import { rankStories, similarity } from './rank';
import { readSource, refreshNews } from './index';
import { NEWS_SOURCES, type NewsSource } from './sources';
import { state } from '../store';

const NOW = Date.parse('2026-10-15T09:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toUTCString();
const iso = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const rss = (items: { title: string; link: string; hoursAgo?: number; description?: string }[]) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${hoursAgo(i.hoursAgo ?? 1)}</pubDate><description>${i.description ?? ''}</description></item>`)
    .join('')}</channel></rss>`;

describe('reading a feed', () => {
  it('reads RSS: title, link, date, and a plain excerpt from escaped HTML', () => {
    const items = parseFeed(rss([{ title: 'Big &amp; bold', link: 'https://x.test/a', description: '&lt;p&gt;Hello &lt;b&gt;world&lt;/b&gt; &amp;amp; more&lt;/p&gt;' }]));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Big & bold', link: 'https://x.test/a', snippet: 'Hello world & more' });
    expect(Date.parse(items[0].publishedAt)).toBe(NOW - 3_600_000);
  });

  it('reads Atom with its alternate link and updated date', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Atom story</title><link rel="self" href="https://x.test/self"/><link rel="alternate" href="https://x.test/story"/><updated>2026-10-15T07:00:00Z</updated><summary>Short</summary></entry></feed>`;
    expect(parseFeed(xml)).toEqual([{ title: 'Atom story', snippet: 'Short', link: 'https://x.test/story', publishedAt: '2026-10-15T07:00:00.000Z' }]);
  });

  it('skips items with no title, link or valid date, and survives garbage', () => {
    expect(parseFeed('<rss><channel><item><title></title><link>https://x.test/a</link><pubDate>Thu, 15 Oct 2026 07:00:00 GMT</pubDate></item><item><title>No date</title><link>https://x.test/b</link></item></channel></rss>')).toEqual([]);
    for (const junk of ['', 'not xml at all', '<html><body>hi</body></html>', '<rss><channel></channel></rss>', '\u0000\u0001', '<'.repeat(5000)]) expect(parseFeed(junk)).toEqual([]);
  });

  it('removes scripts, tags, control characters and direction tricks from what it shows', () => {
    expect(plain('<script>alert(1)</script>Hi <img src=x onerror=alert(1)>there‮\u0000', 100)).toBe('Hi there');
    expect(plain('x'.repeat(500), 50)).toHaveLength(50);
    expect(plain('&lt;iframe src=//evil&gt;ok', 100)).toBe('ok');
    expect(plain('A &#x1F600; &#9999999999; B', 100)).toContain('A');
  });

  it('does not expand entity bombs', () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">]><rss><channel><item><title>&d;&d;&d;&d;&d;&d;&d;&d;</title><link>https://x.test/a</link><pubDate>Thu, 15 Oct 2026 07:00:00 GMT</pubDate></item></channel></rss>`;
    const start = Date.now();
    const items = parseFeed(bomb);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(items.every((i) => i.title.length <= 220)).toBe(true);
  });
});

describe('a story\'s link', () => {
  const hosts = ['bbc.com', 'bbc.co.uk'];
  it('keeps https links on the source\'s own sites and removes tracking', () => {
    expect(safeLink('https://www.bbc.com/news/tech-1?utm_source=x&id=7#top', hosts)).toBe('https://www.bbc.com/news/tech-1?id=7');
    expect(safeLink('http://www.bbc.co.uk/news/a', hosts)).toBe('https://www.bbc.co.uk/news/a');
  });
  it('drops anything else', () => {
    for (const bad of ['https://evil.example/news', 'https://bbc.com.evil.example/x', 'https://evilbbc.com/x', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://bbc.com/x', 'https://user:pw@bbc.com/x', 'https://bbc.com:8443/x', '//bbc.com/x', '', 'not a url']) expect(safeLink(bad, hosts), bad).toBe('');
  });
  it('finds the feeds a page advertises', () => {
    const html = `<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"><link rel='alternate' type='application/atom+xml' href='https://x.test/atom?a=1&amp;b=2'><link rel="stylesheet" href="/s.css"></head>`;
    expect(discoverFeeds(html, 'https://x.test/home')).toEqual(['https://x.test/feed.xml', 'https://x.test/atom?a=1&b=2']);
  });
});

describe('ranking', () => {
  const raw = (id: string, source: string, title: string, h: number, snippet = ''): NewsRaw => ({ id, section: 'tech', source, title, snippet, url: `https://x.test/${id}`, publishedAt: iso(h) });
  const weight = (s: string) => ({ Official: 10, Outlet: 6 }[s] ?? 5);

  it('sees the same story in different words', () => {
    expect(similarity('OpenAI launches new reasoning model', 'OpenAI launches a new reasoning model today')).toBeGreaterThan(0.5);
    expect(similarity('OpenAI launches new reasoning model', 'Saudi budget forecasts a deficit')).toBeLessThan(0.2);
    expect(similarity('', 'x')).toBe(0);
  });

  it('shows one story once, credits the other sources, and ranks a widely reported one higher', () => {
    const stories = rankStories(
      [
        raw('1', 'Official', 'OpenAI launches new reasoning model', 3),
        raw('2', 'Outlet', 'OpenAI launches new reasoning model for developers', 3),
        raw('3', 'Outlet', 'Gadget review: a phone with a nice screen', 1),
      ],
      'tech',
      weight,
      NOW,
    );
    expect(stories).toHaveLength(2);
    expect(stories[0].item.id).toBe('1'); // the more trusted version leads
    expect(stories[0].alsoBy).toEqual(['Outlet']);
  });

  it('prefers newer news and AI topics, and an official source over an outlet', () => {
    const stories = rankStories([raw('old', 'Outlet', 'Quarterly numbers for a company', 60), raw('new', 'Outlet', 'Quarterly numbers for another firm', 2), raw('ai', 'Outlet', 'Anthropic ships a new model', 2)], 'tech', weight, NOW);
    expect(stories.map((s) => s.item.id)).toEqual(['ai', 'new', 'old']);
  });

  it('copes with nothing', () => {
    expect(rankStories([], 'saudi', weight, NOW)).toEqual([]);
  });
});

describe('reading the sources', () => {
  const source: NewsSource = { id: 't', name: 'Test News', section: 'tech', home: 'https://news.test/', feeds: ['https://news.test/feed'], hosts: ['news.test'], weight: 5 };
  const respond = (routes: Record<string, string | { status: number; location?: string; body?: string }>): typeof fetch =>
    (async (input: RequestInfo | URL) => {
      const url = String(input);
      const route = routes[url];
      if (route === undefined) return new Response('not found', { status: 404 });
      if (typeof route === 'string') return new Response(route, { status: 200 });
      return new Response(route.body ?? '', { status: route.status, headers: route.location ? { location: route.location } : undefined });
    }) as typeof fetch;

  it('keeps recent stories that link to the source, and drops old, foreign and future ones', async () => {
    const feed = rss([
      { title: 'Fresh story', link: 'https://news.test/a', hoursAgo: 2 },
      { title: 'Four days old', link: 'https://news.test/b', hoursAgo: 100 },
      { title: 'Points elsewhere', link: 'https://tracker.example/c', hoursAgo: 1 },
      { title: 'From the future', link: 'https://news.test/d', hoursAgo: -30 },
    ]);
    const { items, error } = await readSource(source, respond({ 'https://news.test/feed': feed }), NOW);
    expect(error).toBeUndefined();
    expect(items.map((i) => i.title)).toEqual(['Fresh story']);
    expect(items[0]).toMatchObject({ source: 'Test News', section: 'tech', url: 'https://news.test/a' });
  });

  it('finds the feed from the front page when the usual address has moved', async () => {
    const page = '<head><link rel="alternate" type="application/rss+xml" href="/new-feed.xml"></head>';
    const { items } = await readSource(source, respond({ 'https://news.test/': page, 'https://news.test/new-feed.xml': rss([{ title: 'Found it', link: 'https://news.test/a' }]) }), NOW);
    expect(items.map((i) => i.title)).toEqual(['Found it']);
  });

  it('reports why a source could not be read', async () => {
    expect((await readSource(source, respond({}), NOW)).error).toMatch(/404|no feed/);
    expect((await readSource(source, respond({ 'https://news.test/feed': '<html>not a feed</html>' }), NOW)).error).toMatch(/no stories|no feed/);
  });

  it('follows a redirect only within the source\'s own sites, and never to an address it would not read', async () => {
    const ok = await readSource(source, respond({ 'https://news.test/feed': { status: 301, location: 'https://news.test/real' }, 'https://news.test/real': rss([{ title: 'Moved', link: 'https://news.test/a' }]) }), NOW);
    expect(ok.items).toHaveLength(1);
    const offsite = await readSource(source, respond({ 'https://news.test/feed': { status: 302, location: 'https://evil.example/feed' }, 'https://evil.example/feed': rss([{ title: 'Evil', link: 'https://news.test/a' }]) }), NOW);
    expect(offsite.items).toEqual([]);
    expect(offsite.error).toMatch(/own sites|no feed/);
    const internal = await readSource(source, respond({ 'https://news.test/feed': { status: 302, location: 'http://169.254.169.254/latest/meta-data' } }), NOW);
    expect(internal.items).toEqual([]);
    const loop = await readSource(source, respond({ 'https://news.test/feed': { status: 302, location: 'https://news.test/feed' } }), NOW);
    expect(loop.items).toEqual([]);
  });

  it('refuses a feed that is far too large', async () => {
    const huge = `<rss><channel>${'<item><title>x</title></item>'.repeat(100_000)}</channel></rss>`;
    expect((await readSource(source, respond({ 'https://news.test/feed': huge }), NOW)).error).toMatch(/too large|no feed/);
  });

  it('keeps only Saudi stories from a feed that covers the whole region', async () => {
    const regional: NewsSource = { ...source, section: 'saudi', needsTopic: true };
    const feed = rss([{ title: 'Riyadh opens a new metro line', link: 'https://news.test/a' }, { title: 'Elections in a faraway country', link: 'https://news.test/b' }, { title: 'خبر عن المملكة', link: 'https://news.test/c' }]);
    expect((await readSource(regional, respond({ 'https://news.test/feed': feed }), NOW)).items.map((i) => i.title)).toEqual(['Riyadh opens a new metro line', 'خبر عن المملكة']);
  });
});

describe('the list of trusted sources', () => {
  it('is only https, only named outlets, each with its own site to check links against', () => {
    expect(NEWS_SOURCES.length).toBeGreaterThanOrEqual(8);
    for (const s of NEWS_SOURCES) {
      expect(s.home).toMatch(/^https:\/\//);
      expect(s.feeds.every((f) => f.startsWith('https://'))).toBe(true);
      expect(s.hosts.length).toBeGreaterThan(0);
      expect(s.feeds.every((f) => s.hosts.some((h) => new URL(f).hostname.endsWith(h)) || /^feeds\./.test(new URL(f).hostname))).toBe(true);
    }
    expect(new Set(NEWS_SOURCES.map((s) => s.section))).toEqual(new Set(['tech', 'saudi']));
    expect(new Set(NEWS_SOURCES.map((s) => s.id)).size).toBe(NEWS_SOURCES.length);
  });
});

describe('updating the news', () => {
  beforeEach(() => {
    state.news = { items: [], sources: [] };
  });

  const everything = (feeds: Record<string, string>): typeof fetch =>
    (async (input: RequestInfo | URL) => {
      const body = feeds[String(input)];
      return body === undefined ? new Response('no', { status: 404 }) : new Response(body, { status: 200 });
    }) as typeof fetch;

  it('keeps each source\'s result, and an old headline for a source that fails this time', async () => {
    const first = everything({ 'https://www.technologyreview.com/feed/': rss([{ title: 'MIT story', link: 'https://www.technologyreview.com/2026/a' }]), 'https://www.arabnews.com/rss.xml': rss([{ title: 'Riyadh summit opens', link: 'https://www.arabnews.com/node/1' }]) });
    await refreshNews({ fetcher: first, now: NOW });
    expect(state.news.items.map((i) => i.title).sort()).toEqual(['MIT story', 'Riyadh summit opens']);
    expect(state.news.sources.find((s) => s.name === 'MIT Technology Review')).toMatchObject({ ok: true, items: 1 });
    expect(state.news.sources.find((s) => s.name === 'Ars Technica')).toMatchObject({ ok: false });

    // next time Arab News is down: its earlier headline stays, and the status says so
    const second = everything({ 'https://www.technologyreview.com/feed/': rss([{ title: 'MIT story 2', link: 'https://www.technologyreview.com/2026/b' }]) });
    await refreshNews({ fetcher: second, now: NOW + 3_600_000 });
    expect(state.news.items.map((i) => i.title).sort()).toEqual(['MIT story 2', 'Riyadh summit opens']);
    expect(state.news.sources.find((s) => s.name === 'Arab News')).toMatchObject({ ok: false });
  });

  it('does not read again within the minimum time, but does when forced to', async () => {
    const fetcher = vi.fn(everything({}));
    await refreshNews({ fetcher, now: NOW });
    const calls = fetcher.mock.calls.length;
    await refreshNews({ fetcher, now: NOW + 60_000, minAgeMs: 5 * 60_000 });
    expect(fetcher.mock.calls.length).toBe(calls);
    await refreshNews({ fetcher, now: NOW + 10 * 60_000, minAgeMs: 5 * 60_000 });
    expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
  });
});
