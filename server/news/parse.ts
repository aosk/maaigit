import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

/** Reading a news feed (RSS or Atom) into plain, safe headlines. Nothing here touches the network. */

interface FeedItem {
  title: string;
  snippet: string;
  link: string;
  publishedAt: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Feeds are other people's files: never expand custom entities, and keep what is expanded small.
  processEntities: { enabled: true, maxEntitySize: 2000, maxExpansionDepth: 1, maxTotalExpansions: 200, maxExpandedLength: 100_000 },
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
});

const text = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in value) return text((value as Record<string, unknown>)['#text']);
  return '';
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', ndash: '–', mdash: '—' };

/** Plain text from a feed field: tags removed, entities decoded, spaces tidied, cut to `max` characters. */
export function plain(value: unknown, max: number): string {
  const decode = (s: string) =>
    s
      .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
      .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
      .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
  // Feeds often hold HTML as escaped text, so decode, remove the tags, then decode what was inside them.
  const cleaned = decode(decode(text(value)).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' '))
    // control characters and invisible direction marks have no place in a headline
    .replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1).trimEnd()}…` : cleaned;
}

/** The headlines of a feed, newest information intact; items without a title, link or date are left out. */
export function parseFeed(xml: string): FeedItem[] {
  let doc: Record<string, any>;
  try {
    doc = parser.parse(xml);
  } catch {
    return [];
  }
  const rssItems: any[] = doc?.rss?.channel?.item ?? doc?.['rdf:RDF']?.item ?? [];
  const atomItems: any[] = doc?.feed?.entry ?? [];
  const items: FeedItem[] = [];

  for (const raw of [...rssItems, ...atomItems]) {
    const links: any[] = Array.isArray(raw.link) ? raw.link : raw.link ? [raw.link] : [];
    const atom = links.find((l) => l && typeof l === 'object' && (l['@_rel'] ?? 'alternate') === 'alternate');
    const link = text(atom?.['@_href'] ?? links.map(text).find((l) => /^https?:/i.test(l)) ?? (typeof raw.guid === 'string' ? raw.guid : text(raw.guid)));
    const when = Date.parse(text(raw.pubDate ?? raw.published ?? raw.updated ?? raw['dc:date']));
    const title = plain(raw.title, 220);
    if (!title || !link || Number.isNaN(when)) continue;
    items.push({ title, snippet: plain(raw.description ?? raw.summary ?? raw['content:encoded'] ?? raw.content, 300), link, publishedAt: new Date(when).toISOString() });
  }
  return items;
}

/**
 * A story's link, kept only if it is https and on one of the source's own sites. Anything else (another
 * domain, a tracking redirect, "javascript:") is dropped. Tracking parameters are removed.
 */
export function safeLink(raw: string, hosts: string[]): string {
  try {
    const url = new URL(raw.trim());
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return '';
    const host = url.hostname.toLowerCase();
    if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$|cmpid|at_)/i.test(key)) url.searchParams.delete(key);
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

/** Feed addresses a page advertises (`<link rel="alternate" type="application/rss+xml">`), resolved against the page. */
export function discoverFeeds(html: string, base: string): string[] {
  const found: string[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["']?alternate/i.test(tag) || !/type=["']?application\/(rss|atom)\+xml/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      found.push(new URL(href.replace(/&amp;/g, '&'), base).toString());
    } catch {
      // not an address
    }
  }
  return found.slice(0, 5);
}

export const storyId = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 12);
