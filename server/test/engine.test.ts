import { describe, expect, it } from 'vitest';
import { ASSET_TYPES } from '../../shared/src/types.js';
import { evaluateAlerts } from '../src/engine/alerts.js';
import { SESSION_MINUTES, tick } from '../src/engine/market.js';
import { historyPoint, snapshot } from '../src/engine/portfolio.js';
import { TradeError, placeOrder } from '../src/engine/trading.js';
import { createInitialState, type AppState } from '../src/store/state.js';

function fresh(): AppState {
  return createInitialState(new Date('2026-01-05T14:30:00.000Z'));
}

describe('market simulation', () => {
  it('is deterministic for a given seed', () => {
    const a = fresh();
    const b = fresh();
    for (let i = 0; i < 25; i += 1) {
      tick(a);
      tick(b);
    }
    expect(a.instruments.map((i) => i.price)).toEqual(b.instruments.map((i) => i.price));
  });

  it('keeps mutual funds flat until a NAV window closes', () => {
    const state = fresh();
    const fund = state.instruments.find((i) => i.type === 'MUTUAL_FUND')!;
    const before = fund.price;

    state.engine.minutesPerTick = 5;
    tick(state);
    expect(fund.price).toBe(before);

    // Advance past a full session so the NAV window closes.
    for (let i = 0; i < SESSION_MINUTES / 5; i += 1) tick(state);
    expect(fund.price).not.toBe(before);
  });

  it('reprices common stock on every tick', () => {
    const state = fresh();
    const common = state.instruments.find((i) => i.type === 'COMMON')!;
    const before = common.price;
    tick(state);
    expect(common.price).not.toBe(before);
  });

  it('rolls previousClose when the session turns over', () => {
    const state = fresh();
    state.engine.minutesPerTick = SESSION_MINUTES;
    const result = tick(state);
    expect(result.sessionRolled).toBe(true);
    for (const instrument of state.instruments) {
      expect(instrument.previousClose).toBe(instrument.price);
    }
  });

  it('credits dividend income into cash', () => {
    const state = fresh();
    const cashBefore = state.cash;
    state.engine.minutesPerTick = SESSION_MINUTES;
    const result = tick(state);
    expect(result.incomeCredited).toBeGreaterThan(0);
    expect(state.cash).toBeCloseTo(cashBefore + result.incomeCredited, 6);
  });

  it('scales moves with the per-type volatility factor', () => {
    const calm = fresh();
    const wild = fresh();
    for (const type of ASSET_TYPES) wild.controls[type].volatilityFactor = 3;

    let calmSpread = 0;
    let wildSpread = 0;
    for (let i = 0; i < 60; i += 1) {
      tick(calm);
      tick(wild);
    }
    for (const instrument of calm.instruments) {
      calmSpread += Math.abs(instrument.price / instrument.basePrice - 1);
    }
    for (const instrument of wild.instruments) {
      wildSpread += Math.abs(instrument.price / instrument.basePrice - 1);
    }
    expect(wildSpread).toBeGreaterThan(calmSpread);
  });
});

describe('portfolio derivation', () => {
  it('totals cash plus every position', () => {
    const state = fresh();
    const snap = snapshot(state);
    const manual = state.positions.reduce((sum, position) => {
      const instrument = state.instruments.find((i) => i.id === position.instrumentId)!;
      return sum + position.quantity * instrument.price;
    }, 0);
    expect(snap.investedValue).toBeCloseTo(manual, 6);
    expect(snap.totalValue).toBeCloseTo(manual + state.cash, 6);
  });

  it('reports every asset type, including ones with no position', () => {
    const state = fresh();
    expect(snapshot(state).byType.map((row) => row.type)).toEqual([...ASSET_TYPES]);
  });

  it('weights sum to the invested share of the portfolio', () => {
    const snap = snapshot(fresh());
    const total = snap.byType.reduce((sum, row) => sum + row.weight, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it('drift is the signed gap from the type target', () => {
    const state = fresh();
    const snap = snapshot(state);
    for (const row of snap.byType) {
      expect(row.drift).toBeCloseTo(row.weight - state.controls[row.type].targetAllocation, 9);
    }
  });

  it('history points carry a value for every type', () => {
    const point = historyPoint(fresh());
    expect(Object.keys(point.byType).sort()).toEqual([...ASSET_TYPES].sort());
  });
});

describe('order execution', () => {
  it('buys at the current price and moves cash into the position', () => {
    const state = fresh();
    const instrument = state.instruments.find((i) => i.symbol === 'KELP')!;
    const cashBefore = state.cash;

    const order = placeOrder(state, { instrumentId: instrument.id, side: 'BUY', quantity: 10 });
    expect(order.notional).toBeCloseTo(10 * instrument.price, 6);
    expect(state.cash).toBeCloseTo(cashBefore - order.notional, 6);

    const position = state.positions.find((p) => p.instrumentId === instrument.id)!;
    expect(position.quantity).toBe(150);
  });

  it('books realised P&L on a sell', () => {
    const state = fresh();
    const instrument = state.instruments.find((i) => i.symbol === 'NVCR')!;
    const position = state.positions.find((p) => p.instrumentId === instrument.id)!;
    const cost = position.averageCost;

    placeOrder(state, { instrumentId: instrument.id, side: 'SELL', quantity: 20 });
    expect(position.quantity).toBe(160);
    expect(position.realizedPnL).toBeCloseTo((instrument.price - cost) * 20, 6);
  });

  it('refuses a sell larger than the position', () => {
    const state = fresh();
    const instrument = state.instruments.find((i) => i.symbol === 'NVCR')!;
    expect(() =>
      placeOrder(state, { instrumentId: instrument.id, side: 'SELL', quantity: 10_000 }),
    ).toThrow(TradeError);
  });

  it('refuses a buy the cash balance cannot cover', () => {
    const state = fresh();
    const instrument = state.instruments.find((i) => i.symbol === 'BRDX')!;
    expect(() =>
      placeOrder(state, { instrumentId: instrument.id, side: 'BUY', quantity: 100_000 }),
    ).toThrow(/cash is available/);
  });

  it('refuses to trade a type whose switch is off', () => {
    const state = fresh();
    state.controls.ETF.tradingEnabled = false;
    const etf = state.instruments.find((i) => i.type === 'ETF')!;
    expect(() => placeOrder(state, { instrumentId: etf.id, side: 'BUY', quantity: 1 })).toThrow(
      /Trading is switched off/,
    );
  });

  it('enforces the per-type single-position cap', () => {
    const state = fresh();
    state.controls.COMMON.maxPositionPct = 0.05;
    const instrument = state.instruments.find((i) => i.symbol === 'KELP')!;
    expect(() =>
      placeOrder(state, { instrumentId: instrument.id, side: 'BUY', quantity: 200 }),
    ).toThrow(/over the 5% cap/);
  });

  it('rejects fractional and non-positive quantities', () => {
    const state = fresh();
    const instrument = state.instruments[0];
    expect(() => placeOrder(state, { instrumentId: instrument.id, side: 'BUY', quantity: 0 })).toThrow(
      TradeError,
    );
    expect(() =>
      placeOrder(state, { instrumentId: instrument.id, side: 'BUY', quantity: -5 }),
    ).toThrow(TradeError);
  });
});

describe('alerts', () => {
  it('raises a stop-loss alert once, not on every evaluation', () => {
    const state = fresh();
    state.controls.COMMON.stopLossPct = 0.05;
    state.controls.COMMON.moveAlertPct = 0;

    const first = evaluateAlerts(state, snapshot(state));
    expect(first.some((a) => a.kind === 'STOP_LOSS' && a.symbol === 'BRWD')).toBe(true);

    const second = evaluateAlerts(state, snapshot(state));
    expect(second.some((a) => a.kind === 'STOP_LOSS' && a.symbol === 'BRWD')).toBe(false);
  });

  it('re-raises once the earlier alert is acknowledged', () => {
    const state = fresh();
    state.controls.COMMON.stopLossPct = 0.05;
    evaluateAlerts(state, snapshot(state));
    for (const alert of state.alerts) alert.acknowledged = true;

    const again = evaluateAlerts(state, snapshot(state));
    expect(again.some((a) => a.kind === 'STOP_LOSS')).toBe(true);
  });

  it('flags a type that has drifted from its target allocation', () => {
    const state = fresh();
    state.controls.ETF.targetAllocation = 0.01;
    const raised = evaluateAlerts(state, snapshot(state));
    expect(raised.some((a) => a.kind === 'ALLOCATION' && a.type === 'ETF')).toBe(true);
  });

  it('flags a position over its type cap', () => {
    const state = fresh();
    state.controls.ETF.maxPositionPct = 0.01;
    const raised = evaluateAlerts(state, snapshot(state));
    expect(raised.some((a) => a.kind === 'POSITION_LIMIT' && a.type === 'ETF')).toBe(true);
  });
});
