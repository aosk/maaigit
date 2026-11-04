import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Position, Side, TradeMode, TradeOrder } from '../../shared/trading.js';
import { applyFill, round2 } from './portfolio.js';
import { currentQuotes } from './market.js';
import { emit, saveTrading, trading } from './store.js';
import { instrument, tradingDay } from './tadawul.js';

/**
 * Where an order goes once the risk gate passed it. Paper: filled inside the server at the market price, if the limit
 * allows. Live: a signed command waits for the user's desktop bot, which places it at SNB Capital and reports back.
 * Each command has one id; the bot keeps every id it has seen and never places one twice, so sending a command again
 * after a dropped connection is safe. The broker's own report of the account is the truth, and any difference halts.
 */

/** An order not placed within this is let go: the reason for it was true when it was decided, not later. */
const ORDER_TTL_MS = 10 * 60_000;
/** A command the bot has not acknowledged is sent again after this. */
const RESEND_MS = 60_000;
/** No word from the bot for this long: it counts as gone. */
const BOT_STALE_MS = 3 * 60_000;

const OPEN: TradeOrder['status'][] = ['queued', 'sent', 'partial'];
export const openOrders = (mode: TradeMode) => trading.orders.filter((o) => o.mode === mode && OPEN.includes(o.status));

const label = (symbol: string) => `${instrument(symbol)?.nameAr ?? symbol} (${symbol})`;
const sideAr = (side: Side) => (side === 'buy' ? 'شراء' : 'بيع');

/** Records an order that passed the risk gate, and (paper) tries to fill it at once. */
export function submit(decisionId: string, symbol: string, side: Side, qty: number, limitPrice: number, now = new Date()): TradeOrder {
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
  };
  trading.orders.push(order);
  const day = tradingDay(now);
  trading.ordersToday = trading.ordersToday.day === day ? { day, count: trading.ordersToday.count + 1 } : { day, count: 1 };
  emit('order.queued', 'executor', `${sideAr(side)} ${qty} سهم ${label(symbol)} بحد ${limitPrice} · ${order.mode === 'paper' ? 'تجريبي' : 'إلى بوت SNB'}`, { correlationId: decisionId, data: { orderId: order.id, mode: order.mode } }, now);
  if (order.mode === 'paper') tryPaperFill(order, now);
  saveTrading();
  return order;
}

/** A paper order fills when the price reaches its limit: at the market price, never worse than the limit. */
function tryPaperFill(order: TradeOrder, now: Date) {
  const quote = currentQuotes().get(order.symbol);
  if (!quote) return;
  const reached = order.side === 'buy' ? quote.price <= order.limitPrice : quote.price >= order.limitPrice;
  if (!reached) {
    if (order.status === 'queued') order.status = 'sent';
    return;
  }
  const profit = applyFill(trading.books.paper, order.side, order.symbol, order.qty, quote.price);
  fill(order, order.qty, quote.price, now, profit);
}

function fill(order: TradeOrder, qty: number, price: number, now: Date, profit: number) {
  order.filledQty = qty;
  order.avgFillPrice = price;
  order.status = qty >= order.qty ? 'filled' : 'partial';
  const taken = order.side === 'sell' ? ` · ${profit >= 0 ? 'ربح' : 'خسارة'} ${Math.abs(profit).toFixed(2)} ر.س` : '';
  emit('order.filled', 'executor', `تم التنفيذ: ${sideAr(order.side)} ${qty} × ${label(order.symbol)} بسعر ${price}${taken}`, { correlationId: order.decisionId, data: { orderId: order.id, qty, price, profit } }, now);
}

/** Every minute: paper orders fill when their price comes, and any order past its time is let go. */
export function processOrders(now = new Date()): void {
  for (const order of trading.orders.filter((o) => OPEN.includes(o.status))) {
    if (now.getTime() > Date.parse(order.expiresAt) && !(order.mode === 'live' && order.ackedAt && order.status !== 'queued')) {
      order.status = 'expired';
      emit('order.expired', 'executor', `انتهت مهلة أمر ${sideAr(order.side)} ${label(order.symbol)} قبل تنفيذه`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
    } else if (order.mode === 'paper') tryPaperFill(order, now);
  }
  saveTrading();
}

/** At the close every order still waiting is cancelled: tomorrow is a new decision. (A live order the bot already has is left to it.) */
export function cancelAllOpen(reason: string, now = new Date()): void {
  const waiting = trading.orders.filter((o) => OPEN.includes(o.status) && !(o.mode === 'live' && o.ackedAt));
  for (const order of waiting) {
    order.status = 'cancelled';
    order.error = reason;
  }
  if (waiting.length) emit('order.expired', 'executor', `${reason}: أُلغي ${waiting.length} أمر`, {}, now);
  saveTrading();
}

// ---------- The desktop bot ----------

const hash = (key: string) => createHash('sha256').update(key).digest();

/** A new key for the desktop bot (shown once), and the secret it checks every command's signature with. */
export function createBotKey(): { key: string; signSecret: string } {
  const key = `stk_${randomBytes(32).toString('base64url')}`;
  const signSecret = randomBytes(32).toString('hex');
  trading.bot = { keyHash: hash(key).toString('hex'), keyHint: key.slice(0, 8), signSecret };
  emit('system.limits', 'user', 'مفتاح جديد لبوت SNB (المفتاح القديم توقف)');
  return { key, signSecret };
}

export function revokeBotKey(): void {
  trading.bot = {};
  if (trading.mode === 'live') setMode('paper', 'system', 'فُصل بوت SNB، فرجع التداول للوضع التجريبي');
  emit('system.limits', 'user', 'فُصل بوت SNB');
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
      emit('order.sent', 'executor', `أُرسل الأمر لبوت SNB: ${sideAr(order.side)} ${order.qty} × ${label(order.symbol)}`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
    }
    const base = { commandId: order.id, symbol: order.symbol, side: order.side, qty: order.qty, limitPrice: order.limitPrice, issuedAt: now.toISOString(), expiresAt: order.expiresAt };
    out.push({ ...base, sig: signCommand(base, trading.bot.signSecret) });
  }
  saveTrading();
  return out;
}

/** The bot asks right before submitting: still allowed? (Halt, mode or expiry may have changed since the command came.) */
export function stillGo(commandId: string, now = new Date()): { go: boolean; reason?: string } {
  const order = trading.orders.find((o) => o.id === commandId);
  if (!order) return { go: false, reason: 'unknown command' };
  if (trading.halted) return { go: false, reason: 'halted' };
  if (trading.mode !== 'live' || order.mode !== 'live') return { go: false, reason: 'not live' };
  if (!OPEN.includes(order.status)) return { go: false, reason: order.status };
  if (now.getTime() > Date.parse(order.expiresAt)) return { go: false, reason: 'expired' };
  return { go: true };
}

export function ackCommand(commandId: string, now = new Date()): boolean {
  const order = trading.orders.find((o) => o.id === commandId && o.mode === 'live');
  if (!order) return false;
  order.ackedAt ??= now.toISOString();
  saveTrading();
  return true;
}

export function commandProgress(commandId: string, stage: string, now = new Date()): void {
  const order = trading.orders.find((o) => o.id === commandId && o.mode === 'live');
  if (!order) return;
  order.stage = stage.slice(0, 80);
  emit('order.progress', 'executor', `بوت SNB: ${order.stage}`, { correlationId: order.decisionId, data: { orderId: order.id } }, now);
}

export interface BotResult {
  commandId: string;
  status: 'filled' | 'partial' | 'rejected' | 'failed';
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
  if (r.status === 'filled' || r.status === 'partial') {
    const qty = Math.min(order.qty, Math.max(0, Math.floor(r.filledQty ?? 0)));
    const price = Number(r.avgPrice);
    if (!(qty > 0) || !(price > 0)) {
      order.status = 'failed';
      order.error = 'The bot reported a fill without a quantity or price.';
      emit('order.failed', 'executor', `بوت SNB أبلغ عن تنفيذ ناقص البيانات لـ ${label(order.symbol)}: أوقفت التداول للتحقق`, { correlationId: order.decisionId }, now);
      halt('تقرير تنفيذ غير مكتمل من بوت SNB', 'system', now);
      return true;
    }
    let profit = 0;
    try {
      profit = applyFill(trading.books.live, order.side, order.symbol, qty - order.filledQty, price);
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
  saveTrading();
  if (diffs.length && !firstReport) {
    emit('position.drift', 'system', `حساب SNB يختلف عن المتوقع في: ${diffs.map((s) => `${s} (متوقع ${expected.get(s) ?? 0}، فعلي ${reported.get(s) ?? 0})`).join('، ')}`, { data: { diffs } }, now);
    halt('اختلاف بين حساب SNB وسجل StockSmart', 'system', now);
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
}

/** Only the user starts it again. */
export function resume(now = new Date()): void {
  if (!trading.halted) return;
  trading.halted = false;
  trading.haltReason = undefined;
  emit('system.resumed', 'user', 'استأنفت التداول', {}, now);
}

export function setMode(mode: TradeMode, by: 'user' | 'system', text: string, now = new Date()): void {
  if (trading.mode === mode) return;
  // Orders of the other mode never carry over.
  for (const order of trading.orders.filter((o) => OPEN.includes(o.status) && o.mode !== mode && !o.ackedAt)) order.status = 'cancelled';
  trading.mode = mode;
  emit('system.mode', by, text, { data: { mode } }, now);
}
