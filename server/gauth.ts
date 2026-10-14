import { createSign } from 'node:crypto';

/**
 * Signing in to Google Calendar as a "service account": a robot account you create once in
 * Google Cloud and share your calendar with. No sign-in screen, nothing that expires.
 *   GOOGLE_SERVICE_ACCOUNT  the downloaded JSON key (pasted as is, or base64 of it)
 *   GOOGLE_CALENDAR_ID      the calendar to use (usually your Gmail address)
 * Used both to write the meetings you approve (gwrite.ts) and to read the calendar live (livecal.ts).
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = process.env.GOOGLE_CALENDAR_API ?? 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export interface ServiceKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** A Google problem in plain words. */
export class GoogleError extends Error {}

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
export const serviceKey = KEY;
export const calendarId = process.env.GOOGLE_CALENDAR_ID?.trim();

/** Both the key and the calendar are given. */
export const googleCalendarConfigured = Boolean(KEY && calendarId);

/** What is wrong with the settings themselves (before any request is made), if anything. */
export const setupProblem: string | undefined = KEY_PROBLEM ?? (KEY && !calendarId ? 'GOOGLE_CALENDAR_ID is missing (your Gmail address, or the Calendar ID from the calendar settings).' : undefined);

/** True when anything about the Google Calendar connection has been set. */
export const googleCalendarMentioned = Boolean(process.env.GOOGLE_SERVICE_ACCOUNT || calendarId);

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
  if (!KEY) throw new GoogleError('Google Calendar is not set up.');
  if (token && Date.now() < token.expiresAt) return token.value;
  const res = await fetch(KEY.token_uri ?? TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signJwt(KEY) }),
  }).catch(() => {
    throw new GoogleError('Could not reach Google. Try again in a moment.');
  });
  if (!res.ok) throw new GoogleError('Google did not accept the service account key. Create a new key and update GOOGLE_SERVICE_ACCOUNT.');
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in - 120) * 1000 };
  return token.value;
}

/** A request to the calendar's events (`path` is "" for the list, or "/<event id>"). */
export async function eventsCall(method: string, path: string, options: { body?: unknown; query?: Record<string, string> } = {}): Promise<Response> {
  const query = options.query ? `?${new URLSearchParams(options.query)}` : '';
  return fetch(`${API}/calendars/${encodeURIComponent(calendarId!)}/events${path}${query}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }).catch(() => {
    throw new GoogleError('Could not reach Google. Try again in a moment.');
  });
}

/** Why a request failed, in words that say what to do. */
export async function failure(res: Response): Promise<GoogleError> {
  const message = ((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? '';
  if (res.status === 404) return new GoogleError('Google cannot find that calendar. Check GOOGLE_CALENDAR_ID.');
  if (res.status === 403 && /not been used|disabled|accessNotConfigured/i.test(message)) {
    return new GoogleError('The Google Calendar API is not turned on. In Google Cloud: APIs & Services → Library → Google Calendar API → Enable.');
  }
  if (res.status === 403) return new GoogleError(`Google refused. Share the calendar with ${KEY?.client_email} and choose "Make changes to events".`);
  return new GoogleError(`Google said: ${message || res.status}`);
}
