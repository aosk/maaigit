/**
 * The monitoring answer of the user's own site, read into what the screen shows: its state, its database, and its
 * visitors day by day. Anything that does not look like that answer gives null, and the screen falls back to showing
 * the answer as it is (see monitorView.ts).
 */

export interface SiteView {
  /** The site says it is fine (ok, healthy, up…). */
  up: boolean;
  status: string;
  service: string;
  checkedAt?: string;
  /** Each part the site checks (its database…): fine or not, and how long it took. */
  parts: { name: string; up: boolean; state: string; ms?: number }[];
  visitors?: {
    today?: number;
    yesterday?: number;
    week?: number;
    month?: number;
    total?: number;
    since?: string;
    definition?: string;
    /** Oldest first. */
    daily: { date: string; count: number }[];
  };
}

const GOOD = /^(ok|okay|healthy|up|operational|pass(ed)?|green|online|connected|running|available)$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);

/** A day's row: its date (the field called date or day, else the first text) and its count (visitors, unique, count…, else the first number). */
function dayOf(row: unknown): { date: string; count: number } | null {
  if (!isRecord(row)) return null;
  const entries = Object.entries(row);
  const date = str(row.date) ?? str(row.day) ?? entries.map(([, v]) => str(v)).find((v) => v && /^\d{4}-\d{2}-\d{2}/.test(v));
  const named = entries.find(([k, v]) => /visitor|unique|count|value|total|views/i.test(k) && num(v) !== undefined);
  const count = num(named?.[1]) ?? entries.map(([, v]) => num(v)).find((v) => v !== undefined);
  return date && count !== undefined ? { date: date.slice(0, 10), count } : null;
}

export function readSite(data: unknown): SiteView | null {
  if (!isRecord(data)) return null;
  const status = str(data.status);
  const visitors = isRecord(data.visitors) ? data.visitors : undefined;
  const health = isRecord(data.health) ? data.health : undefined;
  if (!status && !visitors && !health) return null;

  // Each checked part: "database": "ok" with "database_latency_ms": 12 beside it.
  const parts: SiteView['parts'] = [];
  for (const [k, v] of Object.entries(health ?? {})) {
    const state = str(v);
    if (!state) continue;
    const ms = Object.entries(health!).find(([m, n]) => m !== k && m.startsWith(k) && /ms$/i.test(m) && num(n) !== undefined)?.[1];
    parts.push({ name: k, up: GOOD.test(state), state, ms: num(ms) });
  }

  let view: SiteView['visitors'];
  if (visitors) {
    const daily = (Array.isArray(visitors.daily) ? visitors.daily : []).map(dayOf).filter((d): d is { date: string; count: number } => d !== null).sort((a, b) => a.date.localeCompare(b.date));
    view = {
      today: num(visitors.today),
      yesterday: num(visitors.yesterday),
      week: num(visitors.last_7_days),
      month: num(visitors.last_30_days),
      total: num(visitors.total_daily_unique) ?? num(visitors.total),
      since: str(visitors.counting_started_on),
      definition: str(visitors.definition),
      daily,
    };
  }
  return {
    up: status ? GOOD.test(status) : parts.every((p) => p.up),
    status: status ?? '',
    service: str(data.service) ?? '',
    checkedAt: str(data.checked_at),
    parts,
    visitors: view,
  };
}
