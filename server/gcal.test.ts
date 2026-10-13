import { describe, expect, it } from 'vitest';
import { eventsFromIcs } from './gcal';

const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VEVENT
UID:one@google.com
DTSTART:20261014T070000Z
DTEND:20261014T073000Z
SUMMARY:Call with Omar
LOCATION:Google Meet
END:VEVENT
BEGIN:VEVENT
UID:weekly@google.com
DTSTART:20261011T060000Z
DTEND:20261011T070000Z
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Team meeting
END:VEVENT
BEGIN:VEVENT
UID:allday@google.com
DTSTART;VALUE=DATE:20261015
DTEND;VALUE=DATE:20261016
SUMMARY:National holiday
END:VEVENT
BEGIN:VEVENT
UID:gone@google.com
DTSTART:20261014T120000Z
DTEND:20261014T130000Z
STATUS:CANCELLED
SUMMARY:Cancelled lunch
END:VEVENT
BEGIN:VEVENT
UID:old@google.com
DTSTART:20250101T120000Z
DTEND:20250101T130000Z
SUMMARY:Long ago
END:VEVENT
END:VCALENDAR`;

describe('Google Calendar (iCal)', () => {
  const now = new Date('2026-10-13T09:00:00Z');
  const events = eventsFromIcs(ics, now);
  const titles = events.map((e) => e.title);

  it('reads one-off events with time, length and place', () => {
    const call = events.find((e) => e.title === 'Call with Omar')!;
    expect(call.start).toBe('2026-10-14T07:00:00.000Z');
    expect(call.minutes).toBe(30);
    expect(call.place).toBe('Google Meet');
    expect(call.source).toBe('google');
  });

  it('expands repeating events inside the window', () => {
    expect(events.filter((e) => e.title === 'Team meeting')).toHaveLength(3); // 18, 25 Oct, 1 Nov; 11 Oct is before the window
  });

  it('marks all-day events', () => {
    expect(events.find((e) => e.title === 'National holiday')?.allDay).toBe(true);
  });

  it('skips cancelled and old events', () => {
    expect(titles).not.toContain('Cancelled lunch');
    expect(titles).not.toContain('Long ago');
  });
});
