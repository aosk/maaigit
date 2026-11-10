import type Anthropic from '@anthropic-ai/sdk';

/** One page Claude tried to open with web_fetch: where, and whether it could be read. */
export interface FetchOutcome {
  host: string;
  ok: boolean;
  /** The API's reason when it could not be read (url_not_accessible, url_not_in_prior_context, …). */
  error?: string;
}

/**
 * What became of each web_fetch in a reply. A failed fetch carries only an error code, not the address: the address
 * is in the request that asked for it, so the two are paired here.
 */
export function fetchOutcomes(content: Anthropic.Beta.Messages.BetaContentBlock[]): FetchOutcome[] {
  const asked = new Map<string, string>();
  for (const b of content) {
    if (b.type === 'server_tool_use' && b.name === 'web_fetch') {
      const url = (b.input as { url?: unknown } | undefined)?.url;
      asked.set(b.id, typeof url === 'string' ? url : '');
    }
  }
  return content
    .filter((b): b is Anthropic.Beta.Messages.BetaWebFetchToolResultBlock => b.type === 'web_fetch_tool_result')
    .map((b) => {
      const url = (b.content.type === 'web_fetch_result' ? b.content.url : '') || asked.get(b.tool_use_id) || '';
      const host = url.replace(/^https?:\/\/(www\.)?/, '').split(/[/?]/)[0] || '?';
      return b.content.type === 'web_fetch_result' ? { host, ok: true } : { host, ok: false, error: b.content.type === 'web_fetch_tool_result_error' ? b.content.error_code : 'no content' };
    });
}

/** "argaam.com ok, saudiexchange.sa url_not_accessible", for a log line. */
export const outcomesLine = (o: FetchOutcome[]) => (o.length ? o.map((x) => `${x.host} ${x.ok ? 'ok' : x.error}`).join(', ') : 'no page opened');
