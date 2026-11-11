import type { Benchmark, ReplayResult } from '../../shared/trading.js';
import { ruleBased, RULE_VERSION } from './agents.js';
import { deskConfig } from './desk.js';
import { readStock } from './indicators.js';
import { currentIndex, dailyBars, type DailyBars } from './market.js';
import { bookValue, round2 } from './portfolio.js';
import { saveTrading, trading } from './store.js';
import { feeRate, tradingDay, units, UNIVERSE } from './tadawul.js';

/**
 * Measuring the desk against simply holding its index, two ways.
 *
 * The benchmark: one point a trading day (the book's value and the index), so the desk's return since it started
 * can be set beside the index's over the same days.
 *
 * The replay: the plain momentum rule, exactly as it runs, walked over about two years of daily prices. Each day it
 * sees only that day's close and what came before, and its orders fill at the NEXT day's close with the desk's fee,
 * so nothing is decided with hindsight. It answers one question: has the rule itself beaten holding the index? It is
 * daily (the live desk looks every 15 minutes), it replays the rule and not Claude's judgement, and it uses today's
 * list of stocks, which flatters the past a little. A guide, not a promise.
 */

const KEEP_DAYS = 800;
/** Bars a stock needs behind it before the rule reads it (its slow average). */
const WARM_UP = 51;

/** Notes today's point for the benchmark (the last point of the day replaces the earlier ones). */
export function noteBenchmark(prices: Map<string, number>, now = new Date()): void {
  const index = currentIndex()?.value;
  if (!(index && index > 0)) return;
  const day = tradingDay(now);
  const track = (trading.track ??= []);
  const point = { day, value: bookValue(trading.books[trading.mode], prices), index };
  if (track.at(-1)?.day === day) track[track.length - 1] = point;
  else track.push(point);
  if (track.length > KEEP_DAYS) track.splice(0, track.length - KEEP_DAYS);
}

/**
 * Money added to or taken from the book (a change of capital) is not performance: the earlier points are scaled so
 * that every day's return so far stays what it was, and the line carries on from the new value without a jump.
 */
export function rebaseBenchmark(delta: number): void {
  const track = trading.track;
  const last = track?.at(-1);
  if (!track || !last || !(last.value > 0) || !(last.value + delta > 0)) return;
  const factor = (last.value + delta) / last.value;
  for (const p of track) p.value = round2(p.value * factor);
}

const pctOf = (now: number, then: number) => (then > 0 ? round2((now / then - 1) * 100) : 0);

/** The desk against its index since the first day noted. */
export function benchmarkView(): Benchmark | null {
  const track = trading.track ?? [];
  if (track.length === 0) return null;
  const first = track[0];
  const last = track[track.length - 1];
  return {
    since: first.day,
    days: track.length,
    deskPct: pctOf(last.value, first.value),
    indexPct: pctOf(last.index, first.index),
    points: track.map((p) => ({ day: p.day, desk: round2((p.value / first.value) * 100), index: round2((p.index / first.index) * 100) })),
  };
}

/** Walks the plain rule over the bars given (the list's stocks and the index); pure, for the tests. */
export function replayRule(bars: Map<string, DailyBars>, index: DailyBars): Omit<ReplayResult, 'ranAt'> {
  const { stopPct, takePct } = deskConfig();
  const capital = trading.limits.capital;
  const fee = feeRate();
  const at = new Map([...bars].map(([symbol, b]) => [symbol, new Map(b.days.map((d, i) => [d, i]))]));
  let cash = capital;
  const held = new Map<string, { qty: number; avgCost: number }>();
  const last = new Map<string, number>();
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let peak = capital;
  let maxDrawdown = 0;
  let pending: { symbol: string; side: 'buy' | 'sell' }[] = [];
  const curve: ReplayResult['curve'] = [];
  const start = Math.min(WARM_UP, index.days.length - 1);

  for (let d = start; d < index.days.length; d++) {
    const day = index.days[d];
    const priceToday = (symbol: string) => {
      const i = at.get(symbol)?.get(day);
      return i === undefined ? undefined : bars.get(symbol)!.closes[i];
    };
    // Yesterday's decisions fill at today's close.
    for (const o of pending) {
      const price = priceToday(o.symbol);
      if (!price) continue;
      const pos = held.get(o.symbol);
      if (o.side === 'sell' && pos) {
        const value = pos.qty * price;
        const profit = (price - pos.avgCost) * pos.qty - value * fee;
        cash += value - value * fee;
        held.delete(o.symbol);
        trades++;
        if (profit >= 0) wins++;
        else losses++;
      } else if (o.side === 'buy' && !pos) {
        const room = Math.min(cash / (1 + fee), trading.limits.maxOrder, (capital * trading.limits.maxPerSymbolPct) / 100);
        const qty = units(room / price);
        if (qty > 0 && qty * price >= 1) {
          const value = qty * price;
          cash -= value + value * fee;
          held.set(o.symbol, { qty, avgCost: (value + value * fee) / qty });
          trades++;
        }
      }
    }
    // Today's read, from today's close and the days before it only.
    const reads = [];
    for (const [symbol, b] of bars) {
      const i = at.get(symbol)!.get(day);
      if (i === undefined) continue;
      last.set(symbol, b.closes[i]);
      if (i < WARM_UP) continue;
      reads.push(readStock(symbol, b.closes.slice(Math.max(0, i - 90), i), b.volumes.slice(Math.max(0, i - 90), i), b.closes[i], b.closes[i - 1]));
    }
    const positions = [...held].map(([symbol, p]) => {
      const price = last.get(symbol) ?? p.avgCost;
      return { symbol, qty: p.qty, price, pnlPct: ((price - p.avgCost) / p.avgCost) * 100 };
    });
    pending = ruleBased(reads, positions, cash).decisions.map((x) => ({ symbol: x.symbol, side: x.side }));
    const value = cash + positions.reduce((sum, p) => sum + p.qty * p.price, 0);
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, (1 - value / peak) * 100);
    // About a point a week is plenty for the chart.
    if ((d - start) % 5 === 0 || d === index.days.length - 1) curve.push({ day, rule: round2((value / capital) * 100), index: round2((index.closes[d] / index.closes[start]) * 100) });
  }
  const end = curve.at(-1);
  return {
    from: index.days[start] ?? '',
    to: index.days.at(-1) ?? '',
    days: Math.max(0, index.days.length - start),
    symbols: bars.size,
    rule: RULE_VERSION,
    stopPct,
    takePct,
    rulePct: end ? round2(end.rule - 100) : 0,
    indexPct: end ? round2(end.index - 100) : 0,
    maxDrawdownPct: round2(maxDrawdown),
    trades,
    wins,
    losses,
    curve,
  };
}

/** Reads two years of daily prices for the desk's list and its index, replays the rule, and keeps the result. */
export async function runReplay(now = new Date(), fetcher: typeof fetch = fetch): Promise<ReplayResult> {
  const index = await dailyBars({ index: true }, '2y', fetcher);
  if (index.days.length < WARM_UP + 20) throw new Error('Not enough index history to replay.');
  const bars = new Map<string, DailyBars>();
  // A few at a time: forty requests at once would be turned away.
  for (let i = 0; i < UNIVERSE.length; i += 6) {
    await Promise.all(
      UNIVERSE.slice(i, i + 6).map(async ({ symbol }) => {
        try {
          const b = await dailyBars(symbol, '2y', fetcher);
          if (b.days.length > WARM_UP) bars.set(symbol, b);
        } catch (error) {
          console.error(`StockSmart replay: no history for ${symbol} (${(error as Error).message})`);
        }
      }),
    );
  }
  if (bars.size === 0) throw new Error('No price history could be read.');
  const result: ReplayResult = { ranAt: now.toISOString(), ...replayRule(bars, index) };
  trading.replay = result;
  saveTrading();
  return result;
}

export const latestReplay = (): ReplayResult | null => trading.replay ?? null;
