import type { Position, Side } from '../../shared/trading.js';
import type { Book } from './store.js';
import { feeRate, tradingDay } from './tadawul.js';

/** What a book is worth at these prices (a stock without a price counts at what it cost). */
export function bookValue(book: Book, prices: Map<string, number>): number {
  return round2(book.cash + book.positions.reduce((sum, p) => sum + p.qty * (prices.get(p.symbol) ?? p.avgCost), 0));
}

/** The money in stocks, at cost, by symbol and in all. */
export function exposure(positions: Position[], prices: Map<string, number>): { total: number; bySymbol: Map<string, number> } {
  const bySymbol = new Map<string, number>();
  for (const p of positions) bySymbol.set(p.symbol, p.qty * (prices.get(p.symbol) ?? p.avgCost));
  return { total: [...bySymbol.values()].reduce((a, b) => a + b, 0), bySymbol };
}

const fee = (value: number) => round2(value * feeRate());

/** Books a fill: cash, the position's average cost, and the profit a sale takes. Returns that profit (0 for a buy). */
export function applyFill(book: Book, side: Side, symbol: string, qty: number, price: number): number {
  const value = qty * price;
  const cost = fee(value);
  const held = book.positions.find((p) => p.symbol === symbol);
  if (side === 'buy') {
    book.cash = round2(book.cash - value - cost);
    if (held) {
      held.avgCost = round4((held.qty * held.avgCost + value + cost) / (held.qty + qty));
      held.qty = whole(held.qty + qty);
    } else book.positions.push({ symbol, qty, avgCost: round4((value + cost) / qty) });
    return 0;
  }
  // Fractions of a coin are held to a millionth: without the tolerance, 0.3 − 0.1 leaves 0.19999999999999998 and "sell 0.2" fails.
  if (!held || held.qty + 1e-9 < qty) throw new Error(`Cannot sell ${qty} ${symbol}: only ${held?.qty ?? 0} held.`);
  const profit = round2((price - held.avgCost) * qty - cost);
  book.cash = round2(book.cash + value - cost);
  held.qty = whole(held.qty - qty);
  if (held.qty < 1e-6) book.positions = book.positions.filter((p) => p !== held);
  book.realized = round2(book.realized + profit);
  return profit;
}

/** A new trading day starts the day's profit or loss (and its chart) from the book's value now. */
export function rollDay(book: Book, prices: Map<string, number>, now: Date): void {
  const day = tradingDay(now);
  if (book.dayStart.day === day) return;
  book.dayStart = { day, value: bookValue(book, prices), realized: book.realized };
  book.curve = [];
}

/** Today's profit or loss, and the point to add to today's chart. */
export function dayPnl(book: Book, prices: Map<string, number>): number {
  return round2(bookValue(book, prices) - book.dayStart.value);
}

/** A quantity to a millionth, so adding and taking fractions never leaves float dust behind. */
const whole = (q: number) => Math.round(q * 1e6) / 1e6;
export const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
