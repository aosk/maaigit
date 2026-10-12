import { CalculationMethod, Coordinates, PrayerTimes } from 'adhan';

export type PrayerName = 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';

export interface PrayerSlot {
  name: PrayerName;
  time: Date;
}

/** Minutes kept free around each prayer; nothing is booked inside them. */
export const PRAYER_BUFFER_MINUTES = 20;

/** The day's five prayers, using the Umm al-Qura method used across Saudi Arabia. */
export function prayersFor(day: Date, latitude: number, longitude: number): PrayerSlot[] {
  const times = new PrayerTimes(new Coordinates(latitude, longitude), day, CalculationMethod.UmmAlQura());
  return [
    { name: 'fajr', time: times.fajr },
    { name: 'dhuhr', time: times.dhuhr },
    { name: 'asr', time: times.asr },
    { name: 'maghrib', time: times.maghrib },
    { name: 'isha', time: times.isha },
  ];
}

/** The next prayer from `now`, looking into tomorrow after Isha. */
export function nextPrayer(now: Date, latitude: number, longitude: number): PrayerSlot {
  const today = prayersFor(now, latitude, longitude).find((p) => p.time > now);
  if (today) return today;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return prayersFor(tomorrow, latitude, longitude)[0];
}

/** True when [start, start+minutes) overlaps a prayer's protected window. */
export function clashesWithPrayer(start: Date, minutes: number, prayers: PrayerSlot[]): PrayerSlot | undefined {
  const end = start.getTime() + minutes * 60_000;
  return prayers.find((p) => {
    const from = p.time.getTime();
    const to = from + PRAYER_BUFFER_MINUTES * 60_000;
    return start.getTime() < to && end > from;
  });
}
