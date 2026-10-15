import { describe, expect, it } from 'vitest';
import type { CalendarEvent, NotifyPrefs, Reminder } from '../shared/types';
import { prayersFor } from '../shared/prayer';
import { dueAlerts, firstPrayerTime, reminderTime } from './notify';

const LAT = 24.7136;
const LNG = 46.6753;
const prefs: NotifyPrefs = { reminders: true, leave: true, events: true, eventMinutes: 10, prayers: true, prayerMinutes: 10, briefing: false, briefingTime: '07:00' };
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

  it('says when to leave, travel time plus 10 minutes ahead', async () => {
    const due = dueAlerts(at(15, 33), { reminders: [], events: [dentist] }, { ...prefs, events: false, prayers: false }, LAT, LNG);
    expect(due.map((d) => d.kind)).toEqual(['leave']);
    expect((await due[0].text('en')).title).toBe('Time to leave: Dentist');
  });

  it('does not send alerts that are far in the past or still to come', () => {
    const only = { ...prefs, events: false, prayers: false };
    expect(dueAlerts(at(15, 0), { reminders: [], events: [dentist] }, only, LAT, LNG)).toHaveLength(0);
    expect(dueAlerts(at(15, 50), { reminders: [], events: [dentist] }, only, LAT, LNG)).toHaveLength(0);
  });

  it('respects switched-off kinds', () => {
    const none = { ...prefs, reminders: false, leave: false, events: false, prayers: false };
    expect(dueAlerts(at(15, 33), { reminders: [], events: [dentist] }, none, LAT, LNG)).toHaveLength(0);
  });

  it('warns before a prayer', async () => {
    const day = at(12, 0);
    const asr = prayersFor(day, LAT, LNG).find((p) => p.name === 'asr')!.time;
    const due = dueAlerts(new Date(asr.getTime() - 9 * 60_000), { reminders: [], events: [] }, prefs, LAT, LNG);
    expect((await due.find((d) => d.kind === 'prayer')!.text('ar')).title).toBe('صلاة العصر');
  });

  describe('the daily briefing', () => {
    const on = { ...prefs, reminders: false, leave: false, events: false, prayers: false, briefing: true, briefingTime: '07:00' };
    const write = async (lang: string) => (lang === 'ar' ? 'لديك ٣ مواعيد' : 'You have 3 events');
    const briefings = (when: Date, p = on, w: typeof write = write) => dueAlerts(when, { reminders: [], events: [] }, p, LAT, LNG, w).filter((d) => d.kind === 'briefing');

    it('goes out at the chosen time, and not before or long after', () => {
      expect(briefings(at(6, 59))).toHaveLength(0);
      expect(briefings(at(7, 0))).toHaveLength(1);
      expect(briefings(at(7, 9))).toHaveLength(1);
      expect(briefings(at(7, 20))).toHaveLength(0);
    });

    it('is once a day: the key changes with the date, not the minute', () => {
      const [a] = briefings(at(7, 1));
      const [b] = briefings(at(7, 8));
      const [tomorrow] = briefings(at(7, 1, new Date('2026-10-13T00:00:00')));
      expect(a.key).toBe(b.key);
      expect(tomorrow.key).not.toBe(a.key);
    });

    it('can be off, or have no writer', () => {
      expect(briefings(at(7, 1), { ...on, briefing: false })).toHaveLength(0);
      expect(dueAlerts(at(7, 1), { reminders: [], events: [] }, on, LAT, LNG)).toHaveLength(0);
    });

    it('is titled for the time of day and carries the written summary, in either language', async () => {
      const [morning] = briefings(at(7, 1));
      expect(await morning.text('en')).toEqual({ title: 'Morning briefing', body: 'You have 3 events' });
      expect((await morning.text('ar')).title).toBe('موجز الصباح');
      const [night] = briefings(at(19, 1), { ...on, briefingTime: '19:00' });
      expect((await night.text('en')).title).toBe('Night briefing');
      const [noon] = briefings(at(13, 0), { ...on, briefingTime: '13:00' });
      expect((await noon.text('ar')).title).toBe('موجز الظهر');
    });

    it('still arrives, with a pointer to the app, if writing it fails', async () => {
      const [due] = briefings(at(7, 1), on, async () => {
        throw new Error('Claude is down');
      });
      expect(await due.text('en')).toEqual({ title: 'Morning briefing', body: 'Open MAAI to see your day.' });
    });

    it('ignores a time that is not HH:MM and uses 07:00', () => {
      expect(briefings(at(7, 1), { ...on, briefingTime: 'later' })).toHaveLength(1);
    });
  });
});

describe('prayer reminders that are not repeated every day', () => {
  const day = at(12, 0);
  const next = new Date('2026-10-13T00:00:00');
  const week = new Date('2026-10-19T00:00:00');

  it('fires a one-off prayer reminder only on the day it was set for', () => {
    const r = reminder({ prayer: 'maghrib', offsetMinutes: 15, at: day.toISOString() });
    expect(reminderTime(r, day, LAT, LNG)).not.toBeNull();
    expect(reminderTime(r, next, LAT, LNG)).toBeNull();
  });

  it('fires a weekly prayer reminder only on its weekday, and a daily one from its first day on', () => {
    const weekly = reminder({ prayer: 'fajr', repeat: 'weekly', at: day.toISOString() });
    expect(reminderTime(weekly, next, LAT, LNG)).toBeNull();
    expect(reminderTime(weekly, week, LAT, LNG)).not.toBeNull();
    const daily = reminder({ prayer: 'fajr', repeat: 'daily', at: next.toISOString() });
    expect(reminderTime(daily, day, LAT, LNG)).toBeNull();
    expect(reminderTime(daily, week, LAT, LNG)).not.toBeNull();
  });

  it('works out the first time: today if it is still ahead, otherwise tomorrow', () => {
    const morning = at(6, 0);
    const first = firstPrayerTime('maghrib', 15, morning, LAT, LNG);
    expect(first.toDateString()).toBe(morning.toDateString());
    const night = at(23, 0);
    expect(firstPrayerTime('maghrib', 15, night, LAT, LNG).toDateString()).toBe(new Date(night.getTime() + 86_400_000).toDateString());
  });
});
