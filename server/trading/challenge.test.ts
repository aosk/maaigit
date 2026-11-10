import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-challenge',
    MAAI_DATA_FILE: '/tmp/claude-0/trading-challenge/store.json',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-challenge/trading.json',
    MAAI_TRADING_QUOTES: 'sim',
  });
});

const create = vi.hoisted(() => vi.fn());
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: {}, create }));

import type { Decision } from './agents';
import { challengeBuys } from './challenge';
import { resetTrading, trading } from './store';

const reply = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const SUN = new Date('2026-11-01T08:00:00Z');
const ctx = { reads: [], news: [] };
const d = (id: string, symbol: string, side: 'buy' | 'sell', qty: number, limitPrice: number): Decision => ({ id, symbol, side, qty, limitPrice, confidence: 0.8, rationale: 'زخم' });
// The per-order limit is 10,000: a buy of 5,000 or more is large.
const big = d('b1', '2222', 'buy', 300, 27);
const big2 = d('b2', '1120', 'buy', 80, 90);
const small = d('s1', '4002', 'buy', 10, 160);
const sale = d('x1', '1180', 'sell', 400, 36);

beforeEach(() => {
  create.mockReset();
  resetTrading();
  trading.decider = 'claude';
});

describe('the second opinion on large buys', () => {
  it('asks once about the large buys only, and can halve or drop them', async () => {
    create.mockResolvedValue(reply({ rulings: [{ id: 'b1', ruling: 'halve', reason: 'النتائج بعد يومين' }, { id: 'b2', ruling: 'reject', reason: 'السهم أضعف من المؤشر والاتجاه القصير نازل' }] }));
    const out = await challengeBuys([big, small, big2, sale], ctx, SUN);
    expect(create).toHaveBeenCalledTimes(1);
    const asked = JSON.parse((create.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content) as { buys: { id: string }[] };
    expect(asked.buys.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(create.mock.calls[0][0]).toMatchObject({ purpose: 'trading-challenge' });
    expect(out.map((x) => [x.id, x.qty])).toEqual([['b1', 150], ['s1', 10], ['x1', 400]]);
    expect(trading.events.find((e) => e.correlationId === 'b2')).toMatchObject({ type: 'risk.verdict', data: { verdict: 'veto', secondOpinion: 'reject' } });
    expect(trading.events.find((e) => e.correlationId === 'b1')!.text).toMatch(/رأي ثاني: نص الكمية.*150.*بدل 300/);
  });

  it('never makes an order larger, and leaves the buys alone when it cannot answer', async () => {
    create.mockResolvedValue(reply({ rulings: [{ id: 'b1', ruling: 'approve', reason: 'السبب يطابق الأدلة' }] }));
    expect(await challengeBuys([big], ctx, SUN)).toEqual([big]);
    create.mockRejectedValue(new Error('overloaded'));
    expect(await challengeBuys([big, big2], ctx, SUN)).toEqual([big, big2]);
  });

  it('costs nothing when there is no large buy, or when the plain rule decides', async () => {
    expect(await challengeBuys([small, sale], ctx, SUN)).toEqual([small, sale]);
    trading.decider = 'rules';
    expect(await challengeBuys([big], ctx, SUN)).toEqual([big]);
    expect(create).not.toHaveBeenCalled();
  });
});
