import type { CalendarEvent, CalendarWriteStatus } from '../shared/types.js';
import { config } from './config.js';
import { calendarId, eventsCall, failure, googleCalendarConfigured, googleCalendarMentioned, serviceKey, setupProblem } from './gauth.js';
import { audit, save, state } from './store.js';

/**
 * Puts the meetings you approve in MAAI into your Google Calendar, through the service
 * account in gauth.ts. Only events created in MAAI go out; the ones read from Google
 * never come back (livecal.ts keeps the two in step).
 */

export const googleWriteConfigured = googleCalendarConfigured;

let lastError: string | undefined = setupProblem;

export function googleWriteStatus(): CalendarWriteStatus {
  return { configured: googleCalendarMentioned, working: googleWriteConfigured && !lastError, calendar: calendarId, shareWith: serviceKey?.client_email, error: lastError };
}

/** The id MAAI gives Google, so sending the same event twice never makes two. Google allows 0-9 and a-v. */
const googleId = (e: CalendarEvent) => `maai${e.id.toLowerCase().replace(/[^0-9a-v]/g, '')}0000`;

/** Adds one event to Google Calendar. */
async function insert(e: CalendarEvent): Promise<string> {
  const id = googleId(e);
  const end = new Date(Date.parse(e.start) + e.minutes * 60_000).toISOString();
  const res = await eventsCall('POST', '', { body: {
    id,
    summary: e.title,
    // MAAI sometimes keeps the invitee's email in "place"; that is not a location.
    ...(e.place && !e.place.includes('@') ? { location: e.place } : {}),
    description: e.bookedByMaai ? 'Booked by MAAI' : 'Added in MAAI',
    start: { dateTime: e.start, timeZone: config.timezone },
    end: { dateTime: end, timeZone: config.timezone },
    extendedProperties: { private: { maaiId: e.id } },
  } });
  // 409 = it is already there (an earlier answer was lost): that is a success.
  if (!res.ok && res.status !== 409) throw await failure(res);
  return id;
}

/** Sends an event to Google and remembers the result on it. Never throws; returns what happened. */
export async function mirrorToGoogle(e: CalendarEvent): Promise<{ status: 'added' } | { status: 'failed'; error: string } | null> {
  if (!googleWriteConfigured) return null;
  try {
    e.googleId = await insert(e);
    delete e.googleError;
    lastError = undefined;
    save();
    return { status: 'added' };
  } catch (error) {
    e.googleError = (error as Error).message;
    lastError = e.googleError;
    save();
    console.error('Google Calendar write failed:', e.googleError);
    return { status: 'failed', error: e.googleError };
  }
}

/** Removes an event that was deleted in MAAI from Google as well (best effort). */
export async function removeFromGoogle(e: CalendarEvent): Promise<void> {
  if (!googleWriteConfigured || !e.googleId) return;
  try {
    const res = await eventsCall('DELETE', `/${e.googleId}`);
    if (!res.ok && res.status !== 404 && res.status !== 410) throw await failure(res);
  } catch (error) {
    console.error('Google Calendar delete failed:', (error as Error).message);
  }
}

/** MAAI's own upcoming events that Google has not been sent yet (including ones made before this was set up). */
export const pendingForGoogle = (now = Date.now()): CalendarEvent[] =>
  state.events.filter((e) => !e.demo && !e.allDay && !e.googleId && !e.source && Date.parse(e.start) + e.minutes * 60_000 > now);

export async function sendPendingToGoogle(): Promise<number> {
  let sent = 0;
  for (const e of pendingForGoogle()) {
    if ((await mirrorToGoogle(e))?.status === 'added') {
      sent++;
      audit(`Added "${e.title}" to Google Calendar`, 'MAAI', 'done');
    }
  }
  return sent;
}

/** At start-up, and every 30 minutes after, sends anything Google is missing. */
export function startGoogleWrite() {
  if (!googleWriteConfigured) return;
  const tick = () => void sendPendingToGoogle().catch((e: Error) => console.error('Google Calendar write failed:', e.message));
  setTimeout(tick, 5_000);
  setInterval(tick, 30 * 60_000);
}
