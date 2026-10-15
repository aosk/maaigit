import Anthropic from '@anthropic-ai/sdk';
import type { ChatEvent, UsagePurpose } from '../../shared/types.js';
import { recordUsage } from '../usage.js';
import { noteRateLimits } from '../anthropic-limits.js';

/** The one place MAAI talks to the Claude API. */

export type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
export type Tool = Anthropic.Beta.Messages.BetaTool;
export type ToolUse = Anthropic.Beta.Messages.BetaToolUseBlock;
export type ToolResult = Anthropic.Beta.Messages.BetaToolResultBlockParam;
type Message = Anthropic.Beta.Messages.BetaMessage;
export type OnEvent = (event: ChatEvent) => void;

export const MODEL = 'claude-opus-5-5';

/** Present only when an API key is set; otherwise MAAI runs in demo mode. */
// Every answer from Anthropic carries the key's current rate limits in its headers; keep the latest for the admin portal.
const watching: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  noteRateLimits(response.headers);
  return response;
};
export const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ fetch: watching }) : null;

interface Request {
  /** What the request is for, so the admin portal can split token use by feature. */
  purpose: UsagePurpose;
  system: string;
  messages: MessageParam[];
  tools?: Tool[];
  effort: 'low' | 'medium';
  maxTokens: number;
  /** A JSON schema the reply must follow. */
  format?: Record<string, unknown>;
}

/** Claude's own explanation from an API error, e.g. "Your credit balance is too low…". */
export function apiErrorMessage(error: unknown): string {
  const body = (error as { error?: { error?: { message?: unknown } } }).error;
  const message = body?.error?.message;
  return typeof message === 'string' ? message : error instanceof Error ? error.message : String(error);
}

export const textOf = (content: Anthropic.Beta.Messages.BetaContentBlock[]) =>
  content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

function params(req: Request) {
  return {
    model: MODEL,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages,
    tools: req.tools,
    output_config: { effort: req.effort, ...(req.format ? { format: { type: 'json_schema' as const, schema: req.format } } : {}) },
  };
}

const EXTRAS = {
  // If a safety check declines a request, the API retries it on a suitable model.
  betas: ['server-side-fallback-2026-07-01'],
  fallbacks: 'default' as const,
  cache_control: { type: 'ephemeral' as const },
};

// If an account turns the optional extras down with a 400, MAAI carries on
// without them rather than failing every request.
let useExtras = true;

async function withExtras(purpose: UsagePurpose, send: (extras: Partial<typeof EXTRAS>) => Promise<Message>): Promise<Message> {
  let response: Message;
  try {
    response = await send(useExtras ? EXTRAS : {});
  } catch (error) {
    const message = apiErrorMessage(error);
    if (!(error instanceof Anthropic.BadRequestError) || !useExtras || !/fallback|beta|cache_control/i.test(message)) throw error;
    console.warn(`Claude refused an optional feature (${message}); continuing without it.`);
    useExtras = false;
    response = await send({});
  }
  recordUsage(purpose, response.usage);
  return response;
}

function api() {
  if (!client) throw new Error('No API key');
  return client.beta.messages;
}

/** One request, answered in full. */
export function create(req: Request): Promise<Message> {
  return withExtras(req.purpose, (extras) => api().create({ ...params(req), ...extras }));
}

/** One request, streamed: thinking summaries, tool starts and reply text reach `onEvent` as they happen. */
export function stream(req: Request, onEvent: OnEvent): Promise<Message> {
  return withExtras(req.purpose, async (extras) => {
    const s = api().stream({
      ...params(req),
      ...extras,
      // A readable summary of the reasoning, shown to the user as "what MAAI is thinking".
      thinking: { type: 'adaptive', display: 'summarized' },
    });
    for await (const event of s) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        onEvent({ type: 'step', tool: event.content_block.name });
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'thinking_delta') onEvent({ type: 'thinking', text: event.delta.thinking });
        else if (event.delta.type === 'text_delta') onEvent({ type: 'text', text: event.delta.text });
      }
    }
    return s.finalMessage();
  });
}
