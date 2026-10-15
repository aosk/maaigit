import { createHash } from 'node:crypto';
import type { UsagePurpose } from '../../shared/types.js';
import { save, state } from '../store.js';
import { recordCacheHit } from '../usage.js';

/**
 * Claude's answers are kept with a fingerprint of the data they were written from. Ask again with
 * the same data and the saved answer comes back without a call (no tokens, no wait); new data gives
 * a new fingerprint, so the answer is written again. It is saved with the rest of MAAI's data, so a
 * restart or a new deploy does not throw it away.
 */

/** Change this when the shape of a saved answer changes, so old ones are not misread. */
const VERSION = 1;

/** A short, stable fingerprint of any JSON-able data. */
export const fingerprint = (...parts: unknown[]): string => createHash('sha256').update(JSON.stringify([VERSION, ...parts])).digest('hex').slice(0, 32);

interface Options {
  /** Even with the same data, write a new answer after this long (for answers that mention "in 2 hours"). */
  maxAgeMs?: number;
  now?: () => number;
  /** An answer that is not worth saving (an empty one) is returned but not kept. */
  keep?: (value: never) => boolean;
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * The saved answer for `slot` if it was made from the same `data`, otherwise `make()`'s answer,
 * which is then saved. Two requests at once share one call. A failed call saves nothing.
 */
export async function remember<T>(purpose: UsagePurpose, slot: string, data: unknown, make: () => Promise<T>, options: Options = {}): Promise<T> {
  const now = options.now ?? Date.now;
  const print = fingerprint(data);
  const saved = state.aiCache[slot];
  const fresh = saved && saved.fingerprint === print && (!options.maxAgeMs || now() - Date.parse(saved.at) < options.maxAgeMs);
  if (fresh) {
    recordCacheHit(purpose);
    return saved.value as T;
  }

  const pending = inFlight.get(`${slot}:${print}`);
  if (pending) return (await pending) as T;
  const call = make().then((value) => {
    if (options.keep && !(options.keep as (v: T) => boolean)(value)) return value;
    state.aiCache[slot] = { fingerprint: print, at: new Date(now()).toISOString(), value };
    save();
    return value;
  });
  inFlight.set(`${slot}:${print}`, call);
  try {
    return await call;
  } finally {
    inFlight.delete(`${slot}:${print}`);
  }
}
