import {
  ASSET_TYPE_PROFILES,
  type Instrument,
} from '../../../shared/src/types.js';
import type { AppState } from '../store/state.js';
import { MAX_HISTORY_POINTS } from '../store/state.js';
import { gaussian, mulberry32 } from './random.js';

/** Trading minutes in one simulated session. */
export const SESSION_MINUTES = 390;
/** Trading sessions in a simulated year, used to annualise drift and vol. */
export const SESSIONS_PER_YEAR = 252;
/** A fund reprints its NAV once per session. */
export const NAV_WINDOW_MINUTES = SESSION_MINUTES;

export interface TickResult {
  /** Instruments whose price changed on this tick. */
  moved: Instrument[];
  /** True when the tick rolled the simulated clock into a new session. */
  sessionRolled: boolean;
  /** Dividend and distribution cash credited on this tick. */
  incomeCredited: number;
}

function clampPrice(price: number): number {
  // A simulated price may wander but must stay a tradable positive number.
  return Math.max(0.01, Math.round(price * 100) / 100);
}

/**
 * Advances the simulated market by one tick, mutating `state` in place.
 *
 * Prices follow geometric Brownian motion parameterised per asset type: each
 * type contributes its own drift, volatility and dividend yield, then the
 * per-type `volatilityFactor` and the global engine settings scale it. Types
 * that do not price intraday (mutual funds) hold their last print until a full
 * NAV window of simulated minutes has elapsed.
 */
export function tick(state: AppState): TickResult {
  const rand = mulberry32(state.seed);
  const { minutesPerTick, marketVolatility, marketSentiment } = state.engine;
  const dt = minutesPerTick / (SESSION_MINUTES * SESSIONS_PER_YEAR);

  const moved: Instrument[] = [];
  let incomeCredited = 0;

  for (const instrument of state.instruments) {
    if (!instrument.active) continue;

    const profile = ASSET_TYPE_PROFILES[instrument.type];
    const controls = state.controls[instrument.type];

    // Funds only reprice when their NAV window closes; everything else ticks.
    let step = minutesPerTick;
    if (!profile.pricesIntraday) {
      const elapsed = (state.navClocks[instrument.id] ?? 0) + minutesPerTick;
      if (elapsed < NAV_WINDOW_MINUTES) {
        state.navClocks[instrument.id] = elapsed;
        continue;
      }
      state.navClocks[instrument.id] = 0;
      step = elapsed;
    }

    const stepDt = step / (SESSION_MINUTES * SESSIONS_PER_YEAR);
    const drift = profile.drift + marketSentiment * 0.15;
    const vol = profile.volatility * controls.volatilityFactor * marketVolatility;
    const shock = gaussian(rand);
    const next =
      instrument.price *
      Math.exp((drift - (vol * vol) / 2) * stepDt + vol * Math.sqrt(stepDt) * shock);

    instrument.price = clampPrice(next);
    instrument.updatedAt = new Date(state.simTime).toISOString();
    moved.push(instrument);

    // Dividends and distributions accrue continuously into cash.
    const position = state.positions.find((p) => p.instrumentId === instrument.id);
    if (position && position.quantity > 0 && profile.dividendYield > 0) {
      const income = position.quantity * instrument.price * profile.dividendYield * stepDt;
      position.realizedIncome += income;
      incomeCredited += income;
    }
  }

  state.cash += incomeCredited;
  state.seed = (state.seed + 0x6d2b79f5) >>> 0;
  state.simTime += minutesPerTick * 60_000;
  state.sessionMinutes += minutesPerTick;

  let sessionRolled = false;
  if (state.sessionMinutes >= SESSION_MINUTES) {
    state.sessionMinutes -= SESSION_MINUTES;
    sessionRolled = true;
    for (const instrument of state.instruments) {
      instrument.previousClose = instrument.price;
    }
  }

  return { moved, sessionRolled, incomeCredited };
}

/** Appends a portfolio-value sample, keeping the series bounded. */
export function recordHistory(state: AppState, point: AppState['history'][number]): void {
  state.history.push(point);
  if (state.history.length > MAX_HISTORY_POINTS) {
    state.history.splice(0, state.history.length - MAX_HISTORY_POINTS);
  }
}
