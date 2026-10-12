import {
  ASSET_TYPES,
  type AssetType,
  type HistoryPoint,
  type HoldingView,
  type PortfolioSnapshot,
  type TypeSummary,
} from '../../../shared/src/types.js';
import type { AppState } from '../store/state.js';

function emptyByType(): Record<AssetType, number> {
  const out = {} as Record<AssetType, number>;
  for (const type of ASSET_TYPES) out[type] = 0;
  return out;
}

function pct(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Derives every figure the dashboard shows from raw state. Pure: no mutation,
 *  so it is safe to call per request and inside tests. */
export function snapshot(state: AppState): PortfolioSnapshot {
  const byId = new Map(state.instruments.map((i) => [i.id, i]));
  const holdings: HoldingView[] = [];

  let investedValue = 0;
  let costBasis = 0;
  let dayChange = 0;
  let previousValue = 0;
  let income = 0;
  let realizedPnL = 0;

  for (const position of state.positions) {
    const instrument = byId.get(position.instrumentId);
    income += position.realizedIncome;
    realizedPnL += position.realizedPnL;
    if (!instrument || position.quantity === 0) continue;

    const marketValue = position.quantity * instrument.price;
    const cost = position.quantity * position.averageCost;
    const priorValue = position.quantity * instrument.previousClose;

    investedValue += marketValue;
    costBasis += cost;
    previousValue += priorValue;
    dayChange += marketValue - priorValue;

    holdings.push({
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      type: instrument.type,
      sector: instrument.sector,
      exchange: instrument.exchange,
      currency: instrument.currency,
      quantity: position.quantity,
      price: instrument.price,
      previousClose: instrument.previousClose,
      averageCost: position.averageCost,
      marketValue,
      costBasis: cost,
      unrealizedPnL: marketValue - cost,
      unrealizedPnLPct: pct(marketValue - cost, cost),
      dayChange: marketValue - priorValue,
      dayChangePct: pct(marketValue - priorValue, priorValue),
      realizedIncome: position.realizedIncome,
      realizedPnL: position.realizedPnL,
      weight: 0,
    });
  }

  const totalValue = investedValue + state.cash;
  for (const holding of holdings) {
    holding.weight = pct(holding.marketValue, totalValue);
  }
  holdings.sort((a, b) => b.marketValue - a.marketValue);

  const byType: TypeSummary[] = ASSET_TYPES.map((type) => {
    const rows = holdings.filter((h) => h.type === type);
    const value = rows.reduce((sum, h) => sum + h.marketValue, 0);
    const cost = rows.reduce((sum, h) => sum + h.costBasis, 0);
    const change = rows.reduce((sum, h) => sum + h.dayChange, 0);
    const prior = rows.reduce((sum, h) => sum + h.quantity * h.previousClose, 0);
    const typeIncome = rows.reduce((sum, h) => sum + h.realizedIncome, 0);
    const weight = pct(value, investedValue);
    const controls = state.controls[type];

    return {
      type,
      marketValue: value,
      costBasis: cost,
      unrealizedPnL: value - cost,
      unrealizedPnLPct: pct(value - cost, cost),
      dayChange: change,
      dayChangePct: pct(change, prior),
      income: typeIncome,
      positions: rows.length,
      weight,
      targetAllocation: controls.targetAllocation,
      drift: weight - controls.targetAllocation,
      tradingEnabled: controls.tradingEnabled,
    };
  });

  return {
    asOf: new Date(state.simTime).toISOString(),
    cash: state.cash,
    investedValue,
    totalValue,
    costBasis,
    unrealizedPnL: investedValue - costBasis,
    unrealizedPnLPct: pct(investedValue - costBasis, costBasis),
    realizedPnL,
    income,
    dayChange,
    dayChangePct: pct(dayChange, previousValue + state.cash),
    holdings,
    byType,
  };
}

/** The portfolio-value sample recorded on each tick. */
export function historyPoint(state: AppState): HistoryPoint {
  const snap = snapshot(state);
  const byType = emptyByType();
  for (const row of snap.byType) byType[row.type] = row.marketValue;
  return { t: snap.asOf, total: snap.totalValue, byType };
}
