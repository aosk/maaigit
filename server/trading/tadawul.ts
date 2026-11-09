import type { Instrument, MarketClock } from '../../shared/trading.js';
import { deskId } from './desk.js';
import { nyseClock, nyseDay, US_UNIVERSE } from './nyse.js';

/**
 * The Tadawul Main Market rules StockSmart works by, in one dated place. Written 2026-11-04 from general knowledge:
 * VERIFY each value against the current Saudi Exchange rulebook (saudiexchange.sa) before trading real money — they
 * change, and a stale constant here means refused or wrong-sized orders. Nomu (the parallel market) is not covered.
 */
/** Riyadh has no daylight saving: always UTC+3. */
const RIYADH_OFFSET_MIN = 180;
/** Continuous trading, Riyadh time (the auctions before and after are left alone). */
const OPEN_MIN = 10 * 60;
const CLOSE_MIN = 15 * 60;
/** Sunday (0) to Thursday (4). */
const TRADING_DAYS = new Set([0, 1, 2, 3, 4]);
/** The daily price limit around the previous close. */
const PRICE_BAND = 0.1;

/** Market holidays (Eid and national days move each year): set MAAI_TADAWUL_HOLIDAYS="2027-03-20,2027-03-21,…". */
const holidays = () => new Set((process.env.MAAI_TADAWUL_HOLIDAYS ?? '').split(',').map((d) => d.trim()).filter(Boolean));

/** The tick size for a price (verify the current band table). */
function tickFor(price: number): number {
  if (price < 10) return 0.01;
  if (price < 25) return 0.02;
  if (price < 50) return 0.05;
  if (price < 100) return 0.1;
  if (price < 250) return 0.2;
  if (price < 500) return 0.5;
  return 1;
}

/** A price on the tick grid: down for a buy limit, up for a sell, so rounding never makes an order worse for us. */
export function onTick(price: number, side: 'buy' | 'sell'): number {
  // US stocks and ETFs above $1 trade in cents.
  const tick = deskId() === 'us' ? 0.01 : tickFor(price);
  const steps = side === 'buy' ? Math.floor(price / tick + 1e-9) : Math.ceil(price / tick - 1e-9);
  return Math.round(steps * tick * 100) / 100;
}

/** The day's allowed range around the previous close. */
// The US has no daily price limit (its pauses are per stock and short): a wide range keeps limit orders sane.
export const band = (prevClose: number) => (deskId() === 'us' ? { low: prevClose * 0.5, high: prevClose * 1.5 } : { low: prevClose * (1 - PRICE_BAND), high: prevClose * (1 + PRICE_BAND) });

/** Riyadh's calendar day and minute of the day. */
export function riyadh(now: Date): { date: string; weekday: number; minute: number } {
  const t = new Date(now.getTime() + RIYADH_OFFSET_MIN * 60_000);
  return { date: t.toISOString().slice(0, 10), weekday: t.getUTCDay(), minute: t.getUTCHours() * 60 + t.getUTCMinutes() };
}

/** Today's trading day in Riyadh, the key for daily counts. */
export const tradingDay = (now: Date) => (deskId() === 'us' ? nyseDay(now) : riyadh(now).date);

/** Whether the market is open, and how long until that changes. */
export function marketClock(now: Date): MarketClock {
  if (deskId() === 'us') return nyseClock(now);
  const { date, weekday, minute } = riyadh(now);
  const tradingDayToday = TRADING_DAYS.has(weekday) && !holidays().has(date);
  if (tradingDayToday && minute >= OPEN_MIN && minute < CLOSE_MIN) return { open: true, minutesToChange: CLOSE_MIN - minute, label: 'open' };
  // Minutes until the next open, skipping weekends and holidays.
  let wait = tradingDayToday && minute < OPEN_MIN ? OPEN_MIN - minute : 24 * 60 - minute + OPEN_MIN;
  for (let day = 1; !(tradingDayToday && minute < OPEN_MIN) && day < 15; day++) {
    const next = riyadh(new Date(now.getTime() + day * 86_400_000));
    if (TRADING_DAYS.has(next.weekday) && !holidays().has(next.date)) break;
    wait += 24 * 60;
  }
  return { open: false, minutesToChange: wait, label: !TRADING_DAYS.has(weekday) ? 'weekend' : holidays().has(date) ? 'holiday' : 'closed' };
}

/** The stocks the agents may trade: large, liquid Main Market names. Codes and sectors to verify. */
const SA_UNIVERSE: Instrument[] = [
  { symbol: '2222', nameAr: 'أرامكو السعودية', nameEn: 'Saudi Aramco', sector: 'energy' },
  { symbol: '1120', nameAr: 'مصرف الراجحي', nameEn: 'Al Rajhi Bank', sector: 'banks' },
  { symbol: '1180', nameAr: 'البنك الأهلي السعودي', nameEn: 'Saudi National Bank', sector: 'banks' },
  { symbol: '1150', nameAr: 'مصرف الإنماء', nameEn: 'Alinma Bank', sector: 'banks' },
  { symbol: '1010', nameAr: 'بنك الرياض', nameEn: 'Riyad Bank', sector: 'banks' },
  { symbol: '2010', nameAr: 'سابك', nameEn: 'SABIC', sector: 'materials' },
  { symbol: '1211', nameAr: 'معادن', nameEn: "Ma'aden", sector: 'materials' },
  { symbol: '7010', nameAr: 'STC', nameEn: 'STC', sector: 'telecom' },
  { symbol: '7020', nameAr: 'موبايلي', nameEn: 'Mobily', sector: 'telecom' },
  { symbol: '2082', nameAr: 'أكوا باور', nameEn: 'ACWA Power', sector: 'utilities' },
  { symbol: '5110', nameAr: 'الكهرباء السعودية', nameEn: 'Saudi Electricity', sector: 'utilities' },
  { symbol: '2280', nameAr: 'المراعي', nameEn: 'Almarai', sector: 'food' },
  { symbol: '2050', nameAr: 'صافولا', nameEn: 'Savola', sector: 'food' },
  { symbol: '4190', nameAr: 'جرير', nameEn: 'Jarir', sector: 'retail' },
  { symbol: '4013', nameAr: 'سليمان الحبيب', nameEn: 'Dr. Sulaiman Al Habib', sector: 'health' },
  { symbol: '4002', nameAr: 'المواساة', nameEn: 'Mouwasat', sector: 'health' },
  { symbol: '4200', nameAr: 'الدريس', nameEn: 'Aldrees', sector: 'energy' },
  { symbol: '1212', nameAr: 'أسترا الصناعية', nameEn: 'Astra Industrial', sector: 'industrials' },
];

/** The followed list of the desk in use (Tadawul, or the US list). Reads like an array wherever it is used. */
const current = () => (deskId() === 'us' ? US_UNIVERSE : SA_UNIVERSE);
export const UNIVERSE: Instrument[] = new Proxy([] as Instrument[], {
  get: (_t, key) => {
    const list = current();
    const value = Reflect.get(list, key, list) as unknown;
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(list) : value;
  },
  has: (_t, key) => Reflect.has(current(), key),
  ownKeys: () => Reflect.ownKeys(current()),
  getOwnPropertyDescriptor: (_t, key) => {
    const d = Reflect.getOwnPropertyDescriptor(current(), key);
    return d ? { ...d, configurable: true } : undefined;
  },
});

export const instrument = (symbol: string) => current().find((i) => i.symbol === symbol);

/** Broker commission and VAT on each trade, as a share of its value (approximate: verify with SNB Capital's price list). */
const SA_FEE_RATE = 0.0016;
/** US brokers charge little or nothing per trade: a small allowance for spreads and fees. */
const US_FEE_RATE = 0.0005;
export const feeRate = () => (deskId() === 'us' ? US_FEE_RATE : SA_FEE_RATE);
