import ical, { type VEvent } from 'node-ical';
import type { CalendarEvent, CalendarStatus } from '../shared/types.js';
import { dedupeEvents } from '../shared/schedule.js';
import { calendarId as liveCalendarId, googleCalendarConfigured } from './gauth.js';

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

/** Something to read: calendar addresses, or the live Google connection. */
export const calendarConfigured = urls.length > 0 || googleCalendarConfigured;

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

/** Notes sometimes carry a little HTML; this keeps the words and the line breaks. */
export function plainNotes(text: string): string {
  return text
    .replace(/<\s*br\s*\/?>|<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);
}

const MEETING_HOSTS = /(meet\.google\.com|zoom\.us|zoom\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|bluejeans\.com|chime\.aws|gotomeeting\.com|meet\.jit\.si)/i;
const LINK = /https?:\/\/[^\s<>"')\]]+/g;

/** The link to join a meeting: Google's own conference link first, then one found in the location or notes. */
export function meetingLink(...sources: string[]): string | undefined {
  for (const source of sources) {
    for (const link of source.match(LINK) ?? []) {
      try {
        if (MEETING_HOSTS.test(new URL(link).hostname)) return link;
      } catch {
        // not a usable address; try the next one
      }
    }
  }
  return undefined;
}

function toEvent(uid: string, title: string, start: Date, end: Date, extra: { location: string; notes: string; conference: string; calendar: string }, allDay: boolean): CalendarEvent {
  const description = plainNotes(extra.notes);
  return {
    id: `g:${uid}:${start.toISOString()}`,
    title: title || '(No title)',
    start: start.toISOString(),
    minutes: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)),
    place: extra.location || undefined,
    description: description || undefined,
    meetingUrl: meetingLink(extra.conference, extra.location, description),
    calendar: extra.calendar,
    source: 'google',
    allDay: allDay || undefined,
  };
}

/** Events from one calendar file in the window, with repeating events expanded. */
export function eventsFromIcs(text: string, now = new Date(), calendar = 'Google Calendar'): CalendarEvent[] {
  const from = new Date(now.getTime() - PAST_DAYS * 86_400_000);
  const to = new Date(now.getTime() + FUTURE_DAYS * 86_400_000);
  const out: CalendarEvent[] = [];
  for (const item of Object.values(ical.sync.parseICS(text))) {
    if (!item || item.type !== 'VEVENT') continue;
    const ev = item as VEvent;
    if (plain(ev.status).toUpperCase() === 'CANCELLED') continue;
    const allDay = (ev as { datetype?: string }).datetype === 'date';
    const extra = { location: plain(ev.location), notes: plain(ev.description), conference: plain((ev as unknown as Record<string, unknown>)['GOOGLE-CONFERENCE']) || plain(ev.url), calendar };
    if (ev.rrule) {
      for (const inst of ical.expandRecurringEvent(ev, { from, to })) {
        out.push(toEvent(ev.uid, plain(inst.summary), new Date(inst.start), new Date(inst.end), extra, inst.isFullDay));
      }
    } else if (ev.start) {
      const start = new Date(ev.start);
      const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
      if (end >= from && start <= to) out.push(toEvent(ev.uid, plain(ev.summary), start, end, extra, allDay));
    }
  }
  return out;
}

const failure = (status: number) =>
  status === 404 || status === 403
    ? 'The calendar address was not found. Copy the secret address again.'
    : `The calendar answered ${status}.`;

// ---------- The live reading of your own Google calendar (livecal.ts) ----------

/** The live source's name in Settings. */
const LIVE_NAME = 'Google Calendar (live)';
/** The live reading counts as working if it last succeeded within this long. */
const LIVE_FRESH_MS = 5 * 60_000;
let liveOkAt = 0;

const liveWorking = () => Date.now() - liveOkAt < LIVE_FRESH_MS;

/** The Google calendar an address is for ("…/calendar/ical/<id>/private-…/basic.ics"), or undefined. */
function icalCalendarId(url: string): string | undefined {
  const match = new URL(url).pathname.match(/\/calendar\/ical\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]).toLowerCase() : undefined;
}

/**
 * While the live reading works, the address of the same calendar is left alone: Google can be
 * slow to update it, so it would bring back events that were just deleted.
 */
const replacedByLive = (source: (typeof sources)[number]) => liveWorking() && Boolean(liveCalendarId) && icalCalendarId(source.url) === liveCalendarId?.toLowerCase();

function rebuild() {
  const all = [...bySource.values()].flat().sort((a, b) => a.start.localeCompare(b.start));
  ({ events, merged } = dedupeEvents(all));
}

/** The live reading worked: these are the calendar's events now. */
export function setLiveEvents(list: CalendarEvent[]) {
  bySource.set(LIVE_NAME, list);
  problems.delete(LIVE_NAME);
  liveOkAt = Date.now();
  lastSync = new Date().toISOString();
  for (const source of sources) if (replacedByLive(source)) bySource.delete(source.name);
  rebuild();
}

/** The live reading failed: forget its events so the calendar's address takes over again. */
export function setLiveProblem(message: string) {
  if (!problems.has(LIVE_NAME)) console.error(`${LIVE_NAME} failed:`, message);
  bySource.delete(LIVE_NAME);
  problems.set(LIVE_NAME, message);
  liveOkAt = 0;
  nextTryAt = 0; // read the addresses again right away
  rebuild();
}

async function readSource(source: (typeof sources)[number]): Promise<void> {
  if (replacedByLive(source)) return;
  try {
    const res = await fetch(source.url, { headers: { 'User-Agent': 'MAAI' } });
    if (!res.ok) throw new Error(failure(res.status));
    bySource.set(source.name, eventsFromIcs(await res.text(), new Date(), source.name));
    problems.delete(source.name);
  } catch (error) {
    // Keep what this calendar showed last time; the others still update.
    problems.set(source.name, (error as Error).message);
    console.error(`${source.name} sync failed:`, (error as Error).message);
  }
}

async function sync(): Promise<void> {
  await Promise.all(sources.map(readSource));
  rebuild();
  const failed = sources.filter((s) => problems.has(s.name)).length;
  if (sources.length === 0 || failed < sources.length) lastSync = new Date().toISOString();
  nextTryAt = Date.now() + (failed ? RETRY_MS : REFRESH_MS);
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
  const shown = sources.filter((s) => !replacedByLive(s)).map((s) => s.name);
  if (bySource.has(LIVE_NAME) || problems.has(LIVE_NAME)) shown.unshift(LIVE_NAME);
  const issues = shown.filter((name) => problems.has(name));
  return {
    configured: calendarConfigured,
    events: events.length,
    lastSync,
    error: issues.map((name) => (shown.length > 1 ? `${name}: ${problems.get(name)}` : problems.get(name))).join(' ') || undefined,
    sources: shown.map((name) => ({ name, events: bySource.get(name)?.length ?? 0, error: problems.get(name) })),
    merged,
  };
}
