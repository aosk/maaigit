import type { CalendarEvent } from './types.js';

/** Extra minutes on top of travel time, so "leave by" leaves room to park and walk in. */
export const LEAVE_BUFFER_MINUTES = 10;

export const eventEnd = (e: Pick<CalendarEvent, 'start' | 'minutes'>): number => new Date(e.start).getTime() + e.minutes * 60_000;

/** When to set off for an event with travel time, or null if it has none. */
export function leaveTime(e: Pick<CalendarEvent, 'start' | 'travelMinutes'>): Date | null {
  return e.travelMinutes ? new Date(new Date(e.start).getTime() - (e.travelMinutes + LEAVE_BUFFER_MINUTES) * 60_000) : null;
}
