import { describe, expect, it } from 'vitest';
import { eventsFromIcs, meetingLink, plainNotes } from './gcal';

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

describe('event details', () => {
  const detailed = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:d1@google.com
DTSTART:20261014T070000Z
DTEND:20261014T080000Z
SUMMARY:Design review
LOCATION:Room 4\\, Riyadh
DESCRIPTION:Agenda:\\n1. Mockups\\nBackup call: https://zoom.us/j/12345?pwd=abc<br>See <b>notes</b> at https://example.com/doc
X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij
END:VEVENT
BEGIN:VEVENT
UID:d2@google.com
DTSTART:20261014T090000Z
DTEND:20261014T093000Z
SUMMARY:Sync
LOCATION:https://teams.microsoft.com/l/meetup-join/abc
END:VEVENT
BEGIN:VEVENT
UID:d3@google.com
DTSTART:20261014T100000Z
DTEND:20261014T103000Z
SUMMARY:Coffee
DESCRIPTION:Let's talk about https://example.com/menu
END:VEVENT
END:VCALENDAR`;
  const now = new Date('2026-10-13T10:00:00Z');
  const [review, sync, coffee] = eventsFromIcs(detailed, now, 'iPhone (iCloud)');

  it('keeps the notes as plain text and says which calendar it came from', () => {
    expect(review.description).toBe('Agenda:\n1. Mockups\nBackup call: https://zoom.us/j/12345?pwd=abc\nSee notes at https://example.com/doc');
    expect(review.place).toBe('Room 4, Riyadh');
    expect(review.calendar).toBe('iPhone (iCloud)');
  });

  it('finds the link to join: Google\'s own first, then the location, never an ordinary web page', () => {
    expect(review.meetingUrl).toBe('https://meet.google.com/abc-defg-hij');
    expect(sync.meetingUrl).toBe('https://teams.microsoft.com/l/meetup-join/abc');
    expect(coffee.meetingUrl).toBeUndefined();
  });

  it('finds a meeting link inside notes, and ignores broken addresses', () => {
    expect(meetingLink('', 'Join https://zoom.us/j/99 now')).toBe('https://zoom.us/j/99');
    expect(meetingLink('http://', 'https://')).toBeUndefined();
    expect(plainNotes('a<br/>b&amp;c<script>x</script>')).toBe('a\nb&cx');
  });
});
