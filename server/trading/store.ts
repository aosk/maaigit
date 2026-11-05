import fs from 'node:fs';
import path from 'node:path';
import type { AgentId, Caution, Decider, Position, TradeEvent, TradeEventType, TradeLimits, TradeMode, TradeOrder } from '../../shared/trading.js';
import { config } from '../config.js';
import { writePrivate } from '../secure-fs.js';
import { tradingDay } from './tadawul.js';

/**
 * StockSmart's own data, in its own file beside MAAI's: the mode and limits, the paper and live books, the orders and
 * the append-only event log. Kept apart so nothing else in MAAI can damage it, and so it can be read on its own.
 */

/** One set of holdings: paper money inside the server, or the real account as the desktop bot last reported it. */
export interface Book {
  cash: number;
  positions: Position[];
  /** Profit taken on sales, all time and today. */
  realized: number;
  /** The book's value when the trading day began, for today's profit or loss. */
  dayStart: { day: string; value: number; realized: number };
  /** Today's value through the day, for the chart. */
  curve: { at: string; value: number }[];
}

export interface TradingData {
  mode: TradeMode;
  /** Who decides each round: Claude, or the plain rule (chosen by the user, never switched to silently). */
  decider: Decider;
  /** Caution mode (half-size buys, none in the sectors named) while a serious market development is fresh. */
  caution?: Caution;
  /** A high-severity, confirmed market development turns caution on by itself (the user can turn this off). */
  cautionAuto: boolean;
  halted: boolean;
  haltReason?: string;
  limits: TradeLimits;
  /** Stocks the user told the agents to leave alone. */
  excluded: string[];
  /** The user's standing instructions to the agents ("no banks today"). */
  directives: { id: string; text: string; at: string }[];
  books: Record<TradeMode, Book>;
  orders: TradeOrder[];
  events: TradeEvent[];
  nextEventId: number;
  ordersToday: { day: string; count: number };
  agents: Partial<Record<AgentId, { enabled: boolean; lastRunAt?: string; lastError?: string }>>;
  /** The desktop bot: its key (only the hash), the secret commands are signed with, and what it last said. */
  bot: { keyHash?: string; keyHint?: string; signSecret?: string; lastSeen?: string; brokerSession?: boolean; expiresInSec?: number; practice?: boolean };
}

export const DEFAULT_LIMITS: TradeLimits = { capital: 100_000, maxOrder: 10_000, maxPerSymbolPct: 20, maxPerSectorPct: 35, maxOrdersPerDay: 8, dailyLossPct: 2, cycleMinutes: 15 };

const KEEP_EVENTS = 2_000;
const KEEP_ORDERS = 300;
const CURVE_POINTS = 400;

const FILE = process.env.MAAI_TRADING_FILE ?? path.join(config.dataDir, 'trading.json');

export function newBook(cash: number, now = new Date()): Book {
  return { cash, positions: [], realized: 0, dayStart: { day: tradingDay(now), value: cash, realized: 0 }, curve: [] };
}

function fresh(): TradingData {
  return {
    mode: 'paper',
    decider: 'claude',
    cautionAuto: true,
    halted: false,
    limits: { ...DEFAULT_LIMITS },
    excluded: [],
    directives: [],
    books: { paper: newBook(DEFAULT_LIMITS.capital), live: newBook(0) },
    orders: [],
    events: [],
    nextEventId: 1,
    ordersToday: { day: '', count: 0 },
    agents: {},
    bot: {},
  };
}

function read(): TradingData {
  let text: string;
  try {
    text = fs.readFileSync(FILE, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fresh();
    // A file that exists but cannot be opened must not be replaced with an empty one.
    throw new Error(`StockSmart's data at ${FILE} could not be opened (${(error as Error).message}).`, { cause: error });
  }
  try {
    const saved = JSON.parse(text) as Partial<TradingData>;
    const base = fresh();
    return { ...base, ...saved, limits: { ...base.limits, ...saved.limits }, books: { ...base.books, ...saved.books }, agents: saved.agents ?? {}, bot: saved.bot ?? {} };
  } catch {
    // Kept aside, never overwritten: the record of real trades matters more than starting cleanly.
    writePrivate(`${FILE}.damaged-${Date.now()}`, text);
    console.error('StockSmart data could not be read; a copy was kept and trading starts halted.');
    return { ...fresh(), halted: true, haltReason: 'The saved trading data could not be read.' };
  }
}

export const trading: TradingData = read();

let timer: NodeJS.Timeout | undefined;
export function saveTrading(): void {
  if (timer) return;
  timer = setTimeout(flushTrading, 300);
  timer.unref?.();
}

export function flushTrading(): void {
  if (timer) clearTimeout(timer);
  timer = undefined;
  if (trading.events.length > KEEP_EVENTS) trading.events = trading.events.slice(-KEEP_EVENTS);
  // Orders still in play, an unknown one above all, are never trimmed.
  const open = trading.orders.filter((o) => o.status === 'queued' || o.status === 'sent' || o.status === 'partial' || o.status === 'unknown');
  if (trading.orders.length > KEEP_ORDERS) trading.orders = [...trading.orders.filter((o) => !open.includes(o)).slice(-KEEP_ORDERS), ...open];
  for (const book of Object.values(trading.books)) if (book.curve.length > CURVE_POINTS) book.curve = book.curve.filter((_, i, all) => i % 2 === 0 || i === all.length - 1);
  try {
    writePrivate(FILE, JSON.stringify(trading));
  } catch (error) {
    console.error(`StockSmart could not save (${(error as Error).message}); trying again in 30 seconds.`);
    timer = setTimeout(flushTrading, 30_000);
    timer.unref?.();
  }
}

type Listener = (event: TradeEvent) => void;
const listeners = new Set<Listener>();

/** Live screens follow the log; returns the unsubscribe. */
export function onTradeEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Adds one event to the log. Nothing on the log is ever changed or removed (old ones roll off the end). */
export function emit(type: TradeEventType, actor: AgentId, text: string, extra: { data?: Record<string, unknown>; correlationId?: string } = {}, now = new Date()): TradeEvent {
  const event: TradeEvent = { id: trading.nextEventId++, ts: now.toISOString(), type, actor, text: text.slice(0, 600), ...extra };
  trading.events.push(event);
  saveTrading();
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // A broken listener (a closed connection) must not stop the log.
    }
  }
  return event;
}

/** Events after `id`, for a stream that reconnected. */
export const eventsSince = (id: number) => trading.events.filter((e) => e.id > id);

/** Starts again with nothing (tests only). */
export function resetTrading(): void {
  Object.assign(trading, fresh());
  listeners.clear();
}
