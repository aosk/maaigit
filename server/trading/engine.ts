import type { MarketPulse, TradingState } from '../../shared/trading.js';
import { client } from '../ai/claude.js';
import { alertTrade } from '../notify.js';
import { randomBytes } from 'node:crypto';
import { decisionRound, lastDecisionRecord, marketContext, newsFetchedAt, newsRound, technicalRound, type Decision, type MarketItem } from './agents.js';
import { archiveRound, type RoundRecord } from './archive.js';
import { botStale, cancelAllOpen, halt, openOrders, processOrders, submit } from './executor.js';
import { currentIndex, currentQuotes, refreshQuotes } from './market.js';
import { marketPulse } from './pulse.js';
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
    // Prices while the market is open (and after the close while a paper order still waits for the prices that judge
    // it: the feed runs late), and once at start so the screen has something.
    const judging = !clock.open && openOrders('paper').length > 0;
    if (((clock.open || judging) && now.getTime() - lastQuotes >= QUOTES_EVERY_MS) || currentQuotes().size === 0) {
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
    if (trading.caution && Date.parse(trading.caution.until) <= now.getTime()) endCaution('system', now);
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
  const book = trading.books[trading.mode];
  // What the desk knew when the round began, before anything moved.
  const record: RoundRecord = {
    roundId: `rnd_${randomBytes(6).toString('hex')}`,
    at: now.toISOString(),
    day: tradingDay(now),
    mode: trading.mode,
    decider: trading.decider,
    minutesToClose: clock.minutesToChange,
    limits: { ...trading.limits },
    excluded: [...trading.excluded],
    instructions: trading.directives.map((d) => d.text),
    book: { cash: book.cash, positions: book.positions.map((p) => ({ ...p })) },
    ordersToday: trading.ordersToday.day === tradingDay(now) ? trading.ordersToday.count : 0,
    quotes: [...currentQuotes().values()].map((q) => ({ ...q })),
  };
  const reads = technicalRound(now);
  const news = await newsRound(now);
  noteMarket(marketContext(), now);
  record.technical = reads;
  record.news = { fetchedAt: newsFetchedAt(), items: news, market: marketContext() };
  record.caution = cautionNow(now) ? { ...trading.caution } : null;
  const pulse = livePulse(now);
  record.pulse = pulse;
  if (clock.minutesToChange <= NO_NEW_ORDERS_MIN) {
    emit('agent.observation', 'risk', `باقي ${clock.minutesToChange} دقيقة على الإقفال: ما فيه أوامر جديدة اليوم`, {}, now);
    archiveRound({ ...record, skipped: 'closing' });
    return;
  }
  const decisions = await decisionRound(reads, news, clock.minutesToChange, now, pulse);
  record.decision = { ...lastDecisionRecord() };
  record.verdicts = decisions.map((d) => gate(d, now));
  archiveRound(record);
}

/** The general market indicator right now: TASI, the followed stocks' breadth, and the news agent's market risk. */
function livePulse(now = new Date()): MarketPulse {
  return marketPulse({ index: currentIndex(), quotes: [...currentQuotes().values()], market: marketContext(), caution: Boolean(cautionNow(now)) });
}

/** How long caution mode lasts after the last serious development. */
const CAUTION_MS = 24 * 3_600_000;

/** Caution in force now (it ends by itself 24 hours after the last serious development). */
export function cautionNow(now = new Date()): { sectors: string[] } | undefined {
  return trading.caution && Date.parse(trading.caution.until) > now.getTime() ? { sectors: trading.caution.sectors } : undefined;
}

/**
 * A confirmed, high-severity market development turns caution mode on (or keeps it on, adding its sectors), when the
 * user allows it. Seen again later, the same development extends it; it ends 24 hours after the last one.
 */
export function noteMarket(items: MarketItem[], now = new Date()): void {
  const serious = items.filter((m) => m.severity === 'high' && m.confirmed);
  if (!serious.length || !trading.cautionAuto) return;
  const current = cautionNow(now) ? trading.caution : undefined;
  const sectors = [...new Set([...(current?.sectors ?? []), ...serious.flatMap((m) => m.sectors)])];
  const lead = serious[0];
  const changed = !current || sectors.length !== current.sectors.length || current.reason !== lead.headline;
  trading.caution = { since: current?.since ?? now.toISOString(), until: new Date(now.getTime() + CAUTION_MS).toISOString(), sectors, reason: lead.headline, source: lead.source };
  if (changed) emit('system.caution', 'risk', `وضع الحذر ${current ? 'تحدّث' : 'اشتغل'}: ${lead.headline} (${lead.source}) · نص حد الشراء${sectors.length ? ` وما فيه شراء جديد في: ${sectors.join('، ')}` : ''} · ينتهي بعد ٢٤ ساعة`, { data: { on: true, sectors, source: lead.source } }, now);
  saveTrading();
}

/** Caution ends by itself, or because the user ended it. */
export function endCaution(by: 'user' | 'system', now = new Date()): void {
  if (!trading.caution) return;
  trading.caution = undefined;
  emit('system.caution', by, by === 'user' ? 'أنهيت وضع الحذر' : 'انتهى وضع الحذر: مرّت ٢٤ ساعة بدون تطورات خطيرة', { data: { on: false } }, now);
  saveTrading();
}

/** The risk gate on one decision: its verdict goes on the log, and only a pass or a smaller order goes on. */
export function gate(d: Decision, now = new Date()): { decisionId: string; verdict: string; qty: number; limitPrice: number; reasons: string[]; orderId?: string } {
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
          live: trading.mode === 'live',
          caution: cautionNow(now),
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
  const order = verdict.verdict !== 'veto' ? submit(d.id, d.symbol, d.side, verdict.qty, verdict.limitPrice, now, currentQuotes().get(d.symbol)?.asOf) : undefined;
  return { decisionId: d.id, verdict: verdict.verdict, qty: verdict.qty, limitPrice: verdict.limitPrice, reasons: verdict.reasons, orderId: order?.id };
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
    [/last 20 minutes/, () => 'ما فيه مراكز جديدة في آخر ٢٠ دقيقة'],
    [/Caution mode: no new buys/, () => 'وضع الحذر: ما فيه شراء جديد في هالقطاع'],
    [/Caution mode: half/, () => 'وضع الحذر: نص حد الأمر'],
    [/live SNB price/, () => 'ما فيه سعر لحظي من SNB'],
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
const TOLD = new Set(['order.filled', 'order.failed', 'system.halted', 'position.drift', 'order.unknown', 'system.caution']);

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
    agentsCanDecide: trading.decider === 'rules' || Boolean(client),
    decider: trading.decider,
    caution: cautionNow(now) ? trading.caution : undefined,
    cautionAuto: trading.cautionAuto,
    pulse: livePulse(now),
  };
}
