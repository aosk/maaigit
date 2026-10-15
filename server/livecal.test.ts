import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../shared/types';
import { compare, eventFromApi, type ApiEvent } from './livecal';

const api = (e: Partial<ApiEvent> = {}): ApiEvent => ({ id: 'abc123', summary: 'Design review', start: { dateTime: '2026-10-14T10:00:00+03:00' }, end: { dateTime: '2026-10-14T11:00:00+03:00' }, ...e });

describe('events outside the dates Google is asked for', () => {
  const window = { timeMin: '2026-10-10T00:00:00.000Z', timeMax: '2026-11-10T00:00:00.000Z' };
  const old = { id: 'e1', title: 'Old', start: '2026-08-01T07:00:00.000Z', minutes: 30, googleId: 'g1' } as never;
  const far = { id: 'e2', title: 'Far', start: '2026-12-01T07:00:00.000Z', minutes: 30, googleId: 'g2' } as never;
  const inside = { id: 'e3', title: 'In', start: '2026-10-20T07:00:00.000Z', minutes: 30, googleId: 'g3' } as never;

  it('does not count them as deleted: nothing asks Google about them every minute', () => {
    expect(compare([old, far], [], window).missing).toEqual([]);
  });

  it('still notices one inside the dates that has disappeared', () => {
    expect(compare([inside], [], window).missing).toEqual([inside]);
    expect(compare([inside], []).missing).toEqual([inside]);
  });
});

describe('events from the Google API', () => {
  it('turns a timed event into a MAAI event with its details and join link', () => {
    const e = eventFromApi(api({ location: 'Room 4', description: 'Agenda<br>1. Mockups', hangoutLink: 'https://meet.google.com/abc-defg-hij' }))!;
    expect(e).toMatchObject({ id: 'g:abc123', title: 'Design review', start: '2026-10-14T07:00:00.000Z', minutes: 60, place: 'Room 4', description: 'Agenda\n1. Mockups', meetingUrl: 'https://meet.google.com/abc-defg-hij', source: 'google' });
  });

  it('finds the join link in the conference details, or in the notes', () => {
    expect(eventFromApi(api({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: 'https://zoom.us/j/1' }] } }))!.meetingUrl).toBe('https://zoom.us/j/1');
    expect(eventFromApi(api({ description: 'Call: https://teams.microsoft.com/l/meetup-join/x' }))!.meetingUrl).toBe('https://teams.microsoft.com/l/meetup-join/x');
    expect(eventFromApi(api())!.meetingUrl).toBeUndefined();
  });

  it('handles all-day events', () => {
    const e = eventFromApi(api({ start: { date: '2026-10-15' }, end: { date: '2026-10-16' } }))!;
    expect(e.allDay).toBe(true);
    expect(e.minutes).toBe(24 * 60);
  });

  it('skips cancelled events and ones you declined, and names an untitled one', () => {
    expect(eventFromApi(api({ status: 'cancelled' }))).toBeNull();
    expect(eventFromApi(api({ attendees: [{ self: true, responseStatus: 'declined' }] }))).toBeNull();
    expect(eventFromApi(api({ attendees: [{ self: true, responseStatus: 'accepted' }] }))).not.toBeNull();
    expect(eventFromApi(api({ summary: undefined }))!.title).toBe('(No title)');
  });
});

describe('keeping meetings MAAI wrote to Google in step', () => {
  const mine = (e: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: 'm1', title: 'Design review', start: '2026-10-14T07:00:00.000Z', minutes: 60, googleId: 'abc123', bookedByMaai: true, ...e });

  it('does nothing when Google agrees', () => {
    expect(compare([mine()], [api()])).toEqual({ patches: [], missing: [] });
  });

  it('follows a change made in Google: new time, length or title', () => {
    const moved = api({ summary: 'Design review (moved)', start: { dateTime: '2026-10-14T12:00:00+03:00' }, end: { dateTime: '2026-10-14T12:30:00+03:00' } });
    const { patches } = compare([mine()], [moved]);
    expect(patches).toEqual([{ event: expect.objectContaining({ id: 'm1' }), patch: { title: 'Design review (moved)', start: '2026-10-14T09:00:00.000Z', minutes: 30 } }]);
  });

  it('reports a meeting Google no longer lists, to be checked, but never touches the ones it cannot be about', () => {
    const own = [mine(), mine({ id: 'm2', googleId: undefined }), mine({ id: 'm3', googleId: 'sample', demo: true })];
    expect(compare(own, []).missing.map((e) => e.id)).toEqual(['m1']);
  });
});
