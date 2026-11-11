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
import { gate } from './engine';
import { processOrders } from './executor';
import { currentQuotes, injectQuote, refreshQuotes, resetQuotes } from './market';
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

  it('prices the stop under the market, so it fills while the stock keeps falling', async () => {
    create.mockResolvedValue(reply({ summary: '', decisions: [] }));
    holding(0.9);
    const price = currentQuotes().get('2222')!.price;
    const [sell] = await decisionRound([read], [], 200, SUN);
    expect(sell.limitPrice).toBeCloseTo(price * 0.99, 5);
    gate(sell, SUN);
    const order = trading.orders[0];
    expect(order).toMatchObject({ side: 'sell', qty: 100, refPrice: price });
    expect(order.limitPrice).toBeLessThan(price);
    // The next price is lower still, yet above the stop's limit: the sale goes through at that price.
    const later = new Date(SUN.getTime() + 60_000);
    const next = Math.round((order.limitPrice + price) * 50) / 100;
    injectQuote({ ...currentQuotes().get('2222')!, price: next, asOf: later.toISOString(), receivedAt: later.toISOString() });
    processOrders(later);
    expect(order).toMatchObject({ status: 'filled', avgFillPrice: next });
    expect(trading.books.paper.positions).toEqual([]);
  });

  it('is not held back by the day\'s order count, which stops new buys only', async () => {
    create.mockResolvedValue(reply({ summary: '', decisions: [] }));
    holding(0.9);
    trading.ordersToday = { day: '2026-11-01', count: trading.limits.maxOrdersPerDay };
    const [sell] = await decisionRound([read], [], 200, SUN);
    gate(sell, SUN);
    expect(trading.orders[0]).toMatchObject({ side: 'sell', qty: 100 });
    const q = currentQuotes().get('1120')!;
    gate({ id: 'b', symbol: '1120', side: 'buy', qty: 10, limitPrice: q.price, confidence: 0.8, rationale: 't' }, SUN);
    expect(trading.orders).toHaveLength(1);
    expect(trading.events.at(-1)!.data).toMatchObject({ verdict: 'veto' });
  });

  it('still acts with the decision agent switched off, or with nothing read this round', async () => {
    holding(0.9);
    expect((await decisionRound([], [], 200, SUN)).map((d) => [d.symbol, d.side])).toEqual([['2222', 'sell']]);
    trading.agents.decision = { enabled: false };
    expect((await decisionRound([read], [], 200, SUN)).map((d) => d.side)).toEqual(['sell']);
    trading.decider = 'rules';
    expect((await decisionRound([], [], 200, SUN)).map((d) => d.side)).toEqual(['sell']);
    expect(create).not.toHaveBeenCalled();
  });

  it('marks an order that cannot be booked as failed, and carries on with the rest', () => {
    const q = currentQuotes().get('2222')!;
    const mk = (id: string, side: 'buy' | 'sell', limitPrice: number) => ({ id, decisionId: id, symbol: '2222', side, qty: 10, limitPrice, status: 'sent' as const, mode: 'paper' as const, createdAt: SUN.toISOString(), expiresAt: new Date(SUN.getTime() + 600_000).toISOString(), filledQty: 0 });
    // A sale of shares the book does not hold (a damaged file, say), then an ordinary buy.
    trading.orders.push(mk('bad', 'sell', q.price - 1), mk('good', 'buy', q.price + 1));
    const later = new Date(SUN.getTime() + 60_000);
    injectQuote({ ...q, asOf: later.toISOString(), receivedAt: later.toISOString() });
    expect(() => processOrders(later)).not.toThrow();
    expect(trading.orders.map((o) => [o.id, o.status])).toEqual([['bad', 'failed'], ['good', 'filled']]);
    expect(trading.events.some((e) => e.type === 'order.failed')).toBe(true);
  });
});
