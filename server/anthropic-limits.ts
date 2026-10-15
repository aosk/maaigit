import type { CloudUsage, RateLimitInfo } from '../shared/types.js';

/** The rate limits Anthropic reports in the headers of each answer, kept as the latest known. */

let latest: CloudUsage['limits'];

const num = (value: string | null): number | undefined => {
  if (value === null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

const when = (value: string | null): string | undefined => {
  if (!value) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

function group(headers: Headers, name: string): RateLimitInfo | undefined {
  const info: RateLimitInfo = {
    limit: num(headers.get(`anthropic-ratelimit-${name}-limit`)),
    remaining: num(headers.get(`anthropic-ratelimit-${name}-remaining`)),
    resetAt: when(headers.get(`anthropic-ratelimit-${name}-reset`)),
  };
  return info.limit === undefined && info.remaining === undefined ? undefined : info;
}

/** Reads the rate-limit headers of one Anthropic answer; answers without them change nothing. */
export function noteRateLimits(headers: Headers, now = new Date()): void {
  const found = { requests: group(headers, 'requests'), tokens: group(headers, 'tokens'), inputTokens: group(headers, 'input-tokens'), outputTokens: group(headers, 'output-tokens') };
  if (Object.values(found).every((v) => v === undefined)) return;
  latest = { updatedAt: now.toISOString(), ...found };
}

export const latestRateLimits = (): CloudUsage['limits'] => latest;

/** For tests. */
export function resetRateLimits() {
  latest = undefined;
}
