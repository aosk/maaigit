import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-replay',
    MAAI_DATA_FILE: '/tmp/claude-0/trading-replay/store.json',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-replay/trading.json',
    MAAI_TRADING_QUOTES: 'sim',
  });
});

import type { DailyBars } from './market';
import { refreshQuotes, resetQuotes } from './market';
import { benchmarkView, latestReplay, noteBenchmark, rebaseBenchmark, replayRule, runReplay } from './replay';
import { resetTrading, trading } from './store';

const SUN = new Date('2026-11-01T08:00:00Z');
/** `n` weekdays of bars from a price function. */
function bars(n: number, price: (i: number) => number): DailyBars {
  const out: DailyBars = { days: [], closes: [], volumes: [] };
  for (let i = 0; i < n; i++) {
    out.days.push(new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
    out.closes.push(Math.round(price(i) * 100) / 100);
    out.volumes.push(1_000_000);
  }
  return out;
}

/** A rise with a natural wobble (a perfectly smooth one reads as overbought, and the rule keeps out). */
const rising = (i: number) => 20 * 1.003 ** i * (1 + 0.02 * Math.sin(i / 1.7));

beforeEach(async () => {
  resetTrading();
  resetQuotes();
  await refreshQuotes(SUN);
});

describe('the replay of the plain rule', () => {
  it('buys a steadily rising stock, takes its profits, and beats a flat index', () => {
    const r = replayRule(new Map([['2222', bars(200, rising)]]), bars(200, () => 11_000));
    expect(r.trades).toBeGreaterThan(2);
    expect(r.wins).toBeGreaterThan(0);
    expect(r.rulePct).toBeGreaterThan(0);
    expect(r.indexPct).toBe(0);
    expect(r).toMatchObject({ symbols: 1, stopPct: -4, takePct: 6, days: 149 });
    expect(r.curve[0]).toMatchObject({ rule: 100, index: 100 });
  });

  it('stays out of a falling stock, and never spends more than the limits allow', () => {
    const falling = replayRule(new Map([['2222', bars(200, (i) => 40 * 0.997 ** i)]]), bars(200, (i) => 11_000 * 0.999 ** i));
    expect(falling).toMatchObject({ trades: 0, rulePct: 0 });
    expect(falling.indexPct).toBeLessThan(0);
    // One stock may take at most 20% of the capital (and 10,000 an order): a tenfold rise cannot move the book tenfold.
    const one = replayRule(new Map([['2222', bars(200, rising)]]), bars(200, () => 11_000));
    expect(one.rulePct).toBeLessThan(15);
  });

  it('fills at the next day, never on the day it decides', () => {
    // Flat, then one jump on the last day: whatever the rule decides that day cannot be filled, so nothing trades.
    const jump = replayRule(new Map([['2222', bars(120, (i) => (i === 119 ? 30 : 20))]]), bars(120, () => 11_000));
    expect(jump).toMatchObject({ trades: 0, rulePct: 0 });
  });

  it('reads history, replays, and keeps the result for the screen', async () => {
    const r = await runReplay(SUN);
    expect(r.symbols).toBe(18);
    expect(r.curve.length).toBeGreaterThan(20);
    expect(latestReplay()).toEqual(r);
    expect(trading.replay?.ranAt).toBe(SUN.toISOString());
  });
});

describe('the benchmark', () => {
  it('keeps one point a day and sets the desk beside its index', () => {
    expect(benchmarkView()).toBeNull();
    const prices = new Map<string, number>();
    noteBenchmark(prices, SUN);
    noteBenchmark(prices, new Date(SUN.getTime() + 3_600_000));
    expect(trading.track).toHaveLength(1);
    trading.books.paper.cash = 103_000;
    trading.track![0].index /= 1.01;
    noteBenchmark(prices, new Date(SUN.getTime() + 86_400_000));
    const b = benchmarkView()!;
    expect(b).toMatchObject({ since: '2026-11-01', days: 2, deskPct: 3 });
    expect(b.indexPct).toBeGreaterThan(0);
    expect(b.points[0]).toMatchObject({ desk: 100, index: 100 });
  });

  it('does not count money added to the book as performance', () => {
    const prices = new Map<string, number>();
    noteBenchmark(prices, SUN);
    trading.books.paper.cash = 102_000;
    noteBenchmark(prices, new Date(SUN.getTime() + 86_400_000));
    expect(benchmarkView()!.deskPct).toBe(2);
    // The owner doubles the capital: the desk is still up 2%, not 100%.
    trading.books.paper.cash += 100_000;
    rebaseBenchmark(100_000);
    noteBenchmark(prices, new Date(SUN.getTime() + 2 * 86_400_000));
    expect(benchmarkView()!.deskPct).toBeCloseTo(2, 1);
  });
});
