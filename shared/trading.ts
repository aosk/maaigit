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
  /** When the price was true at the exchange (delayed feeds lag), ISO. */
  asOf: string;
  /** When StockSmart received it, ISO. A fill is judged by `asOf`, never by when it arrived. */
  receivedAt: string;
  source: 'yahoo' | 'sim' | 'bot';
}

export interface Position {
  symbol: string;
  qty: number;
  /** Average cost per share (SAR). */
  avgCost: number;
}

/** An order from the moment the risk gate passed it until it is filled, refused or expires. */
/** `unknown`: the broker may or may not have it (the bot was cut off after Submit); it holds its cash and its stock until resolved. */
type OrderStatus = 'queued' | 'sent' | 'filled' | 'partial' | 'rejected' | 'expired' | 'failed' | 'cancelled' | 'unknown';

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
  /** When the price the risk gate priced it from was true at the exchange. */
  priceAsOf?: string;
  /** When the exchange price that filled it (paper) was true. */
  fillPriceAsOf?: string;
  /** Asked to be cancelled (Stop, or expiry while at the broker): a paper order's window ends here; a live one is cancelled at SNB. */
  cancelRequestedAt?: string;
  /** When the bot last got the cancel request, and when it confirmed it. */
  cancelSentAt?: string;
  cancelAckedAt?: string;
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
  | 'order.cancelled'
  | 'order.unknown'
  | 'position.drift'
  | 'system.halted'
  | 'system.resumed'
  | 'system.mode'
  | 'system.limits'
  | 'system.caution'
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
  /** The bot runs in practice mode: it places nothing at the broker. */
  practice: boolean;
}

export interface MarketClock {
  open: boolean;
  /** Minutes until the close while open, until the next open otherwise. */
  minutesToChange: number;
  label: 'open' | 'closed' | 'weekend' | 'holiday';
}

/** A substantial shareholder (5% or more) of a company, as a source last listed them. */
export interface Holder {
  name: string;
  pct: number;
}

/** A change among a company's substantial shareholders: from an announcement, or seen between two listings. */
export interface HolderChange {
  id: string;
  symbol: string;
  holder: string;
  kind: 'new' | 'added' | 'trimmed' | 'exited';
  fromPct?: number;
  toPct?: number;
  /** When it happened, as the source says (YYYY-MM-DD), or when the listing showed it. */
  date: string;
  source: string;
  /** Announced by the company or the exchange (an official disclosure), rather than seen in a listing. */
  official: boolean;
  how: 'announcement' | 'listing';
}

/** «كبار الملاك»: who holds 5% or more of the followed stocks, what changed, and the big investors across them. */
export interface HoldersView {
  updatedAt?: string;
  /** How many of the followed stocks have a listing. */
  covered: number;
  total: number;
  /** The last 60 days, newest first. */
  changes: HolderChange[];
  /** Each big holder and its stakes in the followed stocks, most stakes first (like following an investor's portfolio). */
  investors: { name: string; stakes: { symbol: string; pct: number }[] }[];
  /** Each stock's latest listing. */
  listings: { symbol: string; holders: Holder[]; asOf: string; source: string }[];
}

/** An event ahead that can move a stock or the market: results, a rates decision, an inflation or jobs report. */
export interface CalendarEvent {
  id: string;
  /** The day it happens (YYYY-MM-DD, the market's own day). */
  date: string;
  /** The time if known (HH:MM, Riyadh), else ''. */
  timeRiyadh: string;
  kind: 'earnings' | 'rates' | 'inflation' | 'jobs' | 'other';
  /** The stocks it concerns; empty for the whole market. */
  symbols: string[];
  title: string;
  source: string;
  /** Officially scheduled (the company, the exchange or the central bank says so), not an estimate. */
  confirmed: boolean;
}

/** The weekly review: what the desk did in a week, what worked and what did not, and what to change. */
export interface WeeklyReview {
  /** The Friday that closes the week (YYYY-MM-DD). */
  week: string;
  at: string;
  stats: { orders: number; filled: number; vetoed: number; closed: number; wins: number; losses: number; realized: number; bestSymbol?: string; worstSymbol?: string };
  /** Claude's review in Arabic (empty without Claude: the numbers stand alone). */
  summary: string;
  lessons: string[];
  /** Instructions it suggests; the user adds any of them with one tap. */
  suggestions: string[];
}

/** The quarterly Shariah check of the US list: whether each stock is still held by the S&P 500 Shariah ETF. */
export interface ShariahCheck {
  checkedAt?: string;
  nextDue?: string;
  results: { symbol: string; held: boolean | null; note: string }[];
  /** Stocks found no longer held: trading in them stopped until the user decides. */
  removed: string[];
  source?: string;
  error?: string;
}

/** The market as a whole, at a glance: the index, how the followed stocks move together, and the risk in the news. */
export interface MarketPulse {
  /** -100 (falling hard) to +100 (rising strongly). */
  score: number;
  mood: 'strong_up' | 'up' | 'mixed' | 'down' | 'strong_down';
  /** TASI, when it could be read. */
  index?: { value: number; changePct: number; /** % above (+) or below (-) its 20-day average. */ vsAvg20Pct?: number; change5dPct?: number; asOf: string; source: 'yahoo' | 'sim' };
  /** The followed stocks: how many are up, down or flat today, and their average move. */
  breadth: { up: number; down: number; flat: number; avgChangePct: number };
  /** The most serious market-wide development the news agent reported, and caution mode. */
  risk: 'low' | 'medium' | 'high';
  riskHeadline?: string;
  caution: boolean;
  /** What moved the score, a short Arabic phrase each, strongest first. */
  reasons: string[];
  /** The newest price it was worked out from. */
  asOf?: string;
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
  /** Who decides: Claude (no trade when it is unavailable), or the plain rule, chosen on purpose. */
  decider: Decider;
  /** Caution mode, when on: what set it off, the sectors without new buys, and when it ends by itself. */
  caution?: Caution;
  /** Whether a high-severity market development turns caution mode on by itself. */
  cautionAuto: boolean;
  /** The general market indicator. */
  pulse: MarketPulse;
  /** Substantial shareholders of the followed stocks and their changes. */
  holders: HoldersView;
  /** Which desk this is: Tadawul or the US. */
  market: 'sa' | 'us' | 'crypto';
  currency: 'SAR' | 'USD';
  /** Fractions of a unit can be bought (crypto). */
  fractional: boolean;
  /** The list is halal-screened (the US desk, by the user's choice). */
  halalList: boolean;
  /** Real money is possible on this desk (a broker is connected). */
  liveAllowed: boolean;
  /** The market index the indicator reads. */
  indexName: { ar: string; en: string };
  /** Trading hours in Riyadh time (HH:MM); null when it never closes (crypto). */
  hoursRiyadh: { open: string; close: string } | null;
  /** Events in the next two weeks, soonest first. */
  calendar: CalendarEvent[];
  /** The latest weekly review, if any. */
  review: WeeklyReview | null;
  /** The US list's Shariah check (US desk only). */
  shariah: ShariahCheck | null;
}

export interface Caution {
  since: string;
  until: string;
  sectors: string[];
  reason: string;
  source: string;
}

export type Decider = 'claude' | 'rules';

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
  decider: Decider;
  lastRoundAt?: string;
  agentErrors: string[];
  bot: { connected: boolean; stale: boolean; brokerSession: boolean; practice: boolean; lastSeen?: string };
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
export type TradeOutcome = 'filled' | 'partial' | 'vetoed' | 'open' | 'expired' | 'rejected' | 'failed' | 'cancelled' | 'unknown';

export function outcomeOf(thread: Pick<TradeEvent, 'type' | 'data'>[]): TradeOutcome {
  const last = [...thread].reverse().find((e) => e.type.startsWith('order.') && e.type !== 'order.progress' && e.type !== 'order.sent' && e.type !== 'order.queued');
  if (last) return last.type === 'order.filled' ? 'filled' : (last.type.slice(6) as TradeOutcome);
  const verdict = thread.find((e) => e.type === 'risk.verdict');
  if ((verdict?.data as { verdict?: string } | undefined)?.verdict === 'veto') return 'vetoed';
  return 'open';
}
