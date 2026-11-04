import type { TradingState } from '../../shared/trading.js';
import { client } from '../ai/claude.js';
import { alertTrade } from '../notify.js';
import { decisionRound, newsRound, technicalRound, type Decision } from './agents.js';
import { botStale, cancelAllOpen, halt, openOrders, processOrders, submit } from './executor.js';
import { currentQuotes, refreshQuotes } from './market.js';
import { bookValue, dayPnl, rollDay, round2 } from './portfolio.js';
import { checkOrder } from './risk.js';
import { emit, onTradeEvent, saveTrading, trading } from './store.js';
import { instrument, marketClock, tradingDay, UNIVERSE } from './tadawul.js';

/**
 * The desk's heartbeat, once a minute: prices every five minutes while the market is open, paper orders filled,
 * stale orders let go, today's chart and the daily loss limit checked, and a round of the agents every
 * `cycleMinutes`. A round reads, decides, and passes every decision through the risk gate; nothing else places orders.
 */

const QUOTES_EVERY_MS = 5 * 60_000;
const CURVE_EVERY_MS = 5 * 60_000;
/** No new orders this close to the close: they could not be placed and filled in time. */
const NO_NEW_ORDERS_MIN = 10;

let busy = false;
let lastQuotes = 0;
let lastRound = 0;
let lastCurve = 0;

const prices = () => new Map([...currentQuotes()].map(([s, q]) => [s, q.price]));

async function tick(now = new Date()): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const clock = marketClock(now);
    // Prices while the market is open, and once at start so the screen has something.
    if ((clock.open && now.getTime() - lastQuotes >= QUOTES_EVERY_MS) || currentQuotes().size === 0) {
      lastQuotes = now.getTime();
      await refreshQuotes(now);
    }
    for (const book of Object.values(trading.books)) rollDay(book, prices(), now);
    processOrders(now);
    if (clock.open && now.getTime() - lastCurve >= CURVE_EVERY_MS) {
      lastCurve = now.getTime();
      const book = trading.books[trading.mode];
      book.curve.push({ at: now.toISOString(), value: bookValue(book, prices()) });
      saveTrading();
    }
    checkDailyLoss(now);
    if (!clock.open && openOrders(trading.mode).length) cancelAllOpen('أقفل السوق', now);
    if (clock.open && !trading.halted && now.getTime() - lastRound >= trading.limits.cycleMinutes * 60_000) {
      lastRound = now.getTime();
      await round(now);
    }
  } catch (error) {
    console.error('StockSmart tick failed:', (error as Error).message);
  } finally {
    busy = false;
  }
}

let rounding = false;

/** One round of the agents; a round asked for while one is running is skipped (the route and the timer share it). */
export async function round(now = new Date()): Promise<void> {
  if (rounding) return;
  rounding = true;
  try {
    await runRound(now);
  } finally {
    rounding = false;
  }
}

async function runRound(now: Date): Promise<void> {
  const clock = marketClock(now);
  const reads = technicalRound(now);
  const news = await newsRound(now);
  if (clock.minutesToChange <= NO_NEW_ORDERS_MIN) {
    emit('agent.observation', 'risk', `باقي ${clock.minutesToChange} دقيقة على الإقفال: ما فيه أوامر جديدة اليوم`, {}, now);
    return;
  }
  for (const decision of await decisionRound(reads, news, clock.minutesToChange, now)) gate(decision, now);
}

/** The risk gate on one decision: its verdict goes on the log, and only a pass or a smaller order goes on. */
export function gate(d: Decision, now = new Date()): void {
  const clock = marketClock(now);
  const day = tradingDay(now);
  const verdict =
    trading.mode === 'live' && botStale(now.getTime())
      ? { verdict: 'veto' as const, qty: 0, limitPrice: d.limitPrice, reasons: ['The SNB bot is not connected.'] }
      : checkOrder(d, {
          limits: trading.limits,
          book: trading.books[trading.mode],
          quotes: currentQuotes(),
          universe: UNIVERSE,
          excluded: trading.excluded,
          halted: trading.halted,
          clock,
          ordersToday: trading.ordersToday.day === day ? trading.ordersToday.count : 0,
          openOrders: openOrders(trading.mode),
          now,
        });
  const name = instrument(d.symbol)?.nameAr ?? d.symbol;
  const why = verdict.reasons.map(arabicReason).join(' · ');
  const text =
    verdict.verdict === 'veto'
      ? `رفضت ${d.side === 'buy' ? 'شراء' : 'بيع'} ${name}: ${why}`
      : verdict.verdict === 'resize'
        ? `خفّضت الأمر إلى ${verdict.qty} سهم بحد ${verdict.limitPrice}: ${why}`
        : `وافقت: ${verdict.qty} سهم ${name} بحد ${verdict.limitPrice} ضمن كل الحدود`;
  emit('risk.verdict', 'risk', text, { correlationId: d.id, data: { verdict: verdict.verdict, qty: verdict.qty, reasons: verdict.reasons } }, now);
  if (verdict.verdict !== 'veto') submit(d.id, d.symbol, d.side, verdict.qty, verdict.limitPrice, now);
}

/** The risk gate's reasons in Arabic for the timeline (the English stays in the event's data). */
function arabicReason(reason: string): string {
  const rules: [RegExp, (m: RegExpMatchArray) => string][] = [
    [/halted/, () => 'التداول متوقف'],
    [/market is closed/, () => 'السوق مقفل'],
    [/not in the list/, () => 'السهم خارج القائمة المسموحة'],
    [/excluded/, () => 'مستبعد بتوجيهك'],
    [/whole number/, () => 'الكمية غير صحيحة'],
    [/No fresh price/, () => 'ما فيه سعر حديث'],
    [/orders is used up/, () => 'انتهى عدد أوامر اليوم'],
    [/still open/, () => 'فيه أمر مفتوح لنفس السهم'],
    [/allowed range/, () => 'السعر خارج النطاق اليومي ±١٠٪'],
    [/Only (\d+) shares/, (m) => `المملوك ${m[1]} سهم فقط`],
    [/per order/, () => 'حد قيمة الأمر'],
    [/cash available/, () => 'الكاش المتاح'],
    [/you allowed/, () => 'رأس المال المسموح'],
    [/within (\d+)% of the capital/, (m) => (reason.includes('sector') ? `حد القطاع ${m[1]}٪` : `حد السهم ${m[1]}٪`)],
    [/SNB bot is not connected/, () => 'بوت SNB غير متصل'],
    [/Nothing left/, () => 'ما بقي شي بعد تطبيق الحدود'],
  ];
  for (const [re, ar] of rules) {
    const m = reason.match(re);
    if (m) return ar(m);
  }
  return reason;
}

/** Losing the day's limit stops everything; only the user starts it again. */
export function checkDailyLoss(now = new Date()): void {
  if (trading.halted) return;
  const pnl = dayPnl(trading.books[trading.mode], prices());
  const most = (trading.limits.capital * trading.limits.dailyLossPct) / 100;
  if (pnl <= -most) {
    halt(`بلغت خسارة اليوم ${Math.abs(pnl).toFixed(2)} ر.س (الحد ${trading.limits.dailyLossPct}٪)`, 'risk', now);
    cancelAllOpen('توقّف التداول عند حد الخسارة اليومي', now);
  }
}

let timer: NodeJS.Timeout | undefined;
/** The events worth a notification on the phone. */
const TOLD = new Set(['order.filled', 'order.failed', 'system.halted', 'position.drift']);

export function startTrading(): void {
  if (timer) return;
  onTradeEvent((e) => {
    if (TOLD.has(e.type)) void alertTrade(`trade:${e.id}`, e.text).catch(() => {});
  });
  timer = setInterval(() => void tick(), 60_000);
  timer.unref();
  setTimeout(() => void tick(), 5_000).unref();
}

/** Everything the StockSmart screen shows, from the book of the current mode. */
export function tradingView(now = new Date()): TradingState {
  const book = trading.books[trading.mode];
  const quotes = currentQuotes();
  const p = prices();
  const value = bookValue(book, p);
  const day = dayPnl(book, p);
  const started = trading.mode === 'paper' ? trading.limits.capital : book.dayStart.value;
  const newest = [...quotes.values()].map((q) => q.asOf).sort().pop();
  return {
    mode: trading.mode,
    halted: trading.halted,
    haltReason: trading.haltReason,
    limits: trading.limits,
    universe: UNIVERSE,
    excluded: trading.excluded,
    directives: trading.directives,
    cash: book.cash,
    positions: book.positions.map((x) => ({ ...x, price: quotes.get(x.symbol)?.price, prevClose: quotes.get(x.symbol)?.prevClose })),
    dayPnl: day,
    dayPnlPct: trading.limits.capital ? round2((day / trading.limits.capital) * 100) : 0,
    totalPnl: round2(value - started),
    portfolioValue: value,
    ordersToday: trading.ordersToday.day === tradingDay(now) ? trading.ordersToday.count : 0,
    curve: book.curve,
    orders: trading.orders.slice(-40).reverse(),
    events: trading.events.slice(-150),
    agents: (['technical', 'news', 'decision', 'risk', 'executor'] as const).map((id) => ({ id, enabled: trading.agents[id]?.enabled !== false, lastRunAt: trading.agents[id]?.lastRunAt, lastError: trading.agents[id]?.lastError })),
    executor: { connected: Boolean(trading.bot.keyHash), keyHint: trading.bot.keyHint, lastSeen: trading.bot.lastSeen, brokerSession: Boolean(trading.bot.brokerSession), practice: Boolean(trading.bot.practice), stale: Boolean(trading.bot.keyHash) && botStale(now.getTime()) },
    clock: marketClock(now),
    quotesAsOf: newest,
    quotesSource: newest ? [...quotes.values()].find((q) => q.asOf === newest)?.source : undefined,
    agentsCanDecide: Boolean(client),
  };
}
