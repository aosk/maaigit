import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import type { CalendarEvent } from '../shared/types.js';
import { config } from './config.js';
import { state } from './store.js';

/**
 * MAAI's own calendar as a subscribable feed (.ics), so meetings MAAI books also
 * appear in the iPhone Calendar and Google Calendar. The link carries a long random
 * token: calendar apps can't sign in, so the link itself is the key. Read-only for
 * them; MAAI-only events (not the ones read from Google, which would loop back).
 */

const TOKEN_FILE = path.join(config.dataDir, 'feed-token');

function token(): string {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    const fresh = randomBytes(24).toString('hex');
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(TOKEN_FILE, fresh);
    return fresh;
  }
}

const TOKEN = token();
export const feedPath = `/calendar/${TOKEN}.ics`;

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escapeText = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** iCalendar lines may be at most 75 bytes; longer ones continue on the next line after a space. */
export function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/** The calendar file for these events. */
export function icsFeed(events: CalendarEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MAAI//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:MAAI', 'X-PUBLISHED-TTL:PT15M', 'REFRESH-INTERVAL;VALUE=DURATION:PT15M'];
  for (const e of events) {
    const start = new Date(e.start);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@maai`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(new Date(start.getTime() + e.minutes * 60_000))}`,
      `SUMMARY:${escapeText(e.title)}`,
    );
    if (e.place) lines.push(`LOCATION:${escapeText(e.place)}`);
    if (e.bookedByMaai) lines.push('DESCRIPTION:Booked by MAAI');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** The events worth publishing: MAAI's own, real (not the first-run samples), from the last month on. */
export function feedEvents(now = new Date()): CalendarEvent[] {
  const from = now.getTime() - 30 * 86_400_000;
  return state.events.filter((e) => !e.demo && !e.allDay && Date.parse(e.start) >= from);
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Served before the sign-in check, because calendar apps cannot sign in. */
export const feedRoutes = Router();
feedRoutes.get(/^\/calendar\/([a-f0-9]{48})\.ics$/, (req, res) => {
  if (!same(req.params[0], TOKEN)) return res.status(404).end();
  res.type('text/calendar; charset=utf-8').set('Cache-Control', 'no-cache').send(icsFeed(feedEvents()));
});
