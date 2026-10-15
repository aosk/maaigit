import type { CalendarEvent } from '../shared/types.js';
import { config } from './config.js';
import { eventsCall, failure, googleCalendarConfigured } from './gauth.js';
import { meetingLink, plainNotes, setLiveEvents, setLiveProblem } from './gcal.js';
import { audit, save, state } from './store.js';

/**
 * Reads your own Google calendar live, through the service account (gauth.ts), about
 * once a minute. Unlike the calendar's secret address (which Google can be slow to update),
 * this sees an event added, moved or deleted on your iPhone (when it uses your Google
 * account) within a minute. It also keeps the meetings MAAI wrote to Google in step: if you
 * delete or move one there, MAAI's copy follows.
 */

/** An event as Google's API returns it (only the fields asked for below). */
export interface ApiEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/** The parts of an event MAAI uses (asking for less keeps each reply small). */
const ITEM_FIELDS = 'id,status,summary,description,location,start,end,hangoutLink,conferenceData(entryPoints(entryPointType,uri)),attendees(self,responseStatus)';
const PAST_DAYS = 1;
const FUTURE_DAYS = 31;
const MAX_PAGES = 10;

/** Midnight (the app's time zone) of an all-day event's date. */
const dayStart = (date: string) => new Date(`${date}T00:00:00`);

/** One Google event as a MAAI event, or null for those not to show (cancelled, or ones you declined). */
export function eventFromApi(item: ApiEvent): CalendarEvent | null {
  if (item.status === 'cancelled' || !item.start) return null;
  if (item.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null;
  const allDay = Boolean(item.start.date && !item.start.dateTime);
  const start = allDay ? dayStart(item.start.date!) : new Date(item.start.dateTime!);
  const endRaw = item.end?.dateTime ?? item.end?.date;
  const end = endRaw ? (allDay ? dayStart(item.end!.date!) : new Date(endRaw)) : new Date(start.getTime() + (allDay ? 86_400_000 : 3_600_000));
  if (Number.isNaN(start.getTime())) return null;
  const conference = item.hangoutLink ?? item.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? '';
  const description = plainNotes(item.description ?? '');
  return {
    id: `g:${item.id}`,
    title: item.summary || '(No title)',
    start: start.toISOString(),
    minutes: Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)),
    place: item.location || undefined,
    description: description || undefined,
    meetingUrl: meetingLink(conference, item.location ?? '', description),
    calendar: 'Google Calendar',
    source: 'google',
    allDay: allDay || undefined,
  };
}

type Patch = Partial<Pick<CalendarEvent, 'title' | 'start' | 'minutes'>>;

/** What changed for the meetings MAAI wrote to Google, and which ones Google's list no longer shows. */
export function compare(own: CalendarEvent[], items: ApiEvent[], window?: { timeMin: string; timeMax: string }): { patches: { event: CalendarEvent; patch: Patch }[]; missing: CalendarEvent[] } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const patches: { event: CalendarEvent; patch: Patch }[] = [];
  const missing: CalendarEvent[] = [];
  for (const event of own) {
    if (!event.googleId || event.demo) continue;
    const item = byId.get(event.googleId);
    // Outside the list's dates it is not shown there whatever happened to it: no reason to ask Google about it every minute.
    if (!item && window && (Date.parse(event.start) + event.minutes * 60_000 < Date.parse(window.timeMin) || Date.parse(event.start) > Date.parse(window.timeMax))) continue;
    if (!item) {
      missing.push(event);
      continue;
    }
    const patch = changes(event, item);
    if (patch) patches.push({ event, patch });
  }
  return { patches, missing };
}

/** How Google's copy differs from MAAI's (title, time or length), or null when they agree. */
function changes(event: CalendarEvent, item: ApiEvent): Patch | null {
  const google = eventFromApi(item);
  if (!google) return null;
  const patch: Patch = {};
  if (google.title !== event.title) patch.title = google.title;
  if (google.start !== event.start) patch.start = google.start;
  if (google.minutes !== event.minutes) patch.minutes = google.minutes;
  return Object.keys(patch).length ? patch : null;
}

/** The dates the calendar is read for: a few days back, a month ahead. */
function windowOf(now = new Date()): { timeMin: string; timeMax: string } {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return { timeMin: new Date(day.getTime() - PAST_DAYS * 86_400_000).toISOString(), timeMax: new Date(day.getTime() + FUTURE_DAYS * 86_400_000).toISOString() };
}

async function fetchWindow(now = new Date()): Promise<ApiEvent[]> {
  const { timeMin, timeMax } = windowOf(now);
  const items: ApiEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await eventsCall('GET', '', { query: { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', showDeleted: 'false', fields: `nextPageToken,items(${ITEM_FIELDS})`, ...(pageToken ? { pageToken } : {}) } });
    if (!res.ok) throw await failure(res);
    const body = (await res.json()) as { items?: ApiEvent[]; nextPageToken?: string };
    items.push(...(body.items ?? []));
    pageToken = body.nextPageToken;
    if (!pageToken) break;
  }
  return items;
}

/**
 * A meeting missing from the list was deleted in Google, or just moved out of the window:
 * ask Google about it directly, so a moved one is never mistaken for a deleted one.
 */
async function settleMissing(missing: CalendarEvent[]): Promise<{ removed: CalendarEvent[]; patches: { event: CalendarEvent; patch: Patch }[] }> {
  const removed: CalendarEvent[] = [];
  const patches: { event: CalendarEvent; patch: Patch }[] = [];
  for (const event of missing) {
    const res = await eventsCall('GET', `/${event.googleId}`, { query: { fields: ITEM_FIELDS } });
    if (res.status === 404 || res.status === 410) {
      removed.push(event);
      continue;
    }
    if (!res.ok) throw await failure(res);
    const item = (await res.json()) as ApiEvent;
    if (item.status === 'cancelled') removed.push(event);
    else {
      const patch = changes(event, item);
      if (patch) patches.push({ event, patch });
    }
  }
  return { removed, patches };
}

function apply(patches: { event: CalendarEvent; patch: Patch }[], removed: CalendarEvent[]) {
  for (const { event, patch } of patches) {
    Object.assign(event, patch);
    audit(`Updated "${event.title}" (changed in Google Calendar)`, 'Google Calendar', 'done');
  }
  for (const event of removed) audit(`Removed "${event.title}" (deleted in Google Calendar)`, 'Google Calendar', 'done');
  if (removed.length) state.events = state.events.filter((e) => !removed.includes(e));
  if (patches.length || removed.length) save();
}

let running: Promise<void> | null = null;

/** Reads the calendar now and brings MAAI's copies in step. Never throws. */
export function refreshLiveCalendar(): Promise<void> {
  if (!googleCalendarConfigured) return Promise.resolve();
  running ??= (async () => {
    try {
      const items = await fetchWindow();
      const { patches, missing } = compare(state.events, items, windowOf());
      const settled = await settleMissing(missing);
      apply([...patches, ...settled.patches], settled.removed);
      // MAAI's own copy of a meeting it wrote to Google is the one shown; the rest come from Google.
      const mine = new Set(state.events.map((e) => e.googleId).filter(Boolean));
      setLiveEvents(items.filter((i) => !mine.has(i.id)).map(eventFromApi).filter((e): e is CalendarEvent => e !== null));
    } catch (error) {
      setLiveProblem((error as Error).message);
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Reads the calendar live shortly after start-up, then every MAAI_LIVE_SECONDS (default 60). */
export function startLiveCalendar() {
  if (!googleCalendarConfigured) return;
  setTimeout(() => void refreshLiveCalendar(), 1_500);
  setInterval(() => void refreshLiveCalendar(), config.liveSeconds * 1000);
}
