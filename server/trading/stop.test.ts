import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-stop',
    MAAI_DATA_FILE: '/tmp/claude-0/trading-stop/store.json',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-stop/trading.json',
    MAAI_TRADING_QUOTES: 'sim',
  });
});

const create = vi.hoisted(() => vi.fn());
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: {}, create }));

import { decisionRound } from './agents';
import { currentQuotes, refreshQuotes, resetQuotes } from './market';
import { resetTrading, trading } from './store';

const reply = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], model: 'm' });
const SUN = new Date('2026-11-01T08:00:00Z');
const read = { symbol: '2222', price: 25, changePct: -1, trend: 'flat' as const, score: 0, signal: 'hold' as const };
/** Holds 100 Aramco bought at a cost that puts it at `ratio` of today's price (0.95 = down 5%). */
const holding = (ratio: number) => {
  trading.books.paper.positions = [{ symbol: '2222', qty: 100, avgCost: currentQuotes().get('2222')!.price / ratio }];
};

beforeEach(async () => {
  create.mockReset();
  resetTrading();
  resetQuotes();
  await refreshQuotes(SUN);
  trading.decider = 'claude';
});

describe('the stop-loss in code', () => {
  it('sells a holding at -4% or worse even when Claude proposes nothing', async () => {
    create.mockResolvedValue(reply({ summary: 'لا شيء', decisions: [] }));
    holding(0.97); // -3%: Claude's call
    expect(await decisionRound([read], [], 200, SUN)).toEqual([]);
    holding(0.95); // -5%
    const [sell, ...rest] = await decisionRound([read], [], 200, SUN);
    expect(rest).toEqual([]);
    expect(sell).toMatchObject({ symbol: '2222', side: 'sell', qty: 100, confidence: 1 });
    expect(sell.rationale).toMatch(/وقف خسارة إلزامي عند -4٪/);
  });

  it('still sells when Claude cannot answer, and drops a proposal to buy more of the stopped stock', async () => {
    holding(0.9);
    create.mockRejectedValue(new Error('overloaded'));
    expect((await decisionRound([read], [], 200, SUN)).map((d) => d.side)).toEqual(['sell']);
    const price = currentQuotes().get('2222')!.price;
    create.mockResolvedValue(reply({ summary: '', decisions: [{ symbol: '2222', side: 'buy', qty: 50, limitPrice: price, confidence: 0.9, rationale: 'تعزيز' }] }));
    const made = await decisionRound([read], [], 200, SUN);
    expect(made.map((d) => [d.symbol, d.side])).toEqual([['2222', 'sell']]);
  });
});
