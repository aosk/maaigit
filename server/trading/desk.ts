import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * «أسهمي» runs one trading desk per market: Tadawul (sa) and the US (us). Each desk has its own book, orders, log,
 * limits, prices, clock and agents' memory, so nothing on one can touch the other: a US loss never counts against the
 * Saudi limits, and stopping one desk leaves the other running.
 *
 * The trading code is written once. Which desk it works on comes from the context it runs in: a round, a timer or an
 * API request is started with `inDesk('us', …)`, and everything it calls (across awaits too) reads and writes that
 * desk's data. Code run outside any desk works on Tadawul, as it always did.
 */

export type DeskId = 'sa' | 'us' | 'crypto';
export const DESKS: DeskId[] = ['sa', 'us', 'crypto'];

const als = new AsyncLocalStorage<DeskId>();

export const deskId = (): DeskId => als.getStore() ?? 'sa';

/** Runs `fn` (and everything it starts, timers and awaits included) on one desk. */
export const inDesk = <T>(id: DeskId, fn: () => T): T => als.run(id, fn);

/** A value kept once per desk, made on first use: call it for the desk in use, or `.of(id)` for a given one. */
export function perDesk<T>(make: (id: DeskId) => T): (() => T) & { of: (id: DeskId) => T } {
  const made = new Map<DeskId, T>();
  const of = (id: DeskId) => {
    if (!made.has(id)) made.set(id, make(id));
    return made.get(id)!;
  };
  return Object.assign(() => of(deskId()), { of });
}

export interface DeskConfig {
  id: DeskId;
  currency: 'SAR' | 'USD';
  /** How amounts are written in the Arabic log. */
  money: (n: number) => string;
  marketEn: string;
  marketAr: string;
  /** Yahoo Finance ticker for a symbol, and for the market's index. */
  yahoo: (symbol: string) => string;
  indexTicker: string;
  indexAr: string;
  indexEn: string;
  /** Whether real money is possible here (a broker is connected): the US desk is paper only for now. */
  liveAllowed: boolean;
  /** Saudi-only parts: substantial shareholders and the exchange's announcements pages. */
  saudi: boolean;
  /** The sectors the news agent may name for this market. */
  sectors: string[];
  /** Whether stocks here are a halal-screened list (shown on the screen and told to the agents). */
  halalList: boolean;
  /** Fractions of a unit can be bought (crypto), rather than whole shares. */
  fractional: boolean;
  /** How often the news agent runs (it costs web searches). */
  newsEveryMs: number;
  /** The plain rule's exits, in percent from the average cost: a stop loss (negative) and a profit target. */
  stopPct: number;
  takePct: number;
}

const SAR = (n: number) => `${n.toFixed(2)} ر.س`;
const USD = (n: number) => `$${n.toFixed(2)}`;

const CONFIGS: Record<DeskId, DeskConfig> = {
  sa: {
    id: 'sa',
    currency: 'SAR',
    money: SAR,
    marketEn: 'Saudi stock (Tadawul)',
    marketAr: 'تداول السعودية',
    yahoo: (s) => `${s}.SR`,
    indexTicker: '%5ETASI.SR',
    indexAr: 'تاسي',
    indexEn: 'TASI',
    liveAllowed: true,
    saudi: true,
    sectors: ['energy', 'banks', 'materials', 'telecom', 'utilities', 'food', 'retail', 'health', 'industrials'],
    halalList: false,
    fractional: false,
    newsEveryMs: 60 * 60_000,
    stopPct: -4,
    takePct: 6,
  },
  us: {
    id: 'us',
    currency: 'USD',
    money: USD,
    marketEn: 'US stock and ETF (NYSE/Nasdaq)',
    marketAr: 'السوق الأمريكي',
    yahoo: (s) => s,
    indexTicker: '%5EGSPC',
    indexAr: 'S&P 500',
    indexEn: 'S&P 500',
    liveAllowed: false,
    saudi: false,
    sectors: ['tech', 'health', 'energy', 'consumer', 'halal-etf', 'sukuk', 'real-estate'],
    halalList: true,
    fractional: false,
    newsEveryMs: 60 * 60_000,
    stopPct: -4,
    takePct: 6,
  },
  crypto: {
    id: 'crypto',
    currency: 'USD',
    money: USD,
    marketEn: 'cryptocurrency (open around the clock)',
    marketAr: 'العملات الرقمية',
    yahoo: (s) => `${s}-USD`,
    indexTicker: 'BTC-USD',
    indexAr: 'بيتكوين',
    indexEn: 'Bitcoin',
    liveAllowed: false,
    saudi: false,
    sectors: ['bitcoin', 'layer1', 'payments', 'infrastructure'],
    halalList: false,
    fractional: true,
    // Around the clock: every 6 hours, so the news does not run up the bill (the plain rule decides here, and it does not read the news).
    newsEveryMs: 6 * 60 * 60_000,
    // Coins swing more than stocks: a -4% stop would sell on an ordinary day's move.
    stopPct: -8,
    takePct: 12,
  },
};

export const deskConfig = (): DeskConfig => CONFIGS[deskId()];

/** «سهم» on the stock desks; nothing on the crypto desk ("0.05 إيثيريوم"), where coins are not shares. */
export const unitAr = () => (deskId() === 'crypto' ? '' : ' سهم');
