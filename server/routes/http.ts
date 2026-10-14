import type { NextFunction, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { Lang } from '../../shared/types.js';
import { apiErrorMessage } from '../ai/claude.js';
import { MailError } from '../mail.js';
import { AsanaError } from '../asana.js';

/** Small helpers shared by every route file. */

/** An error the user should see as-is, with the HTTP status to send. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (req: Request, res: Response) => unknown;
/** Express 4 does not catch rejected promises, so async routes go through this. */
export const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve()
    .then(() => fn(req, res))
    .catch(next);

export const lang = (value: unknown): Lang => (value === 'ar' ? 'ar' : 'en');
export const text = (value: unknown, max = 4000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** The item with this id, or a 404. */
export function find<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((x) => x.id === id);
  if (!item) throw new HttpError(404, 'Not found');
  return item;
}

/** An error in words the app can show, with the HTTP status to use. */
export function explain(error: unknown): { status: number; error: string } {
  if (error instanceof HttpError) return { status: error.status, error: error.message };
  if (error instanceof MailError || error instanceof AsanaError) return { status: 400, error: error.message };
  if (error instanceof Anthropic.AuthenticationError) {
    return { status: 502, error: 'The Claude API key is not valid. Check it at console.anthropic.com.' };
  }
  if (error instanceof Anthropic.RateLimitError) return { status: 503, error: 'Claude is busy right now. Try again in a moment.' };
  if (error instanceof Anthropic.APIError) {
    const message = apiErrorMessage(error);
    console.error('Claude API error', error.status, message);
    if (/credit balance/i.test(message)) {
      return { status: 502, error: 'Your Claude account has no credit left. Add credit at console.anthropic.com → Billing, then try again.' };
    }
    return { status: 502, error: `Claude could not answer (${error.status ?? 'network'}): ${message}` };
  }
  // Express itself rejects some requests (an address that is not valid text, say) with a 4xx status.
  const refused = (error as { status?: unknown }).status;
  if (typeof refused === 'number' && refused >= 400 && refused < 500) return { status: refused, error: 'The request could not be read.' };
  // Anything else is unexpected: its details (file paths, internals) stay in the server log.
  console.error(error);
  return { status: 500, error: 'Something went wrong. Try again.' };
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const { status, error: message } = explain(error);
  res.status(status).json({ error: message });
}
