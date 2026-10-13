import ical, { type VEvent } from 'node-ical';
import type { CalendarEvent, CalendarStatus } from '../shared/types.js';

/**
 * Reads the user's Google Calendar through its private iCal address (Google
 * Calendar → Settings → your calendar → "Secret address in iCal format").
 * Read-only: MAAI shows these events, plans around them and warns before them,
 * but can't change them. Several calendars can be listed, separated by spaces.
 */

const urls = (process.env.GOOGLE_CALENDAR_ICS_URL ?? '')
  .split(/[\s,]+/)
  .map((u) => u.trim())
  .filter((u) => /^https:\/\//.test(u));

export const calendarConfigured = urls.length > 0;

const REFRESH_MS = 10 * 60_000;
const PAST_DAYS = 1;
const FUTURE_DAYS = 30;

let events: CalendarEvent[] = [];
let lastSync: string | undefined;
let lastError: string | undefined;
let inFlight: Promise<void> | null = null;

/** iCal text fields can come with parameters attached; this gets the plain text. */
const plain = (value: unknown): string =>
  typeof value === 'string' ? value : value && typeof value === 'object' && 'val' in value ? String((value as { val: unknown }).val) : '';

function toEvent(uid: string, title: string, start: Date, end: Date, location: string, allDay: boolean): CalendarEvent {
  return {
    id: `g:${uid}:${start.toISOString()}`,
    title: title || '(No title)',
    start: start.toISOString(),
    minutes: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)),
    place: location || undefined,
    source: 'google',
    allDay: allDay || undefined,
  };
}

/** Events from one calendar file in the window, with repeating events expanded. */
export function eventsFromIcs(text: string, now = new Date()): CalendarEvent[] {
  const from = new Date(now.getTime() - PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + FUTURE_DAYS * 86_400_000);
  const out: CalendarEvent[] = [];
  for (const item of Object.values(ical.sync.parseICS(text))) {
    if (!item || item.type !== 'VEVENT') continue;
    const ev = item as VEvent;
    if (plain(ev.status).toUpperCase() === 'CANCELLED') continue;
    const allDay = (ev as { datetype?: string }).datetype === 'date';
    if (ev.rrule) {
      for (const inst of ical.expandRecurringEvent(ev, { from, to })) {
        out.push(toEvent(ev.uid, plain(inst.summary), new Date(inst.start), new Date(inst.end), plain(ev.location), inst.isFullDay));
      }
    } else if (ev.start) {
      const start = new Date(ev.start);
      const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
      if (end >= from && start <= to) out.push(toEvent(ev.uid, plain(ev.summary), start, end, plain(ev.location), allDay));
    }
  }
  return out;
}

async function sync(): Promise<void> {
  const all: CalendarEvent[] = [];
  for (const url of urls) {
    const res = await fetch(url, { headers: { 'User-Agent': 'MAAI' } });
    if (!res.ok) throw new Error(res.status === 404 ? 'Google says the calendar address was not found. Copy the secret address again.' : `Google Calendar answered ${res.status}.`);
    all.push(...eventsFromIcs(await res.text()));
  }
  events = all.sort((a, b) => a.start.localeCompare(b.start));
  lastSync = new Date().toISOString();
  lastError = undefined;
}

/** Fetches again if the copy is older than 10 minutes (or when forced). Never throws. */
export async function refreshCalendar(force = false): Promise<void> {
  if (!calendarConfigured) return;
  if (!force && lastSync && Date.now() - Date.parse(lastSync) < REFRESH_MS) return;
  inFlight ??= sync()
    .catch((error: Error) => {
      lastError = error.message;
      console.error('Google Calendar sync failed:', error.message);
    })
    .finally(() => {
      inFlight = null;
    });
  await inFlight;
}

/** The latest copy of Google Calendar events (refreshed in the background). */
export function googleEvents(): CalendarEvent[] {
  void refreshCalendar();
  return events;
}

export function calendarStatus(): CalendarStatus {
  return { configured: calendarConfigured, events: events.length, lastSync, error: lastError };
}
