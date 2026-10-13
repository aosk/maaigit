import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../shared/types';
import { fold, icsFeed } from './feed';
import { eventsFromIcs } from './gcal';

const event = (e: Partial<CalendarEvent>): CalendarEvent => ({ id: 'abc', title: 'Meeting with Sara', start: '2026-10-14T07:00:00.000Z', minutes: 30, ...e });
const now = new Date('2026-10-13T10:00:00Z');

describe('MAAI calendar feed', () => {
  it('writes events a calendar app can read', () => {
    const ics = icsFeed([event({ place: 'Office, floor 2', bookedByMaai: true })], now);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:abc@maai');
    expect(ics).toContain('DTSTART:20261014T070000Z');
    expect(ics).toContain('DTEND:20261014T073000Z');
    expect(ics).toContain('LOCATION:Office\\, floor 2');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('is read back the same by the calendar reader (a round trip)', () => {
    const back = eventsFromIcs(icsFeed([event({ title: 'اجتماع مع سارة; مهم' })], now), now);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ title: 'اجتماع مع سارة; مهم', start: '2026-10-14T07:00:00.000Z', minutes: 30 });
  });

  it('folds long lines at 75 bytes without splitting a character', () => {
    const line = fold('SUMMARY:' + 'ناجز '.repeat(30));
    for (const part of line.split('\r\n')) expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
    expect(line.replace(/\r\n /g, '')).toBe('SUMMARY:' + 'ناجز '.repeat(30));
  });
});
