import type { NewsRaw, NewsSection } from '../../shared/types.js';
import { AI_WORDS, SAUDI_WEIGHTY } from './sources.js';

/** Deciding which stories matter most. Pure: the same headlines always rank the same way. */

export interface Story {
  item: NewsRaw;
  /** Other sources that carried the same story. */
  alsoBy: string[];
  score: number;
}

const STOP = new Set('the a an of to in on for and with from by at as is are was were be been it its this that these those after over into about new says say said will could would may might has have had not but more than how why what who when where their his her you your our they them we us up out off no yes amid'.split(' '));

const words = (title: string): Set<string> =>
  new Set(
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );

/** How alike two headlines are (0 to 1): shared words over all words. */
export function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/**
 * Ranks a section: newer is better; a source that is a primary one or an agency counts more; a story that
 * several different sources carry counts a lot; and the section's own big topics (AI, or government and
 * the economy for Saudi Arabia) get a lift. The same story from two sources is shown once.
 */
export function rankStories(items: NewsRaw[], section: NewsSection, weightOf: (source: string) => number, now = Date.now()): Story[] {
  const sorted = [...items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const clusters: { lead: NewsRaw; members: NewsRaw[] }[] = [];
  for (const item of sorted) {
    const home = clusters.find((c) => similarity(c.lead.title, item.title) >= 0.5);
    if (home) home.members.push(item);
    else clusters.push({ lead: item, members: [item] });
  }
  const topic = section === 'tech' ? AI_WORDS : SAUDI_WEIGHTY;
  return clusters
    .map(({ members }) => {
      const sources = [...new Set(members.map((m) => m.source))];
      // The lead is the version from the most trusted source.
      const best = members.reduce((a, b) => (weightOf(b.source) > weightOf(a.source) ? b : a));
      const hours = Math.max(0, (now - Date.parse(best.publishedAt)) / 3_600_000);
      let score = 100 - Math.min(hours, 96) * 1.1 + weightOf(best.source) + (sources.length - 1) * 18;
      if (topic.test(`${best.title} ${best.snippet}`)) score += 8;
      return { item: best, alsoBy: sources.filter((s) => s !== best.source), score } satisfies Story;
    })
    .sort((a, b) => b.score - a.score);
}
