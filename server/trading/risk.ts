import { deskConfig } from './desk.js';
import type { Instrument, MarketClock, Quote, Side, TradeLimits, TradeOrder } from '../../shared/trading.js';
import type { Book } from './store.js';
import { band, onTick, units } from './tadawul.js';
import { exposure } from './portfolio.js';

/**
 * The risk gate: plain code, not AI, and the only way an agent's decision becomes an order. It applies the user's
 * limits and the market's rules, and either passes the order, makes it smaller, or stops it. It can never make an
 * order bigger or start one by itself.
 */

export interface Proposal {
  symbol: string;
  side: Side;
  qty: number;
  limitPrice: number;
}

export interface RiskContext {
  limits: TradeLimits;
  book: Book;
  quotes: Map<string, Quote>;
  universe: Instrument[];
  excluded: string[];
  halted: boolean;
  clock: MarketClock;
  /** Real money: prices must come from SNB itself, fresh. */
  live?: boolean;
  /** Caution mode: new buys at half the per-order limit, and none in these sectors. */
  caution?: { sectors: string[] };
  /** From the calendar (confirmed events only): stocks with results today or on the next trading day (no new buys), and a market-wide event today (half-size buys). */
  blackout?: { symbols: Record<string, string>; market?: string };
  /** Each stock's usual daily move in % (see indicators.ts): the more volatile, the smaller the order. */
  volatility?: Map<string, number>;
  /** The daily move a full-size order is meant for (2% for stocks, 4% for coins). */
  calmVolatility?: number;
  ordersToday: number;
  openOrders: TradeOrder[];
  now: Date;
}

export interface Verdict {
  verdict: 'pass' | 'resize' | 'veto';
  qty: number;
  limitPrice: number;
  /** Why, one short reason per rule that acted, in English (the screen translates the kind). */
  reasons: string[];
}

/** A price older than this is not traded on (delayed feeds run about 15 minutes behind). */
export const STALE_QUOTE_MS = 40 * 60_000;
/** Real money is priced only from SNB's own screen, read by the bot within this (never from the delayed feed). */
const LIVE_QUOTE_MS = 2 * 60_000;
/** No new positions this close to the close (sales to reduce are still allowed). */
const NO_NEW_POSITIONS_MIN = 20;
/** A buy may not chase more than 1% above the price, nor a sale undercut it by more. */
const CHASE = 0.01;

export function checkOrder(p: Proposal, ctx: RiskContext): Verdict {
  const veto = (reason: string): Verdict => ({ verdict: 'veto', qty: 0, limitPrice: p.limitPrice, reasons: [reason] });
  if (ctx.halted) return veto('Trading is halted.');
  if (!ctx.clock.open) return veto('The market is closed.');
  const stock = ctx.universe.find((i) => i.symbol === p.symbol);
  if (!stock) return veto(`${p.symbol} is not in the list of stocks the agents may trade.`);
  if (ctx.excluded.includes(p.symbol) || ctx.excluded.includes(stock.sector)) return veto(`${p.symbol} is excluded by your instruction.`);
  const fractional = deskConfig().fractional;
  if (!(p.qty > 0) || units(p.qty) !== p.qty || (!fractional && p.qty < 1)) return veto(fractional ? 'The amount is not a valid quantity.' : 'The quantity is not a whole number of shares.');
  const quote = ctx.quotes.get(p.symbol);
  if (!quote || ctx.now.getTime() - Date.parse(quote.asOf) > STALE_QUOTE_MS) return veto(`No fresh price for ${p.symbol}.`);
  if (ctx.live && (quote.source !== 'bot' || ctx.now.getTime() - Date.parse(quote.asOf) > LIVE_QUOTE_MS)) return veto(`No live Broker price for ${p.symbol} in the last 2 minutes.`);
  if (p.side === 'buy' && ctx.clock.minutesToChange <= NO_NEW_POSITIONS_MIN) return veto('No new positions in the last 20 minutes before the close.');
  if (p.side === 'buy' && ctx.caution?.sectors.includes(stock.sector)) return veto(`Caution mode: no new buys in the ${stock.sector} sector.`);
  if (p.side === 'buy' && ctx.blackout?.symbols[p.symbol]) return veto(`Results on ${ctx.blackout.symbols[p.symbol]}: no new buys the day before and the day of.`);
  if (ctx.ordersToday >= ctx.limits.maxOrdersPerDay) return veto(`Today's limit of ${ctx.limits.maxOrdersPerDay} orders is used up.`);
  if (ctx.openOrders.some((o) => o.symbol === p.symbol)) return veto(`An order for ${p.symbol} is still open.`);

  // The limit price: on the tick grid, inside the day's band, and close to the market.
  const { low, high } = band(quote.prevClose);
  const cap = p.side === 'buy' ? quote.price * (1 + CHASE) : quote.price * (1 - CHASE);
  const wanted = Math.min(high, Math.max(low, p.side === 'buy' ? Math.min(p.limitPrice, cap) : Math.max(p.limitPrice, cap)));
  // Rounded onto the tick grid toward the market (so it can fill), unless that would pass the chase limit or the band.
  const toward = onTick(wanted, p.side === 'buy' ? 'sell' : 'buy');
  const inside = p.side === 'buy' ? toward <= Math.min(cap, high) + 1e-9 : toward >= Math.max(cap, low) - 1e-9;
  const limitPrice = inside ? toward : onTick(wanted, p.side);
  if (limitPrice < low - 1e-9 || limitPrice > high + 1e-9 || limitPrice <= 0) return veto('The price is outside the day\'s allowed range.');

  const reasons: string[] = [];
  let qty = p.qty;
  const cut = (most: number, reason: string) => {
    const allowed = Math.max(0, units(most));
    if (allowed < qty) {
      qty = allowed;
      reasons.push(reason);
    }
  };

  if (p.side === 'sell') {
    // No selling what is not held (no short selling), counting sales already on the way.
    const held = ctx.book.positions.find((x) => x.symbol === p.symbol)?.qty ?? 0;
    cut(held, `Only ${held} shares of ${p.symbol} are held.`);
  } else {
    const prices = new Map([...ctx.quotes].map(([s, q]) => [s, q.price]));
    const reserved = ctx.openOrders.filter((o) => o.side === 'buy').reduce((sum, o) => sum + (o.qty - o.filledQty) * o.limitPrice, 0);
    const { total, bySymbol } = exposure(ctx.book.positions, prices);
    const sectorOf = (symbol: string) => ctx.universe.find((i) => i.symbol === symbol)?.sector;
    // Buys still waiting in the same sector count too, or several in one round could pass the limit together.
    const sectorReserved = ctx.openOrders.filter((o) => o.side === 'buy' && sectorOf(o.symbol) === stock.sector).reduce((sum, o) => sum + (o.qty - o.filledQty) * o.limitPrice, 0);
    const sectorNow = ctx.book.positions.filter((x) => sectorOf(x.symbol) === stock.sector).reduce((sum, x) => sum + (bySymbol.get(x.symbol) ?? 0), 0) + sectorReserved;
    const price = limitPrice * 1.002; // with fees
    cut(ctx.limits.maxOrder / price, `Reduced to the ${ctx.limits.maxOrder} ${deskConfig().currency} limit per order.`);
    if (ctx.caution) cut(ctx.limits.maxOrder / 2 / price, 'Caution mode: half the per-order limit.');
    if (ctx.blackout?.market) cut(ctx.limits.maxOrder / 2 / price, 'Market event today: half the per-order limit.');
    // Sized by volatility: a stock that moves twice as much in a day gets half the order (never below half, never above the limit).
    const vol = ctx.volatility?.get(p.symbol);
    if (vol && ctx.calmVolatility && vol > ctx.calmVolatility) cut((ctx.limits.maxOrder * Math.max(0.5, ctx.calmVolatility / vol)) / price, `Volatile: it moves about ${vol.toFixed(1)}% a day, so the order is smaller.`);
    cut((ctx.book.cash - reserved) / price, 'Reduced to the cash available.');
    cut((ctx.limits.capital - total - reserved) / price, `Reduced to keep within the ${ctx.limits.capital} ${deskConfig().currency} you allowed.`);
    cut((ctx.limits.capital * ctx.limits.maxPerSymbolPct / 100 - (bySymbol.get(p.symbol) ?? 0)) / price, `Reduced to keep ${p.symbol} within ${ctx.limits.maxPerSymbolPct}% of the capital.`);
    cut((ctx.limits.capital * ctx.limits.maxPerSectorPct / 100 - sectorNow) / price, `Reduced to keep the ${stock.sector} sector within ${ctx.limits.maxPerSectorPct}% of the capital.`);
  }
  // Nothing left, or (in coins) less than a dollar's worth: not worth an order.
  if (fractional ? qty * limitPrice < 1 : qty < 1) return { verdict: 'veto', qty: 0, limitPrice, reasons: reasons.length ? reasons : ['Nothing left to trade after the limits.'] };
  return { verdict: qty < p.qty ? 'resize' : 'pass', qty, limitPrice, reasons };
}
