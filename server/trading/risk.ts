import type { Instrument, MarketClock, Quote, Side, TradeLimits, TradeOrder } from '../../shared/trading.js';
import type { Book } from './store.js';
import { band, onTick } from './tadawul.js';
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
const STALE_QUOTE_MS = 40 * 60_000;
/** A buy may not chase more than 1% above the price, nor a sale undercut it by more. */
const CHASE = 0.01;

export function checkOrder(p: Proposal, ctx: RiskContext): Verdict {
  const veto = (reason: string): Verdict => ({ verdict: 'veto', qty: 0, limitPrice: p.limitPrice, reasons: [reason] });
  if (ctx.halted) return veto('Trading is halted.');
  if (!ctx.clock.open) return veto('The market is closed.');
  const stock = ctx.universe.find((i) => i.symbol === p.symbol);
  if (!stock) return veto(`${p.symbol} is not in the list of stocks the agents may trade.`);
  if (ctx.excluded.includes(p.symbol) || ctx.excluded.includes(stock.sector)) return veto(`${p.symbol} is excluded by your instruction.`);
  if (!Number.isInteger(p.qty) || p.qty < 1) return veto('The quantity is not a whole number of shares.');
  const quote = ctx.quotes.get(p.symbol);
  if (!quote || ctx.now.getTime() - Date.parse(quote.asOf) > STALE_QUOTE_MS) return veto(`No fresh price for ${p.symbol}.`);
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
    const allowed = Math.max(0, Math.floor(most + 1e-9));
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
    const sectorNow = ctx.book.positions.filter((x) => ctx.universe.find((i) => i.symbol === x.symbol)?.sector === stock.sector).reduce((sum, x) => sum + (bySymbol.get(x.symbol) ?? 0), 0);
    const price = limitPrice * 1.002; // with fees
    cut(ctx.limits.maxOrder / price, `Reduced to the ${ctx.limits.maxOrder} SAR limit per order.`);
    cut((ctx.book.cash - reserved) / price, 'Reduced to the cash available.');
    cut((ctx.limits.capital - total - reserved) / price, `Reduced to keep within the ${ctx.limits.capital} SAR you allowed.`);
    cut((ctx.limits.capital * ctx.limits.maxPerSymbolPct / 100 - (bySymbol.get(p.symbol) ?? 0)) / price, `Reduced to keep ${p.symbol} within ${ctx.limits.maxPerSymbolPct}% of the capital.`);
    cut((ctx.limits.capital * ctx.limits.maxPerSectorPct / 100 - sectorNow) / price, `Reduced to keep the ${stock.sector} sector within ${ctx.limits.maxPerSectorPct}% of the capital.`);
  }
  if (qty < 1) return { verdict: 'veto', qty: 0, limitPrice, reasons: reasons.length ? reasons : ['Nothing left to trade after the limits.'] };
  return { verdict: qty < p.qty ? 'resize' : 'pass', qty, limitPrice, reasons };
}
