import { createSign } from 'node:crypto';
import type { CalendarEvent, CalendarWriteStatus } from '../shared/types.js';
import { config } from './config.js';
import { audit, save, state } from './store.js';

/**
 * Puts the meetings you approve in MAAI into your Google Calendar. It signs in as a
 * "service account" (a robot account you create once in Google Cloud and then share
 * your calendar with), so there is no sign-in screen and no token that expires:
 *   GOOGLE_SERVICE_ACCOUNT  the downloaded JSON key (pasted as is, or base64 of it)
 *   GOOGLE_CALENDAR_ID      the calendar to write to (usually your Gmail address)
 * Only events created in MAAI go out; the ones read from Google never come back.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = process.env.GOOGLE_CALENDAR_API ?? 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

interface ServiceKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** A Google problem in plain words. */
export class GoogleWriteError extends Error {}

function readKey(): { key?: ServiceKey; problem?: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) as Partial<ServiceKey>;
    if (typeof parsed.client_email === 'string' && typeof parsed.private_key === 'string') return { key: parsed as ServiceKey };
  } catch {
    // falls through to the message below
  }
  return { problem: 'GOOGLE_SERVICE_ACCOUNT is not the JSON key file. Paste the whole contents of the file you downloaded from Google Cloud.' };
}

const { key: KEY, problem: KEY_PROBLEM } = readKey();
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID?.trim();

export const googleWriteConfigured = Boolean(KEY && CALENDAR_ID);

let lastError: string | undefined = KEY_PROBLEM ?? (KEY && !CALENDAR_ID ? 'GOOGLE_CALENDAR_ID is missing (your Gmail address, or the Calendar ID from the calendar settings).' : undefined);

export function googleWriteStatus(): CalendarWriteStatus {
  return { configured: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT || CALENDAR_ID), working: googleWriteConfigured && !lastError, calendar: CALENDAR_ID, shareWith: KEY?.client_email, error: lastError };
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** The signed request Google exchanges for an access token. */
export function signJwt(key: ServiceKey, now = Math.floor(Date.now() / 1000)): string {
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({ iss: key.client_email, scope: SCOPE, aud: key.token_uri ?? TOKEN_URL, iat: now, exp: now + 3600 });
  const signature = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key.private_key).toString('base64url');
  return `${head}.${claim}.${signature}`;
}

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (!KEY) throw new GoogleWriteError('Google Calendar writing is not set up.');
  if (token && Date.now() < token.expiresAt) return token.value;
  const res = await fetch(KEY.token_uri ?? TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(KEY) }),
  }).catch(() => {
    throw new GoogleWriteError('Could not reach Google. Try again in a moment.');
  });
  if (!res.ok) throw new GoogleWriteError('Google did not accept the service account key. Create a new key and update GOOGLE_SERVICE_ACCOUNT.');
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 120) * 1000 };
  return token.value;
}

async function calendarCall(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${API}/calendars/${encodeURIComponent(CALENDAR_ID!)}/events${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => {
    throw new GoogleWriteError('Could not reach Google. Try again in a moment.');
  });
  return res;
}

async function failure(res: Response): Promise<GoogleWriteError> {
  const message = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? '';
  if (res.status === 404) return new GoogleWriteError('Google cannot find that calendar. Check GOOGLE_CALENDAR_ID.');
  if (res.status === 403 && /not been used|disabled|accessNotConfigured/i.test(message)) {
    return new GoogleWriteError('The Google Calendar API is not turned on. In Google Cloud: APIs & Services → Library → Google Calendar API → Enable.');
  }
  if (res.status === 403) return new GoogleWriteError(`Google refused. Share the calendar with ${KEY?.client_email} and choose "Make changes to events".`);
  return new GoogleWriteError(`Google said: ${message || res.status}`);
}

/** The id MAAI gives Google, so sending the same event twice never makes two. Google allows 0-9 and a-v. */
const googleId = (e: CalendarEvent) => `maai${e.id.toLowerCase().replace(/[^0-9a-v]/g, '')}0000`;

/** Adds one event to Google Calendar. */
async function insert(e: CalendarEvent): Promise<string> {
  const id = googleId(e);
  const end = new Date(Date.parse(e.start) + e.minutes * 60_000).toISOString();
  const res = await calendarCall('POST', '', {
    id,
    summary: e.title,
    // MAAI sometimes keeps the invitee's email in "place"; that is not a location.
    ...(e.place && !e.place.includes('@') ? { location: e.place } : {}),
    description: e.bookedByMaai ? 'Booked by MAAI' : 'Added in MAAI',
    start: { dateTime: e.start, timeZone: config.timezone },
    end: { dateTime: end, timeZone: config.timezone },
    extendedProperties: { private: { maaiId: e.id } },
  });
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
    const res = await calendarCall('DELETE', `/${e.googleId}`);
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
