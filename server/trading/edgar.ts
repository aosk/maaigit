import type { NewsItem } from './agents.js';
import { deskId } from './desk.js';
import { emit, saveTrading, trading } from './store.js';
import { instrument, UNIVERSE } from './tadawul.js';

/**
 * US company filings, read from the SEC itself (EDGAR), in code: no search and no Claude call.
 *
 * Every 30 minutes on the US desk, each stock's latest filings are read from the SEC's public data service. A new
 * 8-K (a material event: results, a deal, a change of management), 10-Q or 10-K from the last three days becomes an
 * official news item for the decision agent, named in Arabic from the filing's own item codes. The tone is left
 * neutral: the filing says that something happened, not whether it is good.
 *
 * The SEC asks automated readers to say who they are. The reader's name comes from MAAI_SEC_USER_AGENT; set it to a
 * name and a contact address if the SEC starts refusing the default.
 */

const EVERY_MS = 30 * 60_000;
const KEEP_DAYS = 3;
const FORMS = new Set(['8-K', '8-K/A', '10-Q', '10-K']);
const USER_AGENT = process.env.MAAI_SEC_USER_AGENT || 'MAAI personal research (https://maaigit.onrender.com)';

/** What each 8-K item number means, in Arabic (9.01, the exhibits, says nothing by itself). */
const ITEM_AR: Record<string, string> = {
  '1.01': 'اتفاقية جوهرية جديدة',
  '1.02': 'إنهاء اتفاقية جوهرية',
  '1.03': 'إفلاس أو حراسة قضائية',
  '1.05': 'حادث أمن سيبراني جوهري',
  '2.01': 'إتمام استحواذ أو بيع أصول',
  '2.02': 'إعلان نتائج مالية',
  '2.03': 'التزام مالي جديد',
  '2.05': 'إعادة هيكلة أو تسريح',
  '2.06': 'انخفاض جوهري في قيمة أصول',
  '3.01': 'إشعار بمخالفة شروط الإدراج',
  '4.01': 'تغيير مراجع الحسابات',
  '4.02': 'قوائم مالية سابقة لا يُعتمد عليها',
  '5.02': 'تغيير في الإدارة التنفيذية أو مجلس الإدارة',
  '5.03': 'تعديل النظام الأساسي',
  '5.07': 'نتائج تصويت المساهمين',
  '7.01': 'إفصاح للمستثمرين',
  '8.01': 'حدث آخر مهم',
};
const FORM_AR: Record<string, string> = { '10-Q': 'التقرير الربعي (10-Q)', '10-K': 'التقرير السنوي (10-K)' };

interface Filing {
  id: string;
  symbol: string;
  form: string;
  items: string[];
  /** When the SEC accepted it (ISO). */
  at: string;
}

const data = () => (trading.edgar ??= { ciks: {}, filings: [], seen: [] });

async function getJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const res = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Each ticker's SEC number (CIK), read once from the SEC's own list and kept. Funds are not on it and are skipped. */
async function ciks(fetcher: typeof fetch): Promise<Record<string, number>> {
  const d = data();
  if (Object.keys(d.ciks).length) return d.ciks;
  const list = await getJson<Record<string, { cik_str: number; ticker: string }>>('https://www.sec.gov/files/company_tickers.json', fetcher);
  const wanted = new Set(UNIVERSE.map((i) => i.symbol));
  for (const row of Object.values(list)) if (wanted.has(row.ticker) && !(row.ticker in d.ciks)) d.ciks[row.ticker] = row.cik_str;
  return d.ciks;
}

interface Submissions {
  filings?: { recent?: { accessionNumber?: string[]; form?: string[]; items?: string[]; acceptanceDateTime?: string[]; filingDate?: string[] } };
}

const headline = (f: Filing) => {
  const what = f.form.startsWith('8-K') ? f.items.map((i) => ITEM_AR[i]).filter(Boolean).join('، ') || 'حدث جوهري' : FORM_AR[f.form] ?? f.form;
  return `إفصاح لدى هيئة الأوراق الأمريكية (${f.form}): ${what}`;
};

let lastRun = 0;
/** For the tests: forget when the filings were last read. */
export const resetFilings = () => void (lastRun = 0);

/** Reads each US stock's latest filings (at most every 30 minutes); new ones are logged once. Errors are logged, never thrown. */
export async function filingsRound(now = new Date(), fetcher: typeof fetch = fetch): Promise<void> {
  if (deskId() !== 'us' || trading.agents.news?.enabled === false || now.getTime() - lastRun < EVERY_MS) return;
  lastRun = now.getTime();
  const d = data();
  const oldest = now.getTime() - KEEP_DAYS * 86_400_000;
  let read = 0;
  let fresh = 0;
  let failed = '';
  try {
    const map = await ciks(fetcher);
    // One at a time: the SEC allows ten requests a second, and there is no hurry.
    for (const [symbol, cik] of Object.entries(map)) {
      try {
        const r = (await getJson<Submissions>(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`, fetcher)).filings?.recent;
        read++;
        (r?.accessionNumber ?? []).slice(0, 20).forEach((id, i) => {
          const form = r?.form?.[i] ?? '';
          const at = r?.acceptanceDateTime?.[i] ?? `${r?.filingDate?.[i] ?? ''}T00:00:00.000Z`;
          if (!FORMS.has(form) || !(Date.parse(at) >= oldest) || Date.parse(at) > now.getTime() || d.seen.includes(id)) return;
          const filing: Filing = { id, symbol, form, items: (r?.items?.[i] ?? '').split(',').map((x) => x.trim()).filter(Boolean), at: new Date(at).toISOString() };
          d.seen.push(id);
          d.filings.push(filing);
          fresh++;
          emit('agent.observation', 'news', `📢 إعلان رسمي · ${instrument(symbol)?.nameAr ?? symbol} (${symbol}): ${headline(filing)} · SEC EDGAR`, { data: { symbol, official: true, filing: id } }, now);
        });
      } catch (error) {
        failed = (error as Error).message;
      }
    }
  } catch (error) {
    failed = (error as Error).message;
  }
  d.filings = d.filings.filter((f) => Date.parse(f.at) >= oldest);
  d.seen = d.seen.slice(-400);
  d.lastRunAt = now.toISOString();
  d.lastError = read === 0 && failed ? failed : undefined;
  if (fresh) saveTrading();
  console.log(`StockSmart filings: ${read} compan${read === 1 ? 'y' : 'ies'} read from the SEC, ${fresh} new filing(s)${failed ? `; last error: ${failed}${/403/.test(failed) ? ' (the SEC wants a contact in MAAI_SEC_USER_AGENT)' : ''}` : ''}.`);
}

/** The last three days' filings as official news items, newest first, for the decision agent. */
export function filingItems(now = new Date()): NewsItem[] {
  if (deskId() !== 'us') return [];
  const oldest = now.getTime() - KEEP_DAYS * 86_400_000;
  return (trading.edgar?.filings ?? [])
    .filter((f) => Date.parse(f.at) >= oldest)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)
    .map((f) => ({ symbol: f.symbol, headline: headline(f), tone: 'neutral' as const, source: 'SEC EDGAR', official: true, published: f.at }));
}
