import { describe, expect, it } from 'vitest';
import type { CalendarEvent, NotifyPrefs, Reminder } from '../shared/types';
import { prayersFor } from '../shared/prayer';
import { dueAlerts, reminderTime } from './notify';

const LAT = 24.7136;
const LNG = 46.6753;
const prefs: NotifyPrefs = { reminders: true, leave: true, events: true, eventMinutes: 10, prayers: true, prayerMinutes: 10 };
const at = (h: number, m: number, day = new Date('2026-10-12T00:00:00')) => {
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
};
const reminder = (r: Partial<Reminder>): Reminder => ({ id: 'r1', title: 'Call mum', when: '', repeat: 'once', done: false, ...r });

describe('reminder times', () => {
  it('fires a one-off clock reminder only on its day', () => {
    const r = reminder({ at: at(20, 0).toISOString() });
    expect(reminderTime(r, at(9, 0), LAT, LNG)?.getTime()).toBe(at(20, 0).getTime());
    expect(reminderTime(r, at(9, 0, new Date('2026-10-13T00:00:00')), LAT, LNG)).toBeNull();
  });

  it('repeats a daily reminder at the same time of day', () => {
    const r = reminder({ at: at(7, 30).toISOString(), repeat: 'daily' });
    const nextDay = new Date('2026-10-15T00:00:00');
    expect(reminderTime(r, nextDay, LAT, LNG)?.getTime()).toBe(at(7, 30, nextDay).getTime());
  });

  it('ties a reminder to a prayer', () => {
    const day = at(12, 0);
    const maghrib = prayersFor(day, LAT, LNG).find((p) => p.name === 'maghrib')!.time;
    const r = reminder({ prayer: 'maghrib', offsetMinutes: 15, repeat: 'daily' });
    expect(reminderTime(r, day, LAT, LNG)?.getTime()).toBe(maghrib.getTime() + 15 * 60_000);
  });

  it('skips reminders marked done', () => {
    expect(reminderTime(reminder({ at: at(20, 0).toISOString(), done: true }), at(9, 0), LAT, LNG)).toBeNull();
  });
});

describe('due alerts', () => {
  const dentist: CalendarEvent = { id: 'e1', title: 'Dentist', start: at(16, 0).toISOString(), minutes: 45, travelMinutes: 18 };

  it('says when to leave, travel time plus 10 minutes ahead', () => {
    const due = dueAlerts(at(15, 33), { reminders: [], events: [dentist] }, { ...prefs, events: false, prayers: false }, LAT, LNG);
    expect(due.map((d) => d.kind)).toEqual(['leave']);
    expect(due[0].text('en').title).toBe('Time to leave: Dentist');
  });

  it('does not send alerts that are far in the past or still to come', () => {
    const only = { ...prefs, events: false, prayers: false };
    expect(dueAlerts(at(15, 0), { reminders: [], events: [dentist] }, only, LAT, LNG)).toHaveLength(0);
    expect(dueAlerts(at(15, 50), { reminders: [], events: [dentist] }, only, LAT, LNG)).toHaveLength(0);
  });

  it('respects switched-off kinds', () => {
    const none = { reminders: false, leave: false, events: false, eventMinutes: 10, prayers: false, prayerMinutes: 10 };
    expect(dueAlerts(at(15, 33), { reminders: [], events: [dentist] }, none, LAT, LNG)).toHaveLength(0);
  });

  it('warns before a prayer', () => {
    const day = at(12, 0);
    const asr = prayersFor(day, LAT, LNG).find((p) => p.name === 'asr')!.time;
    const due = dueAlerts(new Date(asr.getTime() - 9 * 60_000), { reminders: [], events: [] }, prefs, LAT, LNG);
    expect(due.find((d) => d.kind === 'prayer')?.text('ar').title).toBe('صلاة العصر');
  });
});
