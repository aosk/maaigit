import type { NewsSection } from '../../shared/types.js';

/**
 * The only places MAAI reads news from. Every source is a well-known outlet, a news agency, or the
 * organisation that makes the news itself. Nothing else is ever fetched, and a story's link must stay
 * on that source's own site (see `hosts`). To add or remove one, edit this list.
 */
export interface NewsSource {
  id: string;
  name: string;
  section: NewsSection;
  /** The site's front page: used to find the feed's address if the usual one has moved. */
  home: string;
  /** Feed addresses to try, in order. */
  feeds: string[];
  /** Sites a story's link may point to (the source's own). A link anywhere else is dropped. */
  hosts: string[];
  /** Counts for ranking: a primary source or news agency weighs a little more. */
  weight: number;
  /** The feed covers more than the section (the whole Middle East, say): keep only stories that match the section's words. */
  needsTopic?: boolean;
}

export const NEWS_SOURCES: NewsSource[] = [
  // ---- AI and technology ----
  { id: 'mit-tr', name: 'MIT Technology Review', section: 'tech', home: 'https://www.technologyreview.com/', feeds: ['https://www.technologyreview.com/feed/'], hosts: ['technologyreview.com'], weight: 8 },
  { id: 'ars', name: 'Ars Technica', section: 'tech', home: 'https://arstechnica.com/', feeds: ['https://feeds.arstechnica.com/arstechnica/index', 'https://arstechnica.com/ai/feed/'], hosts: ['arstechnica.com'], weight: 7 },
  { id: 'bbc-tech', name: 'BBC News · Technology', section: 'tech', home: 'https://www.bbc.com/innovation', feeds: ['https://feeds.bbci.co.uk/news/technology/rss.xml'], hosts: ['bbc.com', 'bbc.co.uk'], weight: 8 },
  { id: 'verge', name: 'The Verge', section: 'tech', home: 'https://www.theverge.com/', feeds: ['https://www.theverge.com/rss/index.xml'], hosts: ['theverge.com'], weight: 6 },
  { id: 'techcrunch', name: 'TechCrunch', section: 'tech', home: 'https://techcrunch.com/category/artificial-intelligence/', feeds: ['https://techcrunch.com/category/artificial-intelligence/feed/'], hosts: ['techcrunch.com'], weight: 6 },
  { id: 'openai', name: 'OpenAI', section: 'tech', home: 'https://openai.com/news/', feeds: ['https://openai.com/news/rss.xml'], hosts: ['openai.com'], weight: 9 },
  { id: 'deepmind', name: 'Google DeepMind', section: 'tech', home: 'https://deepmind.google/discover/blog/', feeds: ['https://deepmind.google/blog/rss.xml'], hosts: ['deepmind.google', 'blog.google'], weight: 9 },

  // ---- Saudi Arabia ----
  { id: 'spa', name: 'Saudi Press Agency', section: 'saudi', home: 'https://www.spa.gov.sa/en', feeds: ['https://www.spa.gov.sa/rss'], hosts: ['spa.gov.sa'], weight: 10 },
  { id: 'arabnews', name: 'Arab News', section: 'saudi', home: 'https://www.arabnews.com/', feeds: ['https://www.arabnews.com/rss.xml'], hosts: ['arabnews.com'], weight: 7, needsTopic: true },
  { id: 'saudigazette', name: 'Saudi Gazette', section: 'saudi', home: 'https://saudigazette.com.sa/', feeds: ['https://saudigazette.com.sa/rssFeed/74'], hosts: ['saudigazette.com.sa'], weight: 7 },
  { id: 'aawsat', name: 'Asharq Al-Awsat', section: 'saudi', home: 'https://english.aawsat.com/', feeds: ['https://english.aawsat.com/feed'], hosts: ['aawsat.com'], weight: 7, needsTopic: true },
  { id: 'alarabiya', name: 'Al Arabiya English', section: 'saudi', home: 'https://english.alarabiya.net/', feeds: ['https://english.alarabiya.net/tools/rss'], hosts: ['alarabiya.net'], weight: 6, needsTopic: true },
];

/** Words that make a story about Saudi Arabia (English and Arabic), for feeds that cover more than the Kingdom. */
export const SAUDI_WORDS = /saudi|riyadh|jeddah|makkah|mecca|madinah|medina|neom|aramco|vision 2030|\bPIF\b|public investment fund|the kingdom|crown prince|king salman|dammam|tadawul|السعود|الرياض|جدة|مكة|المدينة المنورة|نيوم|أرامكو|رؤية 2030|المملكة|ولي العهد|خادم الحرمين|تداول/i;

/** Words that mark an AI story, to rank those higher within technology. */
export const AI_WORDS = /\bAI\b|artificial intelligence|machine learning|OpenAI|Anthropic|Claude|Gemini|ChatGPT|\bLLM\b|language model|neural|Nvidia|GPU|chip|robot|quantum|cyber|semiconductor|data cent/i;

/** Words that mark a weighty Saudi story (government, economy, major projects). */
export const SAUDI_WEIGHTY = /vision 2030|council of ministers|royal (decree|order)|crown prince|PIF|aramco|NEOM|investment|economy|GDP|budget|expo|world cup|رؤية 2030|مجلس الوزراء|أمر ملكي|ولي العهد|الاستثمار|الاقتصاد|الميزانية/i;
