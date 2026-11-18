/**
 * The monitoring page of the user's other site, shown in Settings. MAAI asks that site's own address with the key
 * set on the server (MONITOR_API_KEY), so the key never reaches the phone. What comes back is shown as it is: read
 * only, kept for a few minutes, never saved.
 */

import type { MonitorResult } from '../shared/types.js';

const DEFAULT_URL = 'https://hail-moving-atlas.jb7hqcy4v6.chatgpt.site/api/monitoring';
const CACHE_MS = 5 * 60_000;
const MAX_BYTES = 1_000_000;
const DAYS = [1, 7, 30, 90] as const;


const cache = new Map<number, { at: number; result: MonitorResult }>();
let shapeLogged = false;

const key = () => process.env.MONITOR_API_KEY?.trim() ?? '';
export const monitorConfigured = () => Boolean(key());

/** The field names and kinds of an answer (never the values), so the screen can be fitted to it later. */
export function shapeOf(value: unknown, depth = 0): string {
  if (Array.isArray(value)) return `[${value.length ? shapeOf(value[0], depth + 1) : ''}]x${value.length}`;
  if (value && typeof value === 'object') {
    const names = Object.keys(value).slice(0, 30);
    return depth >= 3 ? '{…}' : `{${names.map((n) => `${n.replace(/[^\w.-]/g, '').slice(0, 30)}:${shapeOf((value as Record<string, unknown>)[n], depth + 1)}`).join(',')}}`;
  }
  return value === null ? 'null' : typeof value;
}

/** The monitoring numbers for the last `days` days. `ask` is fetch, swapped in tests. */
export async function monitoring(days: number, fresh = false, ask: typeof fetch = fetch, now = Date.now()): Promise<MonitorResult> {
  if (!key()) return { ok: false, why: 'no-key' };
  const span = (DAYS as readonly number[]).includes(days) ? days : 30;
  const kept = cache.get(span);
  if (kept && !fresh && now - kept.at < CACHE_MS) return kept.result;
  let result: MonitorResult;
  try {
    const url = new URL(process.env.MONITOR_URL?.trim() || DEFAULT_URL);
    url.searchParams.set('days', String(span));
    const res = await ask(url, { headers: { authorization: `Bearer ${key()}`, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    if (!res.ok) result = { ok: false, why: 'refused', status: res.status };
    else if (body.length > MAX_BYTES) result = { ok: false, why: 'too-big' };
    else {
      try {
        const data: unknown = JSON.parse(body);
        result = { ok: true, data, fetchedAt: new Date(now).toISOString() };
        if (!shapeLogged) {
          shapeLogged = true;
          console.log(`Monitor: shape ${shapeOf(data).slice(0, 1500)}`);
        }
      } catch {
        result = { ok: false, why: 'not-json' };
      }
    }
  } catch (error) {
    console.log(`Monitor: could not reach the site (${(error as Error).name})`);
    result = { ok: false, why: 'unreachable' };
  }
  // A failure is kept only briefly, so a fixed key shows at the next look.
  cache.set(span, { at: result.ok ? now : now - CACHE_MS + 20_000, result });
  return result;
}

/** For the tests. */
export function resetMonitor(): void {
  cache.clear();
  shapeLogged = false;
}
