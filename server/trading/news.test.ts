import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/trading-news', MAAI_TRADING_FILE: '/tmp/claude-0/trading-news/trading.json', MAAI_TRADING_QUOTES: 'sim' });
});

/** Claude, replaced by what it would answer after reading the exchange's announcements page. */
const create = vi.hoisted(() => vi.fn());
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: {}, create }));

import { DECISION_PROMPT_VERSION, decisionRound, lastDecisionRecord, marketContext, newsRound, officialAnnouncements, resetAgentMemory } from './agents';
import { resetTrading, trading } from './store';

const OPEN = new Date('2026-11-01T08:00:00Z');
const reply = (fetched: unknown[], items: unknown[]) => ({
  content: [...fetched, { type: 'text', text: JSON.stringify({ items }) }],
});
const page = (url: string) => ({ type: 'web_fetch_tool_result', tool_use_id: 't1', content: { type: 'web_fetch_result', url, content: {} } });
const asked = (url: string, id = 't2') => ({ type: 'server_tool_use', id, name: 'web_fetch', input: { url } });
/** As the API really answers a failed fetch: an error code only, the address being in the request before it. */
const refused = (id = 't2') => ({ type: 'web_fetch_tool_result', tool_use_id: id, content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' } });

beforeEach(() => {
  resetTrading();
  resetAgentMemory();
  create.mockReset();
});

describe('the news agent and the Saudi Exchange announcements', () => {
  it('looks for official announcements first, on Argaam and the exchange only, and marks official items', async () => {
    create.mockResolvedValue(reply([page('https://www.saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news?locale=ar')], [
      { symbol: '2222', headline: 'أرامكو تعلن نتائج الربع الثالث', tone: 'positive', source: 'saudiexchange.sa', official: true },
      { symbol: '1120', headline: 'تقرير عن الراجحي', tone: 'neutral', source: 'Argaam', official: false },
      { symbol: '9999', headline: 'سهم غير متابع', tone: 'neutral', source: 'x', official: true },
    ]));
    const items = await newsRound(OPEN);
    const req = create.mock.calls[0][0] as { system: string; tools: { name: string; allowed_domains?: string[] }[] };
    expect(req.system).toMatch(/FIRST find today's official company announcements/);
    expect(req.system).toMatch(/start with Argaam/);
    // web_fetch only opens addresses in the messages, not in the system prompt.
    expect((create.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content).toContain('saudiexchange.sa/wps/portal/saudiexchange/newsandreports/issuer-news?locale=ar');
    expect(req.tools.map((t) => t.name)).toEqual(['web_fetch', 'web_search']);
    expect(req.tools[0].allowed_domains).toEqual(['saudiexchange.sa', 'www.saudiexchange.sa', 'argaam.com', 'www.argaam.com']);
    expect(items.map((i) => [i.symbol, i.official])).toEqual([['2222', true], ['1120', false]]); // a stock not followed is dropped
    expect(trading.events.find((e) => e.text.includes('أرامكو'))?.text).toMatch(/^📢 إعلان رسمي/);
    expect(trading.events.find((e) => e.text.includes('الراجحي'))?.text).not.toMatch(/إعلان رسمي/);
    expect(officialAnnouncements()).toMatchObject({ ok: true, detail: '1 page(s) read (saudiexchange.sa)' });
  });

  it('counts an announcement read on Argaam when the exchange refuses, and says so when neither opens', async () => {
    create.mockResolvedValue(reply([asked('https://www.saudiexchange.sa/x'), refused(), asked('https://www.argaam.com/ar/company/announcements', 't3'), { ...page('https://www.argaam.com/ar/company/announcements'), tool_use_id: 't3' }], []));
    await newsRound(new Date(OPEN.getTime() + 2 * 3_600_000));
    expect(officialAnnouncements()).toMatchObject({ ok: true, detail: '1 page(s) read (argaam.com)' });
    create.mockResolvedValue(reply([asked('https://www.saudiexchange.sa/x'), refused()], []));
    await newsRound(new Date(OPEN.getTime() + 3 * 3_600_000));
    expect(officialAnnouncements()).toMatchObject({ ok: false, detail: 'not read (saudiexchange.sa url_not_accessible)' });
  });

  it('treats a missing "official" as not official', async () => {
    create.mockResolvedValue(reply([], [{ symbol: '2222', headline: 'خبر', tone: 'neutral', source: 'Reuters' }]));
    const items = await newsRound(new Date(OPEN.getTime() + 4 * 3_600_000));
    expect(items[0].official).toBe(false);
    expect(officialAnnouncements().detail).toBe('not tried');
  });
});

describe('the decision agent with Claude', () => {
  const reads = [{ symbol: '2222', price: 27.4, changePct: 1, trend: 'up' as const, score: 0.6, signal: 'buy' as const }];

  it('places nothing when Claude fails this round, and the record says why', async () => {
    create.mockRejectedValue(new Error('timeout'));
    expect(await decisionRound(reads, [], 200, OPEN)).toEqual([]);
    expect(lastDecisionRecord()).toMatchObject({ source: 'claude', error: 'timeout', promptVersion: DECISION_PROMPT_VERSION, decisions: [] });
    expect(lastDecisionRecord().input).toContain('"symbol":"2222"');
  });

  it('keeps Claude\'s exact answer and the prompt version with the decisions it made', async () => {
    const answer = JSON.stringify({ summary: 'اختراق مع حجم', decisions: [{ symbol: '2222', side: 'buy', qty: 50, limitPrice: 27.45, confidence: 0.7, rationale: 'اختراق' }] });
    create.mockResolvedValue({ model: 'test-model', content: [{ type: 'text', text: answer }] });
    const made = await decisionRound(reads, [], 200, OPEN);
    expect(made).toHaveLength(1);
    expect(lastDecisionRecord()).toMatchObject({ source: 'claude', model: 'test-model', raw: answer, summary: 'اختراق مع حجم', decisions: [{ id: made[0].id }] });
  });
});

describe('market-wide developments', () => {
  it('are reported apart from company news, and an unconfirmed "high" counts as medium', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ items: [], market: [
      { headline: 'هجوم على منشأة', severity: 'high', sectors: ['energy', 'nonsense'], source: 'Reuters', confirmed: true },
      { headline: 'مصادر: تصعيد محتمل', severity: 'high', sectors: [], source: 'X', confirmed: false },
    ] }) }] });
    await newsRound(new Date(OPEN.getTime() + 8 * 3_600_000));
    expect(marketContext()).toEqual([
      expect.objectContaining({ severity: 'high', sectors: ['energy'], confirmed: true }),
      expect.objectContaining({ severity: 'medium', confirmed: false }),
    ]);
    const req = create.mock.calls.at(-1)![0] as { system: string };
    expect(req.system).toMatch(/market-wide developments/);
    expect(trading.events.some((e) => e.text.startsWith('سياق السوق · خطورة عالية'))).toBe(true);
  });
});
