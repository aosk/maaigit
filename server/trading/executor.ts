import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { openScore } from './scoring.js';
import type { Position, Quote, Side, TradeMode, TradeOrder } from '../../shared/trading.js';
import { applyFill, round2 } from './portfolio.js';
import { latestObserved, observedBetween } from './market.js';
import { emit, saveTrading, trading } from './store.js';
import { deskConfig, unitAr } from './desk.js';
import { instrument, tradingDay } from './tadawul.js';

/**
 * Where an order goes once the risk gate passed it. Paper: filled inside the server, but only by a price that was true
 * at the exchange while the order was open (never one that happened before it, even if it arrived after) and that
 * traded through its limit (a touch is not a fill: the exchange fills by price and then time); it fills at its limit. Live: a signed command waits for the user's desktop bot, which places it at Broker and reports back.
 * Each command has one id; the bot keeps every id it has seen and never places one twice, so sending a command again
 * after a dropped connection is safe. The broker's own report of the account is the truth, and any difference halts.
 */

/** An order not placed within this is let go: the reason for it was true when it was decided, not later. */
const ORDER_TTL_MS = 10 * 60_000;
/** A command the bot has not acknowledged is sent again after this. */
const RESEND_MS = 60_000;
/** No word from the bot for this long: it counts as gone. */
const BOT_STALE_MS = 3 * 60_000;

/** In play: waiting, partly filled, or unknown (which keeps its cash and its stock until resolved). */
const OPEN: TradeOrder['status'][] = ['queued', 'sent', 'partial', 'unknown'];
export const openOrders = (mode: TradeMode) => trading.orders.filter((o) => o.mode === mode && OPEN.includes(o.status));

const label = (symbol: string) => `${instrument(symbol)?.nameAr ?? symbol} (${symbol})`;
const sideAr = (side: Side) => (side === 'buy' ? 'شراء' : 'بيع');

/** Records an order that passed the risk gate, and (paper) tries to fill it at once. */
export function submit(decisionId: string, symbol: string, side: Side, qty: number, limitPrice: number, now = new Date(), priceAsOf?: string, refPrice?: number): TradeOrder {
  const order: TradeOrder = {
    id: `ord_${randomBytes(8).toString('hex')}`,
    decisionId,
    symbol,
    side,
    qty,
    limitPrice,
    status: 'queued',
    mode: trading.mode,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ORDER_TTL_MS).toISOString(),
    filledQty: 0,
    priceAsOf,
    refPrice,
  };
  trading.orders.push(order);
  const day = tradingDay(now);
  trading.ordersToday = trading.ordersToday.day === day ? { day, count: trading.ordersToday.count + 1 } : { day, count: 1 };
  emit('order.queued', 'executor', `${sideAr(side)} ${qty}${unitAr()} ${label(symbol)} بحد ${limitPrice} · ${order.mode === 'paper' ? 'تجريبي' : 'إلى بوت Broker'}`, { correlationId: decisionId, data: { orderId: order.id, mode: order.mode } }, now);
  if (order.mode === 'paper') tryPaperFill(order, now);
  saveTrading();
  return order;
}

/** A paper order with no exchange prices to judge it this long after its window: let go, never filled on a guess. */
const PAPER_GIVE_UP_MS = 60 * 60_000;

/** Where a paper order's window ends: its expiry, or earlier when it was asked to be cancelled (Stop, the close). */
const windowEnd = (o: TradeOrder) => (o.cancelRequestedAt && o.cancelRequestedAt < o.expiresAt ? o.cancelRequestedAt : o.expiresAt);

/**
 * A paper order is judged by exchange time. It fills only on a price that was true after it was created and before
 * its window ended, strictly through its limit, and then at its limit. With a feed about 15 minutes late, the answer
 * comes about 15 minutes after the window: until a price from after the window arrives, the order waits.
 */
function tryPaperFill(order: TradeOrder, now: Date) {
  const end = windowEnd(order);
  const through = observedBetween(order.symbol, order.createdAt, end).find((q) => (order.side === 'buy' ? q.price < order.limitPrice : q.price > order.limitPrice));
  if (through) {
    // A sale priced under the market (an exit) sells at about the market, as it would at a broker: at the price seen,
    // never above the price it was placed against. Anything else fills at its limit.
    const marketable = order.side === 'sell' && order.refPrice !== undefined && order.limitPrice < order.refPrice;
    const price = marketable ? Math.min(through.price, order.refPrice!) : order.limitPrice;
    const profit = applyFill(trading.books.paper, order.side, order.symbol, order.qty, price);
    order.fillPriceAsOf = through.asOf;
    fill(order, order.qty, price, now, profit, through);
    return;
  }
  const latest = latestObserved(order.symbol);
  const judged = latest !== undefined && Date.parse(latest) > Date.parse(end);
  if (judged || now.getTime() - Date.parse(end) > PAPER_GIVE_UP_MS) {
    const why = judged ? 'never traded through its limit while it was open' : 'no exchange prices came to judge it';
    if (end !== order.expiresAt) cancel(order, order.error ?? 'Stopped', now);
    else {
      order.status = 'expired';
      order.error = why;
      emit('order.expired', 'executor', `انتهت مهلة أمر ${sideAr(order.side)} ${label(order.symbol)} بلا تنفيذ: ${judged ? 'السعر ما تجاوز الحد خلال مدته' : 'ما وصلت أسعار للحكم عليه'}`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
    }
    return;
  }
  if (order.status === 'queued') order.status = 'sent';
  order.stage = 'waiting for exchange prices from after the order';
}

function fill(order: TradeOrder, qty: number, price: number, now: Date, profit: number, evidence?: Quote) {
  order.filledQty = qty;
  order.avgFillPrice = price;
  order.status = qty >= order.qty ? 'filled' : 'partial';
  order.stage = undefined;
  const taken = order.side === 'sell' ? ` · ${profit >= 0 ? 'ربح' : 'خسارة'} ${deskConfig().money(Math.abs(profit))}` : '';
  const when = evidence ? ` · سعر البورصة ${evidence.price} الساعة ${evidence.asOf.slice(11, 16)} (توقيت عالمي)` : '';
  // Noted for scoring against the index once its holding window has passed.
  openScore(order, price, now);
  emit('order.filled', 'executor', `تم التنفيذ: ${sideAr(order.side)} ${qty} × ${label(order.symbol)} بسعر ${price}${taken}${when}`, { correlationId: order.decisionId, data: { orderId: order.id, qty, price, profit, ...(evidence ? { quoteAsOf: evidence.asOf, quoteReceivedAt: evidence.receivedAt, quotePrice: evidence.price } : {}) } }, now);
}

/** How long past its expiry a live order the bot took may go without a result before it is treated as unknown. */
const LOST_AFTER_MS = 30 * 60_000;

/**
 * Every minute. Paper orders are judged against exchange prices (above). A live order not yet with the bot is let go
 * at its expiry; one the bot has is asked to be cancelled at Broker at its expiry (it may be resting there), and if no
 * result comes long after, it becomes unknown: it keeps its cash and blocks its stock, and trading stops until the
 * broker's status is known.
 */
export function processOrders(now = new Date()): void {
  for (const order of trading.orders.filter((o) => OPEN.includes(o.status) && o.status !== 'unknown')) {
    if (order.mode === 'paper') {
      // One order that cannot be booked must not stop the others, nor the tick behind them (the daily loss stop, the rounds).
      try {
        tryPaperFill(order, now);
      } catch (error) {
        order.status = 'failed';
        order.error = (error as Error).message;
        emit('order.failed', 'executor', `تعذّر تسجيل أمر ${sideAr(order.side)} ${label(order.symbol)}: ${order.error}`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
      }
      continue;
    }
    const botHasIt = Boolean(order.ackedAt) && order.status !== 'queued';
    const expired = now.getTime() > Date.parse(order.expiresAt);
    if (!botHasIt) {
      if (expired) {
        order.status = 'expired';
        emit('order.expired', 'executor', `انتهت مهلة أمر ${sideAr(order.side)} ${label(order.symbol)} قبل تنفيذه`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
      }
      continue;
    }
    if (expired) requestCancel(order, 'انتهت مدة الأمر', now);
    if (now.getTime() > Date.parse(order.expiresAt) + LOST_AFTER_MS) markUnknown(order, 'No result from the Broker bot long after the order expired.', now);
  }
  saveTrading();
}

/** The broker may or may not have it: it stays in play (cash reserved, stock blocked) and trading stops until it is resolved. */
function markUnknown(order: TradeOrder, why: string, now: Date): void {
  order.status = 'unknown';
  order.error = why.slice(0, 300);
  emit('order.unknown', 'executor', `حالة أمر ${sideAr(order.side)} ${label(order.symbol)} في Broker غير معروفة: تحقّق منه في تطبيق Broker، والتداول متوقف حتى يتضح`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
  halt(`أمر ${label(order.symbol)} حالته في Broker غير معروفة`, 'system', now);
}

/**
 * Ask for an order to be let go: a paper order's window ends now (what traded before still counts); a live order not
 * yet with the bot is cancelled at once; one the bot has gets a signed cancel for Broker, sent until the bot confirms.
 */
function requestCancel(order: TradeOrder, reason: string, now = new Date()): void {
  if (order.cancelRequestedAt || !OPEN.includes(order.status) || order.status === 'unknown') return;
  order.cancelRequestedAt = now.toISOString();
  order.error = reason;
  if (order.mode === 'live' && !order.ackedAt) cancel(order, reason, now);
  else if (order.mode === 'live') emit('order.progress', 'executor', `طلبت من بوت Broker إلغاء أمر ${sideAr(order.side)} ${label(order.symbol)}: ${reason}`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
}

/** Orders whose status at the broker is not known, for the screen and for resuming. */
const unknownOrders = () => trading.orders.filter((o) => o.status === 'unknown');

/**
 * The user checked Broker: the order was not executed (cancelled), or it was (filled; the live book follows the broker's
 * own account report, which is the truth for quantities and cost).
 */
export function resolveUnknown(orderId: string, executed: boolean, now = new Date()): boolean {
  const order = trading.orders.find((o) => o.id === orderId && o.status === 'unknown');
  if (!order) return false;
  if (executed) {
    order.status = 'filled';
    order.filledQty = order.qty;
    emit('order.filled', 'user', `أكدت أن أمر ${sideAr(order.side)} ${label(order.symbol)} نُفّذ في Broker؛ المراكز تُحدَّث من تقرير حساب Broker`, { correlationId: order.decisionId, data: { orderId: order.id, resolvedBy: 'user' } }, now);
  } else {
    order.status = 'cancelled';
    emit('order.cancelled', 'user', `أكدت أن أمر ${sideAr(order.side)} ${label(order.symbol)} ما نُفّذ في Broker`, { correlationId: order.decisionId, data: { orderId: order.id, resolvedBy: 'user' } }, now);
  }
  saveTrading();
  return true;
}

/** At the close (or the daily loss limit) every order still waiting is let go: tomorrow is a new decision. (A live order at Broker ends with Broker's session.) */
export function cancelAllOpen(reason: string, now = new Date()): void {
  for (const order of trading.orders.filter((o) => OPEN.includes(o.status) && !(o.mode === 'live' && o.ackedAt))) requestCancel(order, reason, now);
  saveTrading();
}

/** One order let go before it was placed, on the log under its decision so the trade shows how it ended. */
function cancel(order: TradeOrder, reason: string, now: Date): void {
  order.status = 'cancelled';
  order.error = reason;
  emit('order.cancelled', 'executor', `${reason}: أُلغي أمر ${sideAr(order.side)} ${label(order.symbol)}`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
}

// ---------- The desktop bot ----------

const hash = (key: string) => createHash('sha256').update(key).digest();

/** A new key for the desktop bot (shown once), and the secret it checks every command's signature with. */
export function createBotKey(): { key: string; signSecret: string } {
  const key = `stk_${randomBytes(32).toString('base64url')}`;
  const signSecret = randomBytes(32).toString('hex');
  trading.bot = { keyHash: hash(key).toString('hex'), keyHint: key.slice(0, 8), signSecret };
  emit('system.limits', 'user', 'مفتاح جديد لبوت Broker (المفتاح القديم توقف)');
  return { key, signSecret };
}

export function revokeBotKey(): void {
  trading.bot = {};
  if (trading.mode === 'live') setMode('paper', 'system', 'فُصل بوت Broker، فرجع التداول للوضع التجريبي');
  emit('system.limits', 'user', 'فُصل بوت Broker');
}

export function botKeyMatches(given: string): boolean {
  if (!trading.bot.keyHash || !given) return false;
  const expected = Buffer.from(trading.bot.keyHash, 'hex');
  const actual = hash(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const botStale = (now = Date.now()) => !trading.bot.lastSeen || now - Date.parse(trading.bot.lastSeen) > BOT_STALE_MS;

export interface Command {
  commandId: string;
  symbol: string;
  side: Side;
  qty: number;
  limitPrice: number;
  issuedAt: string;
  expiresAt: string;
  /** HMAC-SHA256 of the fields above, in this order, joined by "|", with the signing secret. */
  sig: string;
}

const signCommand = (c: Omit<Command, 'sig'>, secret: string) =>
  createHmac('sha256', secret).update([c.commandId, c.symbol, c.side, c.qty, c.limitPrice.toFixed(2), c.issuedAt, c.expiresAt].join('|')).digest('hex');

/** The commands for the bot now: live orders not yet acknowledged, while trading is on. Re-sent until acknowledged. */
export function takeCommands(now = new Date()): Command[] {
  trading.bot.lastSeen = now.toISOString();
  if (trading.halted || trading.mode !== 'live' || !trading.bot.signSecret) return [];
  const out: Command[] = [];
  for (const order of openOrders('live')) {
    if (order.ackedAt || now.getTime() > Date.parse(order.expiresAt)) continue;
    if (order.sentAt && now.getTime() - Date.parse(order.sentAt) < RESEND_MS) continue;
    order.sentAt = now.toISOString();
    if (order.status === 'queued') {
      order.status = 'sent';
      emit('order.sent', 'executor', `أُرسل الأمر لبوت Broker: ${sideAr(order.side)} ${order.qty} × ${label(order.symbol)}`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
    }
    const base = { commandId: order.id, symbol: order.symbol, side: order.side, qty: order.qty, limitPrice: order.limitPrice, issuedAt: now.toISOString(), expiresAt: order.expiresAt };
    out.push({ ...base, sig: signCommand(base, trading.bot.signSecret) });
  }
  saveTrading();
  return out;
}

/** A request to cancel an order at Broker. Signed like a command: HMAC-SHA256 of "cancel|commandId|issuedAt". */
export interface CancelCommand {
  commandId: string;
  issuedAt: string;
  sig: string;
}

/** Cancels for orders the bot has (Stop, expiry): sent even while trading is stopped, again every minute until confirmed. */
export function takeCancels(now = new Date()): CancelCommand[] {
  const secret = trading.bot.signSecret;
  if (!secret) return [];
  const out: CancelCommand[] = [];
  for (const order of trading.orders.filter((o) => o.mode === 'live' && o.ackedAt && o.cancelRequestedAt && !o.cancelAckedAt && (o.status === 'sent' || o.status === 'partial'))) {
    if (order.cancelSentAt && now.getTime() - Date.parse(order.cancelSentAt) < RESEND_MS) continue;
    order.cancelSentAt = now.toISOString();
    const issuedAt = now.toISOString();
    out.push({ commandId: order.id, issuedAt, sig: createHmac('sha256', secret).update(['cancel', order.id, issuedAt].join('|')).digest('hex') });
  }
  if (out.length) saveTrading();
  return out;
}

/** The bot asks right before submitting: still allowed? (Halt, mode or expiry may have changed since the command came.) */
export function stillGo(commandId: string, now = new Date()): { go: boolean; reason?: string } {
  const order = trading.orders.find((o) => o.id === commandId);
  if (!order) return { go: false, reason: 'unknown command' };
  if (trading.halted) return { go: false, reason: 'halted' };
  if (trading.mode !== 'live' || order.mode !== 'live') return { go: false, reason: 'not live' };
  if (!OPEN.includes(order.status) || order.status === 'unknown') return { go: false, reason: order.status };
  if (order.cancelRequestedAt) return { go: false, reason: 'cancelled' };
  if (now.getTime() > Date.parse(order.expiresAt)) return { go: false, reason: 'expired' };
  return { go: true };
}

export function ackCommand(commandId: string, now = new Date(), kind: 'order' | 'cancel' = 'order'): boolean {
  const order = trading.orders.find((o) => o.id === commandId && o.mode === 'live');
  if (!order) return false;
  if (kind === 'cancel') order.cancelAckedAt ??= now.toISOString();
  else order.ackedAt ??= now.toISOString();
  saveTrading();
  return true;
}

export function commandProgress(commandId: string, stage: string, now = new Date()): void {
  const order = trading.orders.find((o) => o.id === commandId && o.mode === 'live');
  if (!order) return;
  order.stage = stage.slice(0, 80);
  emit('order.progress', 'executor', `بوت Broker: ${order.stage}`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
}

export interface BotResult {
  commandId: string;
  /**
   * accepted: at Broker, not filled yet · filled / partial · cancelled (at Broker, what filled before stays) · rejected by Broker ·
   * failed: never reached Broker · unknown: it may have reached Broker (cut off after Submit, or a cancel that could not be confirmed).
   */
  status: 'accepted' | 'filled' | 'partial' | 'cancelled' | 'rejected' | 'failed' | 'unknown';
  filledQty?: number;
  avgPrice?: number;
  brokerOrderId?: string;
  error?: string;
}

/** What the bot says happened at the broker. A fill is booked in the live book; a failure halts nothing by itself. */
export function commandResult(r: BotResult, now = new Date()): boolean {
  const order = trading.orders.find((o) => o.id === r.commandId && o.mode === 'live');
  if (!order || !OPEN.includes(order.status)) return false;
  order.ackedAt ??= now.toISOString();
  order.brokerOrderId = r.brokerOrderId?.slice(0, 60);
  if (r.status === 'accepted') {
    if (order.status === 'queued') order.status = 'sent';
    order.stage = 'accepted at Broker, waiting to fill';
    emit('order.progress', 'executor', `بوت Broker: الأمر عند Broker بانتظار التنفيذ${order.brokerOrderId ? ` (${order.brokerOrderId})` : ''}`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
  } else if (r.status === 'unknown') {
    markUnknown(order, r.error ?? 'The bot could not tell whether Broker has this order.', now);
  } else if (r.status === 'cancelled') {
    order.status = 'cancelled';
    order.stage = undefined;
    emit('order.cancelled', 'executor', `أُلغي أمر ${sideAr(order.side)} ${label(order.symbol)} في Broker${order.filledQty ? ` (نُفّذ منه ${order.filledQty} قبل الإلغاء)` : ''}`, { correlationId: order.decisionId, data: { orderId: order.id, filledQty: order.filledQty } }, now);
  } else if (r.status === 'filled' || r.status === 'partial') {
    const qty = Math.min(order.qty, Math.max(0, Math.floor(r.filledQty ?? 0)));
    const price = Number(r.avgPrice);
    // A repeated or out-of-order report (no more filled than already booked) changes nothing.
    if (qty > 0 && price > 0 && qty <= order.filledQty) {
      if (r.status === 'filled' && qty >= order.qty) order.status = 'filled';
      saveTrading();
      return true;
    }
    if (!(qty > 0) || !(price > 0)) {
      order.status = 'failed';
      order.error = 'The bot reported a fill without a quantity or price.';
      emit('order.failed', 'executor', `بوت Broker أبلغ عن تنفيذ ناقص البيانات لـ ${label(order.symbol)}: أوقفت التداول للتحقق`, { correlationId: order.decisionId }, now);
      halt('تقرير تنفيذ غير مكتمل من بوت Broker', 'system', now);
      return true;
    }
    let profit = 0;
    try {
      // The bot reports the average over everything filled so far: the part just filled is booked at its own price.
      const before = order.filledQty * (order.avgFillPrice ?? price);
      profit = applyFill(trading.books.live, order.side, order.symbol, qty - order.filledQty, (qty * price - before) / (qty - order.filledQty));
    } catch {
      // The broker says it sold what our book does not hold: the reconciliation will catch the difference.
    }
    fill(order, qty, price, now, profit);
    if (r.status === 'partial') order.status = 'partial';
  } else {
    order.status = r.status;
    order.error = r.error?.slice(0, 300);
    emit(r.status === 'rejected' ? 'order.rejected' : 'order.failed', 'executor', `لم يُنفَّذ ${sideAr(order.side)} ${label(order.symbol)}: ${order.error ?? r.status}`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
  }
  saveTrading();
  return true;
}

/** The broker's own account, every few minutes. It replaces the live book; a difference from what we expected halts trading. */
export function reconcile(report: { cash: number; positions: Position[] }, now = new Date()): { drift: boolean } {
  const live = trading.books.live;
  const reported = new Map(report.positions.filter((p) => p.qty > 0).map((p) => [p.symbol, p.qty]));
  const expected = new Map(live.positions.map((p) => [p.symbol, p.qty]));
  // Sales or buys still on the way may legitimately differ for a moment.
  const moving = new Set(openOrders('live').filter((o) => o.ackedAt).map((o) => o.symbol));
  const diffs = [...new Set([...reported.keys(), ...expected.keys()])].filter((s) => !moving.has(s) && (reported.get(s) ?? 0) !== (expected.get(s) ?? 0));
  const firstReport = live.positions.length === 0 && live.cash === 0;
  live.cash = round2(report.cash);
  live.positions = report.positions.filter((p) => p.qty > 0).map((p) => ({ symbol: p.symbol, qty: p.qty, avgCost: p.avgCost > 0 ? p.avgCost : live.positions.find((x) => x.symbol === p.symbol)?.avgCost ?? 0 }));
  // The broker's first report is where the live day starts: before it the book was empty, not worth zero.
  if (firstReport) {
    live.dayStart = { day: tradingDay(now), value: round2(live.cash + live.positions.reduce((sum, p) => sum + p.qty * p.avgCost, 0)), realized: live.realized };
    live.curve = [];
  }
  saveTrading();
  if (diffs.length && !firstReport) {
    emit('position.drift', 'system', `حساب Broker يختلف عن المتوقع في: ${diffs.map((s) => `${s} (متوقع ${expected.get(s) ?? 0}، فعلي ${reported.get(s) ?? 0})`).join('، ')}`, { data: { diffs } }, now);
    halt('اختلاف بين حساب Broker وسجل أسهمي', 'system', now);
    return { drift: true };
  }
  return { drift: false };
}

// ---------- Halt, resume and mode (shared by the engine and the routes) ----------

/** Anyone can stop trading: the user, a rule, the system. */
export function halt(reason: string, by: 'user' | 'system' | 'risk', now = new Date()): void {
  if (trading.halted) return;
  trading.halted = true;
  trading.haltReason = reason.slice(0, 200);
  emit('system.halted', by, `توقّف التداول: ${trading.haltReason}`, {}, now);
  // Stop means stop: every order still waiting is let go, at Broker too (what already filled stays).
  for (const order of trading.orders.filter((o) => OPEN.includes(o.status))) requestCancel(order, 'توقّف التداول', now);
}

/** Only the user starts it again, and not while an order's status at Broker is unknown (it might fill, or be placed again). */
export function resume(now = new Date()): boolean {
  if (!trading.halted) return true;
  if (unknownOrders().length) return false;
  trading.halted = false;
  trading.haltReason = undefined;
  emit('system.resumed', 'user', 'استأنفت التداول', {}, now);
  return true;
}

export function setMode(mode: TradeMode, by: 'user' | 'system', text: string, now = new Date()): void {
  // A desk with no broker connected (the US desk, for now) never trades real money.
  if (trading.mode === mode || (mode === 'live' && !deskConfig().liveAllowed)) return;
  // Orders of the other mode never carry over.
  for (const order of trading.orders.filter((o) => OPEN.includes(o.status) && o.mode !== mode && !o.ackedAt)) cancel(order, 'تغيّر وضع التداول', now);
  trading.mode = mode;
  // The benchmark compares one book with the index: a different book starts its own.
  delete trading.track;
  emit('system.mode', by, text, { data: { mode } }, now);
}
