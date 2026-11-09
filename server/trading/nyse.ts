import type { Instrument, MarketClock } from '../../shared/trading.js';

/**
 * The US desk's market: the NYSE and Nasdaq regular session, 9:30 to 16:00 New York time, Monday to Friday, closed on
 * exchange holidays and closing at 13:00 on the early-close days. New York's clock moves with daylight saving, so
 * times are worked out in that time zone (16:30 to 23:00 Riyadh in summer, 17:30 to 00:00 in winter).
 *
 * Written 2026-11-09 from the NYSE's published calendar as generally known: VERIFY the dates at nyse.com before real
 * money; MAAI_NYSE_HOLIDAYS="2028-01-03,…" adds more.
 */

const ET = 'America/New_York';
const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const EARLY_CLOSE_MIN = 13 * 60;
/** Monday (1) to Friday (5). */
const TRADING_DAYS = new Set([1, 2, 3, 4, 5]);

const HOLIDAYS = [
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
];
/** The day after Thanksgiving and Christmas Eve (when a weekday) close at 13:00. */
const EARLY_CLOSES = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);

const holidays = () => new Set([...HOLIDAYS, ...(process.env.MAAI_NYSE_HOLIDAYS ?? '').split(',').map((d) => d.trim()).filter(Boolean)]);

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });

/** New York's calendar day, weekday and minute of the day. */
function newYork(now: Date): { date: string; weekday: number; minute: number } {
  const p = Object.fromEntries(fmt.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WEEKDAY[p.weekday], minute: Number(p.hour) * 60 + Number(p.minute) };
}

export const nyseDay = (now: Date) => newYork(now).date;

const closeOf = (date: string) => (EARLY_CLOSES.has(date) ? EARLY_CLOSE_MIN : CLOSE_MIN);
const isTradingDay = (date: string, weekday: number) => TRADING_DAYS.has(weekday) && !holidays().has(date);

export function nyseClock(now: Date): MarketClock {
  const { date, weekday, minute } = newYork(now);
  const today = isTradingDay(date, weekday);
  const close = closeOf(date);
  if (today && minute >= OPEN_MIN && minute < close) return { open: true, minutesToChange: close - minute, label: 'open' };
  // Minutes until the next open: whole days are counted in New York time, so a daylight-saving change is off by an hour at most.
  let wait = today && minute < OPEN_MIN ? OPEN_MIN - minute : 24 * 60 - minute + OPEN_MIN;
  for (let day = 1; !(today && minute < OPEN_MIN) && day < 15; day++) {
    const next = newYork(new Date(now.getTime() + day * 86_400_000));
    if (isTradingDay(next.date, next.weekday)) break;
    wait += 24 * 60;
  }
  return { open: false, minutesToChange: wait, label: !TRADING_DAYS.has(weekday) ? 'weekend' : holidays().has(date) ? 'holiday' : 'closed' };
}

/**
 * The US list, halal by the user's choice (checked 2026-11-09): the US-listed Shariah-compliant ETFs, and the largest
 * stocks held by SPUS (the S&P 500 Shariah ETF), which its Shariah board's screen already passed. Holdings change each
 * quarter: re-check against SP Funds' daily holdings file. Not financial advice.
 */
export const US_UNIVERSE: Instrument[] = [
  { symbol: 'SPUS', nameAr: 'إس بي يو إس (S&P 500 شرعي)', nameEn: 'SP Funds S&P 500 Sharia ETF', sector: 'halal-etf' },
  { symbol: 'HLAL', nameAr: 'واحد فوتسي أمريكا الشرعي', nameEn: 'Wahed FTSE USA Shariah ETF', sector: 'halal-etf' },
  { symbol: 'SPSK', nameAr: 'صكوك عالمية', nameEn: 'SP Funds Dow Jones Global Sukuk ETF', sector: 'sukuk' },
  { symbol: 'SPWO', nameAr: 'إس بي العالمي (عدا أمريكا)', nameEn: 'SP Funds S&P World ETF', sector: 'halal-etf' },
  { symbol: 'SPTE', nameAr: 'إس بي للتقنية العالمية', nameEn: 'SP Funds S&P Global Technology ETF', sector: 'halal-etf' },
  { symbol: 'UMMA', nameAr: 'واحد داو جونز الإسلامي العالمي', nameEn: 'Wahed Dow Jones Islamic World ETF', sector: 'halal-etf' },
  { symbol: 'SPRE', nameAr: 'إس بي للعقار الشرعي', nameEn: 'SP Funds S&P Global REIT Sharia ETF', sector: 'real-estate' },
  { symbol: 'MNZL', nameAr: 'منزل راسل الحلال', nameEn: 'Manzil Russell Halal USA Broad Market ETF', sector: 'halal-etf' },
  { symbol: 'NVDA', nameAr: 'إنفيديا', nameEn: 'NVIDIA', sector: 'tech' },
  { symbol: 'AAPL', nameAr: 'أبل', nameEn: 'Apple', sector: 'tech' },
  { symbol: 'MSFT', nameAr: 'مايكروسوفت', nameEn: 'Microsoft', sector: 'tech' },
  { symbol: 'GOOGL', nameAr: 'ألفابت (جوجل)', nameEn: 'Alphabet', sector: 'tech' },
  { symbol: 'AVGO', nameAr: 'برودكوم', nameEn: 'Broadcom', sector: 'tech' },
  { symbol: 'TSLA', nameAr: 'تسلا', nameEn: 'Tesla', sector: 'consumer' },
  { symbol: 'LLY', nameAr: 'إيلي ليلي', nameEn: 'Eli Lilly', sector: 'health' },
  { symbol: 'JNJ', nameAr: 'جونسون آند جونسون', nameEn: 'Johnson & Johnson', sector: 'health' },
  { symbol: 'XOM', nameAr: 'إكسون موبيل', nameEn: 'Exxon Mobil', sector: 'energy' },
  { symbol: 'HD', nameAr: 'هوم ديبو', nameEn: 'Home Depot', sector: 'consumer' },
  { symbol: 'PG', nameAr: 'بروكتر آند غامبل', nameEn: 'Procter & Gamble', sector: 'consumer' },
];

/** Simulated starting prices (development and tests only), in dollars. */
export const US_SIM_BASE: Record<string, number> = { SPUS: 48, HLAL: 56, SPSK: 18, SPWO: 26, SPTE: 32, UMMA: 27, SPRE: 21, MNZL: 25, NVDA: 180, AAPL: 230, MSFT: 480, GOOGL: 200, AVGO: 340, TSLA: 400, LLY: 780, JNJ: 175, XOM: 115, HD: 380, PG: 150 };
