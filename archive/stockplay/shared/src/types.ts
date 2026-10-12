/** The stock types StockPlay can hold. Each behaves differently in the market
 *  simulation and carries its own risk controls. */
export const ASSET_TYPES = [
  'COMMON',
  'PREFERRED',
  'ETF',
  'REIT',
  'ADR',
  'MUTUAL_FUND',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export interface AssetTypeProfile {
  /** Human label used in the UI. */
  label: string;
  /** One-line description shown on the control page. */
  blurb: string;
  /** Annualised drift used by the price simulation. */
  drift: number;
  /** Annualised volatility used by the price simulation. */
  volatility: number;
  /** Annual dividend / distribution yield, paid as a cash accrual. */
  dividendYield: number;
  /** Mutual funds only price once per NAV window; intraday quotes are stale. */
  pricesIntraday: boolean;
}

export const ASSET_TYPE_PROFILES: Record<AssetType, AssetTypeProfile> = {
  COMMON: {
    label: 'Common stock',
    blurb: 'Ordinary shares with voting rights. The default equity exposure.',
    drift: 0.08,
    volatility: 0.26,
    dividendYield: 0.012,
    pricesIntraday: true,
  },
  PREFERRED: {
    label: 'Preferred stock',
    blurb: 'Bond-like shares: fixed dividend, muted price swings, no votes.',
    drift: 0.03,
    volatility: 0.09,
    dividendYield: 0.055,
    pricesIntraday: true,
  },
  ETF: {
    label: 'ETF',
    blurb: 'Exchange-traded baskets. Diversification damps single-name shocks.',
    drift: 0.07,
    volatility: 0.16,
    dividendYield: 0.018,
    pricesIntraday: true,
  },
  REIT: {
    label: 'REIT',
    blurb: 'Real-estate trusts. Rate sensitive, distribution heavy.',
    drift: 0.05,
    volatility: 0.21,
    dividendYield: 0.042,
    pricesIntraday: true,
  },
  ADR: {
    label: 'ADR',
    blurb: 'Foreign issuers listed locally. Carries an FX component.',
    drift: 0.06,
    volatility: 0.31,
    dividendYield: 0.022,
    pricesIntraday: true,
  },
  MUTUAL_FUND: {
    label: 'Mutual fund',
    blurb: 'Priced once per NAV window, not continuously through the day.',
    drift: 0.06,
    volatility: 0.13,
    dividendYield: 0.015,
    pricesIntraday: false,
  },
};

export interface Instrument {
  id: string;
  symbol: string;
  name: string;
  type: AssetType;
  exchange: string;
  sector: string;
  currency: string;
  /** Last traded price (or last NAV for funds). */
  price: number;
  /** Reference price at the start of the current session. */
  previousClose: number;
  /** Price at the moment the instrument was created, used for since-added stats. */
  basePrice: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Position {
  instrumentId: string;
  quantity: number;
  /** Average cost per share, in the instrument's currency. */
  averageCost: number;
  /** Dividends and distributions credited to cash so far. */
  realizedIncome: number;
  /** Cash profit/loss booked from sells. */
  realizedPnL: number;
}

export type OrderSide = 'BUY' | 'SELL';

export interface Order {
  id: string;
  instrumentId: string;
  symbol: string;
  type: AssetType;
  side: OrderSide;
  quantity: number;
  price: number;
  /** quantity * price, always positive. */
  notional: number;
  createdAt: string;
}

/** Per-type risk and automation controls, edited on the control page. */
export interface TypeControls {
  type: AssetType;
  /** When false, the API rejects orders for every instrument of this type. */
  tradingEnabled: boolean;
  /** Share of portfolio value this type should hold, 0-1. */
  targetAllocation: number;
  /** Hard cap on a single position's share of portfolio value, 0-1. */
  maxPositionPct: number;
  /** Absolute day move (0-1) past which an alert is raised. */
  moveAlertPct: number;
  /** Loss from average cost (0-1) past which an alert is raised. 0 disables. */
  stopLossPct: number;
  /** Multiplies the type's simulated volatility, 0.1-3. */
  volatilityFactor: number;
}

export interface EngineSettings {
  /** Whether the price simulation is advancing. */
  running: boolean;
  /** Simulated minutes advanced per tick. */
  minutesPerTick: number;
  /** Wall-clock milliseconds between ticks. */
  tickIntervalMs: number;
  /** Global multiplier applied on top of each type's volatility factor. */
  marketVolatility: number;
  /** Bias applied to every instrument's drift: -1 bearish, 0 neutral, 1 bullish. */
  marketSentiment: number;
}

export type AlertKind = 'MOVE' | 'STOP_LOSS' | 'ALLOCATION' | 'POSITION_LIMIT';
export type AlertSeverity = 'good' | 'warning' | 'serious' | 'critical';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  type: AssetType;
  instrumentId?: string;
  symbol?: string;
  message: string;
  createdAt: string;
  acknowledged: boolean;
}

/** One point on the portfolio value curve. */
export interface HistoryPoint {
  t: string;
  /** Total portfolio value: cash + market value of every position. */
  total: number;
  /** Market value per asset type at that moment. */
  byType: Record<AssetType, number>;
}

export interface HoldingView {
  instrumentId: string;
  symbol: string;
  name: string;
  type: AssetType;
  sector: string;
  exchange: string;
  currency: string;
  quantity: number;
  price: number;
  previousClose: number;
  averageCost: number;
  marketValue: number;
  costBasis: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  dayChange: number;
  dayChangePct: number;
  realizedIncome: number;
  realizedPnL: number;
  /** Share of total portfolio value, 0-1. */
  weight: number;
}

export interface TypeSummary {
  type: AssetType;
  marketValue: number;
  costBasis: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  dayChange: number;
  dayChangePct: number;
  income: number;
  positions: number;
  /** Share of invested value, 0-1. */
  weight: number;
  targetAllocation: number;
  /** weight - targetAllocation, signed drift from target. */
  drift: number;
  tradingEnabled: boolean;
}

export interface PortfolioSnapshot {
  asOf: string;
  cash: number;
  investedValue: number;
  totalValue: number;
  costBasis: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  realizedPnL: number;
  income: number;
  dayChange: number;
  dayChangePct: number;
  holdings: HoldingView[];
  byType: TypeSummary[];
}
