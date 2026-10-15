import type { CloudUsage } from '../shared/types.js';
import { latestRateLimits } from './anthropic-limits.js';

/**
 * What Anthropic itself reports for the key MAAI uses: its rate limits (from every answer) and, when an
 * Admin API credential is available, its tokens and the organization's cost for the last 30 days. The
 * remaining prepaid credit is not available through any API; it is only in the Claude Console.
 */

const DAY = 86_400_000;
const CACHE_MS = 5 * 60_000;
const VERSION = '2023-06-01';

const apiKey = () => process.env.ANTHROPIC_API_KEY?.trim() ?? '';
const base = () => (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '');
/** Admin credentials are tried first; the normal key is tried too, as a key not tied to a workspace may be allowed. */
const credential = () => process.env.ANTHROPIC_ADMIN_KEY?.trim() || apiKey();

/** How the current key ends, never more: "sk-ant-…WXYZ". */
export const keyHint = (key: string) => (key ? `sk-ant-…${key.slice(-4)}` : '');

class ReportError extends Error {
  constructor(
    message: string,
    readonly needsAdminKey = false,
  ) {
    super(message);
  }
}

async function get<T>(path: string, params: [string, string][]): Promise<T> {
  const url = new URL(`${base()}${path}`);
  for (const [k, v] of params) url.searchParams.append(k, v);
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'x-api-key': credential(), 'anthropic-version': VERSION, 'User-Agent': 'MAAI/1.0' }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ReportError('Could not reach Anthropic.');
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    const why = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message;
    throw new ReportError(why ?? `Anthropic answered ${res.status}`, true);
  }
  if (!res.ok) throw new ReportError(`Anthropic answered ${res.status}.`);
  return (await res.json()) as T;
}

interface Page<T> {
  data: T[];
  has_more?: boolean;
  next_page?: string | null;
}

async function pages<T>(path: string, params: [string, string][], max = 4): Promise<T[]> {
  const out: T[] = [];
  let page = '';
  for (let i = 0; i < max; i++) {
    const body = await get<Page<T>>(path, page ? [...params, ['page', page]] : params);
    out.push(...body.data);
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return out;
}

interface ApiKeyRow {
  id: string;
  name: string;
  partial_key_hint: string | null;
  status: string;
  scope?: { type: string };
}

/** The key's entry in the organization, found by comparing how it starts and ends with Anthropic's partial hint. */
export function matchKey(keys: ApiKeyRow[], key: string): ApiKeyRow | undefined {
  return keys.find((k) => {
    const [start, end] = (k.partial_key_hint ?? '').split('...');
    return Boolean(start && end) && key.startsWith(start) && key.endsWith(end);
  });
}

interface UsageBucket {
  starting_at: string;
  results: { uncached_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number; cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number } }[];
}
interface CostBucket {
  starting_at: string;
  results: { amount?: string; currency?: string }[];
}

const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const dayOf = (iso: string) => iso.slice(0, 10);

let cached: { at: number; value: CloudUsage } | null = null;

export async function cloudUsage({ force = false, now = new Date() }: { force?: boolean; now?: Date } = {}): Promise<CloudUsage> {
  if (!force && cached && now.getTime() - cached.at < CACHE_MS) return { ...cached.value, limits: latestRateLimits() };

  const key = apiKey();
  const result: CloudUsage = { fetchedAt: now.toISOString(), key: { hint: keyHint(key), matched: false }, limits: latestRateLimits(), reports: 'error', days: [], scope: 'organization' };
  if (!key) return { ...result, message: 'No Claude API key is set, so MAAI is in demo mode.' };

  try {
    const start = new Date(Math.floor(now.getTime() / DAY) * DAY - 29 * DAY).toISOString();
    const end = new Date(Math.floor(now.getTime() / DAY) * DAY + DAY).toISOString();

    // Which key in the organization is the one MAAI uses?
    const keys = await pages<ApiKeyRow>('/v1/organizations/api_keys', [['limit', '1000']], 2).catch(() => [] as ApiKeyRow[]);
    const mine = matchKey(keys, key);
    if (mine) result.key = { hint: keyHint(key), matched: true, name: mine.name, id: mine.id, status: mine.status, scope: mine.scope?.type };

    const filter: [string, string][] = mine ? [['api_key_ids[]', mine.id]] : [];
    const usage = await pages<UsageBucket>('/v1/organizations/usage_report/messages', [['starting_at', start], ['ending_at', end], ['bucket_width', '1d'], ['limit', '31'], ...filter]);
    result.scope = mine ? 'key' : 'organization';
    result.days = usage.map((bucket) => ({
      day: dayOf(bucket.starting_at),
      uncachedInput: bucket.results.reduce((a, r) => a + n(r.uncached_input_tokens), 0),
      cacheRead: bucket.results.reduce((a, r) => a + n(r.cache_read_input_tokens), 0),
      cacheWrite: bucket.results.reduce((a, r) => a + n(r.cache_creation?.ephemeral_1h_input_tokens) + n(r.cache_creation?.ephemeral_5m_input_tokens), 0),
      output: bucket.results.reduce((a, r) => a + n(r.output_tokens), 0),
    }));
    result.reports = 'ok';

    // Cost is only reported for the whole organization, as cents in a decimal string.
    try {
      const costs = await pages<CostBucket>('/v1/organizations/cost_report', [['starting_at', start], ['ending_at', end], ['limit', '31']]);
      const days = costs.map((bucket) => ({ day: dayOf(bucket.starting_at), usd: Math.round(bucket.results.filter((r) => (r.currency ?? 'USD') === 'USD').reduce((a, r) => a + (Number(r.amount) || 0), 0)) / 100 }));
      const today = dayOf(now.toISOString());
      result.cost = { days, last30: Math.round(days.reduce((a, d) => a + d.usd, 0) * 100) / 100, today: days.find((d) => d.day === today)?.usd ?? 0 };
    } catch {
      // usage is still shown; cost just is not
    }
    if (!mine) result.message = 'MAAI could not tell which key in your organization it uses, so these are the whole organization\'s numbers.';
  } catch (error) {
    const e = error as ReportError;
    result.reports = e.needsAdminKey ? 'needs-admin-key' : 'error';
    result.message = e.needsAdminKey
      ? `Anthropic only shares usage and cost with an Admin API key (organization accounts only). Add one as ANTHROPIC_ADMIN_KEY on Render. Anthropic said: ${e.message}`
      : e.message;
  }

  cached = { at: now.getTime(), value: result };
  return result;
}

/** For tests. */
export function forgetCloudUsage() {
  cached = null;
}
