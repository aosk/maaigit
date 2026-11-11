import type Anthropic from '@anthropic-ai/sdk';
import { create } from '../ai/claude.js';

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

/** How a search agent's call went, for its log line: how many searches it ran and why it stopped. */
export const searchLine = (response: { content: Anthropic.Beta.Messages.BetaContentBlock[]; stop_reason?: string | null }) =>
  `${response.content.filter((b) => b.type === 'server_tool_use' && b.name === 'web_search').length} search(es), stopped: ${response.stop_reason ?? 'unknown'}`;

/** "argaam.com ok, saudiexchange.sa url_not_accessible", for a log line. */
export const outcomesLine = (o: FetchOutcome[]) => (o.length ? o.map((x) => `${x.host} ${x.ok ? 'ok' : x.error}`).join(', ') : 'no page opened');

/** Said to every agent that reads today's events or figures: its own memory has none of them. */
export const SEARCH_RULE = "Today's events and figures are not in your memory. You MUST use your tools (search, and open the pages named above) before you answer: an answer written from memory is wrong. An empty list is a valid answer only after you have searched.";

/** Whether a reply used any search or page tool. */
export const usedTools = (content: Anthropic.Beta.Messages.BetaContentBlock[]) =>
  content.some((b) => b.type === 'server_tool_use' || b.type === 'web_search_tool_result' || b.type === 'web_fetch_tool_result');

/**
 * Like create(), but an agent that answers without using its tools at all (and so reports "nothing found" from memory)
 * is sent back once to do the work. Two calls are the most it ever costs.
 */
export async function createSearching(req: Parameters<typeof create>[0]): Promise<Awaited<ReturnType<typeof create>>> {
  const first = await create(req);
  if (!req.tools?.length || usedTools(first.content)) return first;
  console.warn(`StockSmart ${req.purpose}: answered without searching; asking once more.`);
  return create({
    ...req,
    messages: [
      ...req.messages,
      { role: 'assistant', content: first.content },
      { role: 'user', content: 'You answered without using your search or page tools, and nothing you remember counts. Run the searches and open the pages now, then give the answer again in the same format.' },
    ],
  });
}
