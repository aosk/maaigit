import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/trading-core', MAAI_TRADING_FILE: '/tmp/claude-0/trading-core/trading.json' });
});

import type { Quote } from '../../shared/trading';
import { marketClock, onTick, riyadh, UNIVERSE } from './tadawul';
import { applyFill, bookValue, dayPnl, rollDay } from './portfolio';
import { checkOrder, type RiskContext } from './risk';
import { dailyVolatility, readStock } from './indicators';
import { DEFAULT_LIMITS, emit, eventsSince, newBook, onTradeEvent, resetTrading, trading } from './store';

// Sunday 2 November 2026, 11:00 in Riyadh (08:00 UTC): the market is open.
const OPEN = new Date('2026-11-01T08:00:00Z');
const quote = (symbol: string, price: number, prevClose = price, asOf = OPEN): Quote => ({ symbol, price, prevClose, asOf: asOf.toISOString(), receivedAt: asOf.toISOString(), source: 'sim' });

function ctx(over: Partial<RiskContext> = {}): RiskContext {
  return {
    limits: { ...DEFAULT_LIMITS },
    book: newBook(100_000, OPEN),
    quotes: new Map([['2222', quote('2222', 27.4)], ['1120', quote('1120', 88)], ['1180', quote('1180', 36)]]),
    universe: UNIVERSE,
    excluded: [],
    halted: false,
    clock: marketClock(OPEN),
    ordersToday: 0,
    openOrders: [],
    now: OPEN,
    ...over,
  };
}

beforeEach(() => resetTrading());

describe('the Tadawul clock', () => {
  it('is open Sunday to Thursday, 10:00 to 15:00 Riyadh time, and says how long until the close', () => {
    expect(marketClock(OPEN)).toEqual({ open: true, minutesToChange: 240, label: 'open' });
    expect(marketClock(new Date('2026-11-01T06:59:00Z')).open).toBe(false); // 09:59
    expect(marketClock(new Date('2026-11-01T12:00:00Z')).open).toBe(false); // 15:00, the close
  });

  it('is closed on Friday and Saturday, counting to Sunday’s open', () => {
    const friday = marketClock(new Date('2026-10-30T09:00:00Z')); // Friday 12:00
    expect(friday).toMatchObject({ open: false, label: 'weekend' });
    expect(friday.minutesToChange).toBe((24 - 12) * 60 + 24 * 60 + 10 * 60);
  });

  it('uses Riyadh’s own day, which starts three hours before UTC’s', () => {
    expect(riyadh(new Date('2026-11-01T22:30:00Z')).date).toBe('2026-11-02');
  });
});

describe('prices on the tick grid', () => {
  it('rounds a buy limit down and a sell limit up, by the band’s tick', () => {
    expect(onTick(27.43, 'buy')).toBe(27.4);
    expect(onTick(27.43, 'sell')).toBe(27.45);
    expect(onTick(88.07, 'buy')).toBe(88);
    expect(onTick(9.876, 'sell')).toBe(9.88);
  });
});

describe('the book', () => {
  it('averages the cost with fees, takes profit on a sale, and counts today from the day’s start', () => {
    const book = newBook(10_000, OPEN);
    applyFill(book, 'buy', '2222', 100, 27);
    expect(book.cash).toBeCloseTo(10_000 - 2700 - 4.32, 2);
    expect(book.positions[0].avgCost).toBeCloseTo(27.0432, 4);
    const profit = applyFill(book, 'sell', '2222', 100, 28);
    expect(profit).toBeCloseTo((28 - 27.0432) * 100 - 4.48, 1);
    expect(book.positions).toEqual([]);
    expect(dayPnl(book, new Map())).toBeCloseTo(profit, 1);
  });

  it('refuses to sell what it does not hold', () => {
    const book = newBook(1_000, OPEN);
    expect(() => applyFill(book, 'sell', '2222', 1, 27)).toThrow(/only 0 held/);
  });

  it('starts a new day’s profit and chart from the value at that moment', () => {
    const book = newBook(1_000, OPEN);
    applyFill(book, 'buy', '2222', 10, 27);
    book.curve.push({ at: OPEN.toISOString(), value: 1 });
    const tomorrow = new Date(OPEN.getTime() + 86_400_000);
    rollDay(book, new Map([['2222', 30]]), tomorrow);
    expect(book.dayStart.value).toBe(bookValue(book, new Map([['2222', 30]])));
    expect(book.curve).toEqual([]);
  });
});

describe('the risk gate', () => {
  it('passes an order inside every limit, with the price on the tick grid', () => {
    // Rounded toward the market so it can fill, since that stays within 1% of the price.
    const v = checkOrder({ symbol: '2222', side: 'buy', qty: 100, limitPrice: 27.43 }, ctx());
    expect(v).toMatchObject({ verdict: 'pass', qty: 100, limitPrice: 27.45 });
    // Right at the 1% chase limit, rounding up would pass it: rounded down instead.
    expect(checkOrder({ symbol: '2222', side: 'buy', qty: 1, limitPrice: 40 }, ctx()).limitPrice).toBe(27.65);
  });

  it('stops everything while halted, while the market is closed, or with no fresh price', () => {
    expect(checkOrder({ symbol: '2222', side: 'buy', qty: 1, limitPrice: 27.4 }, ctx({ halted: true })).verdict).toBe('veto');
    expect(checkOrder({ symbol: '2222', side: 'buy', qty: 1, limitPrice: 27.4 }, ctx({ clock: marketClock(new Date('2026-10-30T09:00:00Z')) })).verdict).toBe('veto');
    const old = new Map([['2222', quote('2222', 27.4, 27.4, new Date(OPEN.getTime() - 60 * 60_000))]]);
    expect(checkOrder({ symbol: '2222', side: 'buy', qty: 1, limitPrice: 27.4 }, ctx({ quotes: old })).reasons[0]).toMatch(/fresh price/);
  });

  it('makes the order smaller for a volatile stock, never below half and never for a calm one', () => {
    const buy = { symbol: '2222', side: 'buy' as const, qty: 1000, limitPrice: 27.4 };
    const full = checkOrder(buy, ctx()).qty;
    const calm = checkOrder(buy, ctx({ volatility: new Map([['2222', 1.5]]), calmVolatility: 2 }));
    expect(calm.qty).toBe(full);
    const lively = checkOrder(buy, ctx({ volatility: new Map([['2222', 3]]), calmVolatility: 2 }));
    expect(lively.qty * 27.4).toBeLessThanOrEqual((DEFAULT_LIMITS.maxOrder * 2) / 3);
    expect(lively.qty * 27.4).toBeGreaterThan(DEFAULT_LIMITS.maxOrder / 2);
    expect(lively.reasons.join(' ')).toMatch(/Volatile: it moves about 3\.0% a day/);
    const wild = checkOrder(buy, ctx({ volatility: new Map([['2222', 9]]), calmVolatility: 2 }));
    expect(Math.round((wild.qty * 27.4) / 100)).toBe(Math.round(DEFAULT_LIMITS.maxOrder / 2 / 100));
    // A sale is never held back by it.
    const book = newBook(100_000, OPEN);
    applyFill(book, 'buy', '2222', 300, 27.4);
    expect(checkOrder({ symbol: '2222', side: 'sell', qty: 300, limitPrice: 27.4 }, ctx({ book, volatility: new Map([['2222', 9]]), calmVolatility: 2 })).qty).toBe(300);
  });

  it('only trades the allowed stocks, and leaves alone what the user excluded (a stock or a sector)', () => {
    expect(checkOrder({ symbol: '9999', side: 'buy', qty: 1, limitPrice: 10 }, ctx()).verdict).toBe('veto');
    expect(checkOrder({ symbol: '1120', side: 'buy', qty: 1, limitPrice: 88 }, ctx({ excluded: ['banks'] })).verdict).toBe('veto');
    expect(checkOrder({ symbol: '2222', side: 'buy', qty: 1, limitPrice: 27.4 }, ctx({ excluded: ['2222'] })).verdict).toBe('veto');
  });

  it('makes a buy smaller to fit the per-order, per-stock and per-sector limits, never bigger', () => {
    const v = checkOrder({ symbol: '2222', side: 'buy', qty: 1_000, limitPrice: 27.4 }, ctx());
    expect(v.verdict).toBe('resize');
    expect(v.qty * v.limitPrice).toBeLessThanOrEqual(DEFAULT_LIMITS.maxOrder);
    // Already 30,000 SAR in banks (35% of 100,000 allowed): only about 5,000 more.
    const book = newBook(70_000, OPEN);
    book.positions.push({ symbol: '1120', qty: 340, avgCost: 88 });
    const s = checkOrder({ symbol: '1180', side: 'buy', qty: 250, limitPrice: 36 }, ctx({ book }));
    expect(s.verdict).toBe('resize');
    expect(s.qty * 36 + 340 * 88).toBeLessThanOrEqual(35_000);
  });

  it('never sells more than is held (no short selling)', () => {
    const book = newBook(0, OPEN);
    book.positions.push({ symbol: '2222', qty: 40, avgCost: 27 });
    expect(checkOrder({ symbol: '2222', side: 'sell', qty: 100, limitPrice: 27.4 }, ctx({ book }))).toMatchObject({ verdict: 'resize', qty: 40 });
    expect(checkOrder({ symbol: '1120', side: 'sell', qty: 1, limitPrice: 88 }, ctx({ book })).verdict).toBe('veto');
  });

  it('keeps the price inside the day’s ±10% band and close to the market', () => {
    const v = checkOrder({ symbol: '2222', side: 'buy', qty: 1, limitPrice: 40 }, ctx());
    expect(v.limitPrice).toBeLessThanOrEqual(27.4 * 1.01);
    const capped = checkOrder({ symbol: '2222', side: 'buy', qty: 1, limitPrice: 40 }, ctx({ quotes: new Map([['2222', quote('2222', 30.5, 27.4)]]) }));
    expect(capped.limitPrice).toBeLessThanOrEqual(27.4 * 1.1);
  });

  it('stops at the day’s order limit and while an order for the same stock is open', () => {
    expect(checkOrder({ symbol: '2222', side: 'buy', qty: 1, limitPrice: 27.4 }, ctx({ ordersToday: 8 })).verdict).toBe('veto');
    const open = [{ id: 'o', decisionId: 'd', symbol: '2222', side: 'buy' as const, qty: 1, limitPrice: 27.4, status: 'sent' as const, mode: 'paper' as const, createdAt: '', expiresAt: '', filledQty: 0 }];
    expect(checkOrder({ symbol: '2222', side: 'buy', qty: 1, limitPrice: 27.4 }, ctx({ openOrders: open })).verdict).toBe('veto');
  });
});

describe('the event log', () => {
  it('numbers every event in order, stamps it with the server’s time, and tells the live screens', () => {
    const heard: number[] = [];
    onTradeEvent((e) => heard.push(e.id));
    const a = emit('agent.observation', 'technical', 'one', {}, OPEN);
    const b = emit('agent.observation', 'news', 'two');
    expect(b.id).toBe(a.id + 1);
    expect(a.ts).toBe(OPEN.toISOString());
    expect(heard).toEqual([a.id, b.id]);
    expect(eventsSince(a.id).map((e) => e.text)).toEqual(['two']);
    expect(trading.events).toHaveLength(2);
  });
});

describe('the technical readings', () => {
  const flat = Array.from({ length: 60 }, () => 20);
  it('measures the usual daily move', () => {
    expect(dailyVolatility(flat)).toBe(0);
    // Up 2%, down 2%, and so on: about 2% a day.
    const zig = Array.from({ length: 30 }, (_, i) => 20 * (i % 2 ? 1.02 : 1));
    expect(dailyVolatility(zig)).toBeCloseTo(1.98, 1);
    expect(dailyVolatility([20, 21])).toBeUndefined();
  });

  it('reads the short trend and the strength against the index without changing the score', () => {
    const rising = Array.from({ length: 60 }, (_, i) => 20 + i * 0.1);
    const plain = readStock('2222', rising, rising.map(() => 1000), 26.2, 25.9);
    const withIndex = readStock('2222', rising, rising.map(() => 1000), 26.2, 25.9, Array.from({ length: 61 }, () => 11_000));
    expect(withIndex.score).toBe(plain.score);
    expect(withIndex.trendShort).toBe('up');
    expect(plain.relStrength).toBeUndefined();
    expect(withIndex.relStrength).toBeGreaterThan(5); // the stock rose about 8% in 20 days, the index stood still
    expect(withIndex.volatilityPct).toBeGreaterThan(0);
  });
});
