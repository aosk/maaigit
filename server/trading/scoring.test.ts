import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-scoring',
    MAAI_DATA_FILE: '/tmp/claude-0/trading-scoring/store.json',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-scoring/trading.json',
    MAAI_ROUNDS_DIR: '/tmp/claude-0/trading-scoring/rounds',
    MAAI_TRADING_QUOTES: 'sim',
  });
});

const create = vi.hoisted(() => vi.fn());
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: {}, create }));

import { decisionRound } from './agents';
import { gate } from './engine';
import { processOrders } from './executor';
import { currentIndex, currentQuotes, injectQuote, refreshQuotes, resetQuotes } from './market';
import { scorecardView, scoreRound } from './scoring';
import { emit, resetTrading, trading } from './store';

const reply = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
/** Sunday 1 November 2026, 11:00 Riyadh: Tadawul open. */
const SUN = new Date('2026-11-01T08:00:00Z');
const DAY = 86_400_000;
const at = (base: Date, ms: number) => new Date(base.getTime() + ms);

/** Buys Aramco on paper at SUN and fills it a minute later; returns the fill price and the index then. */
function buyAramco(): { price: number; index: number; filledAt: Date } {
  const q = currentQuotes().get('2222')!;
  const decision = { id: 'd1', symbol: '2222', side: 'buy' as const, qty: 100, limitPrice: q.price, confidence: 0.7, rationale: 'زخم صاعد' };
  // As the decision agent does: the decision is logged, then it goes through the risk gate.
  emit('decision.created', 'decision', 'شراء', { correlationId: decision.id, data: { ...decision } }, SUN);
  gate(decision, SUN);
  const order = trading.orders[0];
  const filledAt = at(SUN, 60_000);
  injectQuote({ ...q, price: order.limitPrice - 0.05, asOf: filledAt.toISOString(), receivedAt: filledAt.toISOString() });
  processOrders(filledAt);
  expect(order.status).toBe('filled');
  return { price: order.avgFillPrice!, index: currentIndex()!.value, filledAt };
}

/** A week later, prices refreshed, Aramco set to `ratio` of its fill price. */
async function weekLater(price: number, ratio: number, plus = 7 * DAY + 3_600_000): Promise<Date> {
  const now = at(SUN, plus);
  await refreshQuotes(now);
  const q = currentQuotes().get('2222')!;
  injectQuote({ ...q, price: Math.round(price * ratio * 100) / 100, asOf: now.toISOString(), receivedAt: now.toISOString() });
  return now;
}

beforeEach(async () => {
  create.mockReset();
  resetTrading();
  resetQuotes();
  await refreshQuotes(SUN);
});

describe('decision scoring', () => {
  it('notes each fill with the index then, and judges it only once its week has passed', async () => {
    const { price, index } = buyAramco();
    expect(trading.scores).toHaveLength(1);
    expect(trading.scores![0]).toMatchObject({ symbol: '2222', side: 'buy', price, index, rationale: 'زخم صاعد' });
    expect(scorecardView()).toMatchObject({ settled: 0, pending: 1, holdDays: 7 });

    // Six days on: not yet.
    await weekLater(price, 1.05, 6 * DAY);
    expect(await scoreRound(at(SUN, 6 * DAY))).toEqual([]);
  });

  it('scores a buy against the index, asks Claude for a lesson, and logs it', async () => {
    const { price, index } = buyAramco();
    const now = await weekLater(price, 1.05);
    create.mockResolvedValue(reply({ lessons: [{ orderId: trading.scores![0].orderId, lesson: 'الزخم نفع: تفوق السهم على المؤشر.' }] }));
    const [s] = await scoreRound(now);
    const indexRet = (currentIndex()!.value / index - 1) * 100;
    expect(s.ret).toBeCloseTo(5, 0);
    expect(s.indexRet).toBeCloseTo(indexRet, 1);
    expect(s.alpha).toBeCloseTo(s.ret! - s.indexRet!, 1);
    expect(s.verdict).toBe(s.alpha! >= 0.5 ? 'right' : s.alpha! <= -0.5 ? 'wrong' : 'even');
    expect(s.lesson).toBe('الزخم نفع: تفوق السهم على المؤشر.');
    expect(create.mock.calls[0][0]).toMatchObject({ purpose: 'trading-lessons' });
    expect(trading.events.at(-1)!.text).toMatch(/تقييم قرارات بعد 7 أيام/);
    expect(scorecardView()).toMatchObject({ settled: 1, pending: 0 });
    // Settled once: the next round changes nothing.
    expect(await scoreRound(at(now, 900_000))).toEqual([]);
  });

  it('judges a sale the other way round: right when the stock then lags', async () => {
    const { price } = buyAramco();
    trading.scores![0].side = 'sell';
    const now = await weekLater(price, 0.9);
    const [s] = await scoreRound(now);
    expect(s.alpha).toBeCloseTo(s.indexRet! - s.ret!, 1);
    expect(s.verdict).toBe('right');
  });

  it('waits for fresh prices, and writes no lesson where the plain rule decides', async () => {
    const { price } = buyAramco();
    trading.decider = 'rules';
    const now = await weekLater(price, 1.05);
    const q = currentQuotes().get('2222')!;
    const old = at(SUN, 3_600_000).toISOString();
    injectQuote({ ...q, asOf: old, receivedAt: old });
    expect(await scoreRound(now)).toEqual([]); // the stock's price is days old
    injectQuote({ ...q, asOf: now.toISOString(), receivedAt: now.toISOString() });
    expect(await scoreRound(now)).toHaveLength(1);
    expect(create).not.toHaveBeenCalled();
  });

  it('hands the record and the lessons to the decision agent', async () => {
    const { price } = buyAramco();
    const now = await weekLater(price, 1.05);
    create.mockResolvedValueOnce(reply({ lessons: [{ orderId: trading.scores![0].orderId, lesson: 'درس' }] }));
    await scoreRound(now);
    create.mockResolvedValue(reply({ summary: '', decisions: [] }));
    await decisionRound([{ symbol: '2222', price: 30, changePct: 0, trend: 'flat', score: 0, signal: 'hold' }], [], 200, now);
    const input = JSON.parse((create.mock.calls.at(-1)![0] as { messages: { content: string }[] }).messages[0].content) as { trackRecord: { scored: number; recent: { lesson?: string }[] } };
    expect(input.trackRecord).toMatchObject({ scored: 1, recent: [{ symbol: '2222', lesson: 'درس' }] });
  });
});
