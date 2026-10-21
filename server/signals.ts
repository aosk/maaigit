/**
 * How the last attempt of each kind of work went (a Claude call, saving the data, reading Gmail…), kept in
 * memory for the health check. A leaf module: anything can report here without import cycles.
 */

export type Signal = 'claude' | 'storage' | 'gmail' | 'replies' | 'push';

export interface SignalState {
  lastOk?: string;
  lastFail?: string;
  /** The last failure in a few words (never secrets: callers pass their own short message). */
  error?: string;
  /** Milliseconds the last successful attempt took, when measured. */
  ms?: number;
  failures: number;
}

const signals = new Map<Signal, SignalState>();

const get = (name: Signal) => signals.get(name) ?? signals.set(name, { failures: 0 }).get(name)!;

export function ok(name: Signal, ms?: number): void {
  const s = get(name);
  s.lastOk = new Date().toISOString();
  s.ms = ms;
}

export function failed(name: Signal, error: unknown): void {
  const s = get(name);
  s.lastFail = new Date().toISOString();
  s.failures += 1;
  s.error = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 200);
}

export const signal = (name: Signal): SignalState => ({ ...get(name) });

/** Whether the most recent attempt failed. */
export const failing = (s: SignalState) => Boolean(s.lastFail && (!s.lastOk || s.lastFail > s.lastOk));

/** For tests. */
export function resetSignals(): void {
  signals.clear();
}
