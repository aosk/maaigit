import type { CalendarEvent } from './types.js';

/** Extra minutes on top of travel time, so "leave by" leaves room to park and walk in. */
export const LEAVE_BUFFER_MINUTES = 10;

export const eventEnd = (e: Pick<CalendarEvent, 'start' | 'minutes'>): number => new Date(e.start).getTime() + e.minutes * 60_000;

/** When to set off for an event with travel time, or null if it has none. */
export function leaveTime(e: Pick<CalendarEvent, 'start' | 'travelMinutes'>): Date | null {
  return e.travelMinutes ? new Date(new Date(e.start).getTime() - (e.travelMinutes + LEAVE_BUFFER_MINUTES) * 60_000) : null;
}

const sameEventKey = (e: Pick<CalendarEvent, 'title' | 'start' | 'minutes'>) => `${e.title.trim().toLowerCase()}|${e.start}|${e.minutes}`;

/**
 * The same meeting often arrives from two places (Google Calendar and the phone's
 * copy of it, or MAAI's own booking coming back through Google). Keeps the first of
 * each, so list the source to prefer first.
 */
export function dedupeEvents<T extends Pick<CalendarEvent, 'title' | 'start' | 'minutes'>>(events: T[]): { events: T[]; merged: number } {
  const seen = new Set<string>();
  const out = events.filter((e) => {
    const key = sameEventKey(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { events: out, merged: events.length - out.length };
}
