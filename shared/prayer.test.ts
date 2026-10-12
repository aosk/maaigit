import { describe, expect, it } from 'vitest';
import { PRAYER_BUFFER_MINUTES, clashesWithPrayer, nextPrayer, prayersFor } from './prayer';

const RIYADH = { lat: 24.7136, lng: 46.6753 };
const day = new Date('2026-10-12T06:00:00Z');

describe('prayer times', () => {
  it('returns the five prayers in order', () => {
    const prayers = prayersFor(day, RIYADH.lat, RIYADH.lng);
    expect(prayers.map((p) => p.name)).toEqual(['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
    for (let i = 1; i < prayers.length; i++) expect(prayers[i].time > prayers[i - 1].time).toBe(true);
  });

  it('flags a meeting that overlaps a prayer window', () => {
    const prayers = prayersFor(day, RIYADH.lat, RIYADH.lng);
    const dhuhr = prayers[1].time;
    expect(clashesWithPrayer(new Date(dhuhr.getTime() - 10 * 60_000), 30, prayers)?.name).toBe('dhuhr');
    expect(clashesWithPrayer(new Date(dhuhr.getTime() + PRAYER_BUFFER_MINUTES * 60_000), 30, prayers)).toBeUndefined();
    expect(clashesWithPrayer(new Date(dhuhr.getTime() - 60 * 60_000), 30, prayers)).toBeUndefined();
  });

  it('rolls over to tomorrow’s Fajr after Isha', () => {
    const isha = prayersFor(day, RIYADH.lat, RIYADH.lng)[4].time;
    const next = nextPrayer(new Date(isha.getTime() + 60_000), RIYADH.lat, RIYADH.lng);
    expect(next.name).toBe('fajr');
    expect(next.time > isha).toBe(true);
  });
});
