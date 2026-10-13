import ical, { type VEvent } from 'node-ical';
import type { CalendarEvent, CalendarStatus } from '../shared/types.js';
import { dedupeEvents } from '../shared/schedule.js';

/**
 * Reads calendars through their private iCal addresses: Google Calendar → Settings →
 * your calendar → "Secret address in iCal format", and an iPhone calendar shared as a
 * public link (webcal://). Read-only: MAAI shows these events, plans around them and
 * warns before them, but can't change them. List several, separated by spaces.
 */

/** webcal:// is how phones share a calendar link; it is the same address over https. */
const toHttps = (u: string) => u.replace(/^webcal:\/\//i, 'https://');

const urls = (process.env.GOOGLE_CALENDAR_ICS_URL ?? '')
  .split(/[\s,]+/)
  .map((u) => toHttps(u.trim()))
  .filter((u) => /^https:\/\//.test(u));

export const calendarConfigured = urls.length > 0;

/** A name people recognise for a calendar address, so Settings can say which one is missing. */
function sourceName(url: string): string {
  const host = new URL(url).hostname;
  if (/google/.test(host)) return 'Google Calendar';
  if (/icloud|apple/.test(host)) return 'iPhone (iCloud)';
  if (/outlook|office|live\.com/.test(host)) return 'Outlook';
  return host;
}

const sources = urls.map((url, i) => {
  const name = sourceName(url);
  const same = urls.filter((u) => sourceName(u) === name);
  return { url, name: same.length > 1 ? `${name} ${same.indexOf(url) + 1}` : name, index: i };
});

const REFRESH_MS = 10 * 60_000;
/** After a failure, wait a minute before trying again so a broken link isn't hit on every request. */
const RETRY_MS = 60_000;
const PAST_DAYS = 1;
const FUTURE_DAYS = 30;

const bySource = new Map<string, CalendarEvent[]>();
const problems = new Map<string, string>();
let events: CalendarEvent[] = [];
let merged = 0;
let lastSync: string | undefined;
let nextTryAt = 0;
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

const failure = (status: number) =>
  status === 404 || status === 403
    ? 'The calendar address was not found. Copy the secret address again.'
    : `The calendar answered ${status}.`;

async function readSource(source: (typeof sources)[number]): Promise<void> {
  try {
    const res = await fetch(source.url, { headers: { 'User-Agent': 'MAAI' } });
    if (!res.ok) throw new Error(failure(res.status));
    bySource.set(source.name, eventsFromIcs(await res.text()));
    problems.delete(source.name);
  } catch (error) {
    // Keep what this calendar showed last time; the others still update.
    problems.set(source.name, (error as Error).message);
    console.error(`${source.name} sync failed:`, (error as Error).message);
  }
}

async function sync(): Promise<void> {
  await Promise.all(sources.map(readSource));
  const all = [...bySource.values()].flat().sort((a, b) => a.start.localeCompare(b.start));
  ({ events, merged } = dedupeEvents(all));
  if (problems.size < sources.length) lastSync = new Date().toISOString();
  nextTryAt = Date.now() + (problems.size ? RETRY_MS : REFRESH_MS);
}

/** Fetches again if the copy is older than 10 minutes (or when forced). Never throws. */
export async function refreshCalendar(force = false): Promise<void> {
  if (!calendarConfigured) return;
  if (!force && Date.now() < nextTryAt) return;
  inFlight ??= sync().finally(() => {
    inFlight = null;
  });
  await inFlight;
}

/** The latest copy of the events read from calendars (refreshed in the background). */
export function googleEvents(): CalendarEvent[] {
  void refreshCalendar();
  return events;
}

export function calendarStatus(): CalendarStatus {
  return {
    configured: calendarConfigured,
    events: events.length,
    lastSync,
    error: [...problems.entries()].map(([name, message]) => (sources.length > 1 ? `${name}: ${message}` : message)).join(' ') || undefined,
    sources: sources.map((s) => ({ name: s.name, events: bySource.get(s.name)?.length ?? 0, error: problems.get(s.name) })),
    merged,
  };
}
