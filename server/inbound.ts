import type { InboxMessage } from '../shared/types.js';

/**
 * Who handles a new private WhatsApp message before MAAI's general first reply to strangers does. A module (the
 * team follow-ups, the courier replies) registers a handler; the first one that claims the message ends the search,
 * and the general reply is skipped for it. A handler that claims a message and later finds it is not its own
 * (a message that turned out not to be from a courier) calls `fallback()` to give it to the general reply after all.
 */
export type InboundHandler = (message: InboxMessage, fallback: () => void, now: number) => boolean;

const handlers: InboundHandler[] = [];

export function onInbound(handler: InboundHandler): void {
  handlers.push(handler);
}

/** Whether a registered handler took this message. */
export function claimInbound(message: InboxMessage, fallback: () => void, now: number): boolean {
  return handlers.some((h) => h(message, fallback, now));
}

/** For the tests: forget the handlers. */
export function clearInbound(): void {
  handlers.length = 0;
}
