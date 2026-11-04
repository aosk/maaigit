/**
 * StockSmart: agents that trade Tadawul shares inside limits the user sets, an executor (paper, or the user's own
 * desktop bot at SNB Capital) that places only what passed the risk gate, and one append-only log of everything
 * they do. Machines can stop trading; only the user can start it again, switch to real money or widen the limits.
 */

/** Paper fills at the delayed market price inside the server; live sends signed commands to the desktop bot. */
export type TradeMode = 'paper' | 'live';
export type Side = 'buy' | 'sell';

/** Every participant has a fixed id; the UI gives each one colour for life. */
export type AgentId = 'technical' | 'news' | 'decision' | 'risk' | 'executor' | 'system' | 'user';

/** The hard limits. The risk gate (code, not AI) enforces them on every order; only the user changes them. */
export interface TradeLimits {
  /** The most money the agents may have invested at once (SAR). */
  capital: number;
  /** The most one order may be worth (SAR). */
  maxOrder: number;
  /** The most one stock may be of `capital` (percent). */
  maxPerSymbolPct: number;
  /** The most one sector may be of `capital` (percent). */
  maxPerSectorPct: number;
  /** Orders a day, buys and sells together. */
  maxOrdersPerDay: number;
  /** Losing this much of `capital` in a day (percent) halts trading until the user resumes it. */
  dailyLossPct: number;
  /** Minutes between the agents' rounds while the market is open. */
  cycleMinutes: number;
}

export interface Instrument {
  /** The 4-digit Tadawul code, e.g. "2222". */
  symbol: string;
  nameAr: string;
  nameEn: string;
  sector: string;
}

export interface Quote {
  symbol: string;
  price: number;
  /** The previous session's close, for the day's change and the ±10% price band. */
  prevClose: number;
  /** When the price was true (delayed feeds lag), ISO. */
  asOf: string;
  source: 'yahoo' | 'sim' | 'bot';
}

export interface Position {
  symbol: string;
  qty: number;
  /** Average cost per share (SAR). */
  avgCost: number;
}

/** An order from the moment the risk gate passed it until it is filled, refused or expires. */
type OrderStatus = 'queued' | 'sent' | 'filled' | 'partial' | 'rejected' | 'expired' | 'failed' | 'cancelled';

export interface TradeOrder {
  id: string;
  /** The decision it came from, so the UI can show the deliberation behind it. */
  decisionId: string;
  symbol: string;
  side: Side;
  qty: number;
  limitPrice: number;
  status: OrderStatus;
  mode: TradeMode;
  createdAt: string;
  /** Past this the executor must not place it. */
  expiresAt: string;
  filledQty: number;
  avgFillPrice?: number;
  brokerOrderId?: string;
  error?: string;
  /** When the command last went to the desktop bot. */
  sentAt?: string;
  /** When the desktop bot confirmed it has the command (until then it is sent again). */
  ackedAt?: string;
  /** What the desktop bot said it is doing: logging in, form filled, submitted… */
  stage?: string;
}

/** One event on the log. One shape for everything, so the live screen needs no special case per type. */
export interface TradeEvent {
  /** Increasing; the live stream resumes from the last one it saw. */
  id: number;
  /** Stamped by the server clock, never by the sender. */
  ts: string;
  type: TradeEventType;
  actor: AgentId;
  /** The decision id, tying one deliberation together. */
  correlationId?: string;
  /** One line for the timeline, in the language it was written in. */
  text: string;
  data?: Record<string, unknown>;
}

export type TradeEventType =
  | 'agent.observation'
  | 'agent.error'
  | 'decision.created'
  | 'risk.verdict'
  | 'order.queued'
  | 'order.sent'
  | 'order.progress'
  | 'order.filled'
  | 'order.rejected'
  | 'order.expired'
  | 'order.failed'
  | 'position.drift'
  | 'system.halted'
  | 'system.resumed'
  | 'system.mode'
  | 'system.limits'
  | 'user.directive'
  | 'user.question'
  | 'agent.answer'
  | 'executor.heartbeat';

interface AgentHealth {
  id: AgentId;
  enabled: boolean;
  lastRunAt?: string;
  lastError?: string;
}

interface ExecutorHealth {
  /** A desktop bot key exists. */
  connected: boolean;
  keyHint?: string;
  lastSeen?: string;
  /** The bot says it is logged in at the broker. */
  brokerSession: boolean;
  /** Not heard from for longer than the dead-man interval. */
  stale: boolean;
}

export interface MarketClock {
  open: boolean;
  /** Minutes until the close while open, until the next open otherwise. */
  minutesToChange: number;
  label: 'open' | 'closed' | 'weekend' | 'holiday';
}

/** Everything the StockSmart screen needs for its first paint; the stream keeps it current. */
export interface TradingState {
  mode: TradeMode;
  halted: boolean;
  haltReason?: string;
  limits: TradeLimits;
  universe: Instrument[];
  excluded: string[];
  directives: { id: string; text: string; at: string }[];
  cash: number;
  positions: (Position & { price?: number; prevClose?: number })[];
  /** Today's profit or loss, realised and not, in SAR, and as a share of `limits.capital`. */
  dayPnl: number;
  dayPnlPct: number;
  totalPnl: number;
  portfolioValue: number;
  ordersToday: number;
  /** Today's portfolio value through the day, for the chart. */
  curve: { at: string; value: number }[];
  orders: TradeOrder[];
  events: TradeEvent[];
  agents: AgentHealth[];
  executor: ExecutorHealth;
  clock: MarketClock;
  /** How fresh the prices are. */
  quotesAsOf?: string;
  quotesSource?: Quote['source'];
  /** Claude is set up (without it the agents only watch). */
  agentsCanDecide: boolean;
}

/** StockSmart in Settings → Connections: the desk, its prices and agents, and the SNB desktop bot. */
export interface TradingSummary {
  mode: TradeMode;
  halted: boolean;
  haltReason?: string;
  marketOpen: boolean;
  quotesAsOf?: string;
  quotesSource?: Quote['source'];
  /** Recent enough to trade on. */
  quotesFresh: boolean;
  agentsCanDecide: boolean;
  lastRoundAt?: string;
  agentErrors: string[];
  bot: { connected: boolean; stale: boolean; brokerSession: boolean; lastSeen?: string };
}

/** The log's categories, for filtering and counting: what the agents read, what they decided, the risk gate, orders, alerts, and you. */
export type LogCategory = 'analysis' | 'decisions' | 'risk' | 'orders' | 'alerts' | 'you';
export const LOG_CATEGORIES: LogCategory[] = ['analysis', 'decisions', 'risk', 'orders', 'alerts', 'you'];

export function categoryOf(e: Pick<TradeEvent, 'type'>): LogCategory {
  if (e.type === 'decision.created') return 'decisions';
  if (e.type === 'risk.verdict') return 'risk';
  if (e.type.startsWith('order.')) return 'orders';
  if (e.type === 'agent.observation') return 'analysis';
  if (e.type.startsWith('user.') || e.type === 'agent.answer' || e.type === 'system.limits') return 'you';
  return 'alerts';
}

/** How one decision ended, from its events on the log. */
export type TradeOutcome = 'filled' | 'partial' | 'vetoed' | 'open' | 'expired' | 'rejected' | 'failed' | 'cancelled';

export function outcomeOf(thread: Pick<TradeEvent, 'type' | 'data'>[]): TradeOutcome {
  const last = [...thread].reverse().find((e) => e.type.startsWith('order.') && e.type !== 'order.progress' && e.type !== 'order.sent' && e.type !== 'order.queued');
  if (last) return last.type === 'order.filled' ? 'filled' : (last.type.slice(6) as TradeOutcome);
  const verdict = thread.find((e) => e.type === 'risk.verdict');
  if ((verdict?.data as { verdict?: string } | undefined)?.verdict === 'veto') return 'vetoed';
  return 'open';
}
