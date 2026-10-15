import type { UsagePurpose, UsageRow } from '../shared/types.js';
import { config } from './config.js';
import { save, state } from './store.js';

/** Counts Claude tokens per day and feature, for the admin portal. */

const KEEP_DAYS = 90;

interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** YYYY-MM-DD in the app's time zone. */
export function dayKey(date: Date, timeZone = config.timezone): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** A token count that is always a whole number, never negative or NaN, whatever the API sent. */
const count = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

export function recordUsage(purpose: UsagePurpose, usage: ApiUsage, now = new Date()): void {
  const cached = count(usage.cache_read_input_tokens);
  const input = count(usage.input_tokens) + count(usage.cache_creation_input_tokens);
  const output = count(usage.output_tokens);

  state.usage.inputTokens += input + cached;
  state.usage.outputTokens += output;
  state.usage.requests += 1;

  const day = dayKey(now);
  let row = state.usageLog.find((r) => r.day === day && r.purpose === purpose);
  if (!row) {
    row = { day, purpose, input: 0, cached: 0, output: 0, requests: 0 };
    state.usageLog.push(row);
  }
  row.input += input;
  row.cached += cached;
  row.output += output;
  row.requests += 1;

  const oldest = dayKey(new Date(now.getTime() - KEEP_DAYS * 86_400_000));
  state.usageLog = state.usageLog.filter((r) => r.day >= oldest);
  save();
}

/** The last `days` days of use (today included), oldest first. */
export function recentUsage(days: number, now = new Date()): UsageRow[] {
  const oldest = dayKey(new Date(now.getTime() - (days - 1) * 86_400_000));
  return state.usageLog.filter((r) => r.day >= oldest).sort((a, b) => a.day.localeCompare(b.day));
}
