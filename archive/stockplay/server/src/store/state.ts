import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASSET_TYPES,
  type Alert,
  type AssetType,
  type EngineSettings,
  type HistoryPoint,
  type Instrument,
  type Order,
  type Position,
  type TypeControls,
} from '../../../shared/src/types.js';
import { SEED_CASH, buildSeed } from './seed.js';

export interface AppState {
  cash: number;
  instruments: Instrument[];
  positions: Position[];
  orders: Order[];
  controls: Record<AssetType, TypeControls>;
  engine: EngineSettings;
  alerts: Alert[];
  history: HistoryPoint[];
  /** Epoch milliseconds of the simulated market clock. */
  simTime: number;
  /** Simulated minutes elapsed in the current trading session. */
  sessionMinutes: number;
  /** Minutes since the last NAV print, per instrument that does not price intraday. */
  navClocks: Record<string, number>;
  /** RNG cursor, so a restored state continues the same price path. */
  seed: number;
}

/** History is capped so the JSON file and the dashboard payload stay small. */
export const MAX_HISTORY_POINTS = 720;
export const MAX_ORDERS = 500;
export const MAX_ALERTS = 200;

const DEFAULT_TARGETS: Record<AssetType, number> = {
  COMMON: 0.34,
  PREFERRED: 0.1,
  ETF: 0.3,
  REIT: 0.1,
  ADR: 0.08,
  MUTUAL_FUND: 0.08,
};

export function defaultControls(): Record<AssetType, TypeControls> {
  const out = {} as Record<AssetType, TypeControls>;
  for (const type of ASSET_TYPES) {
    out[type] = {
      type,
      tradingEnabled: true,
      targetAllocation: DEFAULT_TARGETS[type],
      maxPositionPct: 0.2,
      moveAlertPct: 0.03,
      stopLossPct: 0.15,
      volatilityFactor: 1,
    };
  }
  return out;
}

export function defaultEngine(): EngineSettings {
  return {
    running: true,
    minutesPerTick: 5,
    tickIntervalMs: 2000,
    marketVolatility: 1,
    marketSentiment: 0,
  };
}

export function createInitialState(now = new Date()): AppState {
  const iso = now.toISOString();
  const { instruments, positions } = buildSeed(iso);
  const navClocks: Record<string, number> = {};
  for (const instrument of instruments) navClocks[instrument.id] = 0;

  return {
    cash: SEED_CASH,
    instruments,
    positions,
    orders: [],
    controls: defaultControls(),
    engine: defaultEngine(),
    alerts: [],
    history: [],
    simTime: now.getTime(),
    sessionMinutes: 0,
    navClocks,
    seed: 0x9e3779b9,
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = process.env.STOCKPLAY_DATA_FILE
  ? resolve(process.env.STOCKPLAY_DATA_FILE)
  : resolve(HERE, '../../data/state.json');

/** Fills in anything a state file from an older build is missing, so a stale
 *  file degrades to defaults instead of crashing the server. */
function reconcile(loaded: Partial<AppState>): AppState {
  const fresh = createInitialState();
  const controls = { ...fresh.controls };
  for (const type of ASSET_TYPES) {
    const saved = loaded.controls?.[type];
    if (saved) controls[type] = { ...controls[type], ...saved, type };
  }
  const instruments = loaded.instruments?.length ? loaded.instruments : fresh.instruments;
  const navClocks = { ...loaded.navClocks };
  for (const instrument of instruments) navClocks[instrument.id] ??= 0;

  return {
    cash: typeof loaded.cash === 'number' ? loaded.cash : fresh.cash,
    instruments,
    positions: loaded.positions ?? fresh.positions,
    orders: loaded.orders ?? [],
    controls,
    engine: { ...fresh.engine, ...loaded.engine },
    alerts: loaded.alerts ?? [],
    history: loaded.history ?? [],
    simTime: loaded.simTime ?? fresh.simTime,
    sessionMinutes: loaded.sessionMinutes ?? 0,
    navClocks,
    seed: loaded.seed ?? fresh.seed,
  };
}

export function loadState(): AppState {
  try {
    const raw = readFileSync(DATA_FILE, 'utf8');
    return reconcile(JSON.parse(raw) as Partial<AppState>);
  } catch {
    return createInitialState();
  }
}

/** Writes through a temp file so a crash mid-write cannot leave a truncated
 *  state.json behind. */
export function saveState(state: AppState): void {
  try {
    mkdirSync(dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), 'utf8');
    renameSync(tmp, DATA_FILE);
  } catch (err) {
    console.error('[stockplay] could not persist state:', (err as Error).message);
  }
}

export const DATA_FILE_PATH = DATA_FILE;
