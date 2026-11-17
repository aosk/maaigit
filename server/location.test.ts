import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/location-data', MAAI_DATA_FILE: '/tmp/claude-0/location-data/store.json', ASANA_TOKEN: '', GOOGLE_CALENDAR_ICS_URL: '', MAAI_PASSWORD: '', MAAI_LATITUDE: '', MAAI_LONGITUDE: '', MAAI_TIMEZONE: '' });
});

import { CITIES, nearestCity } from '../src/places';
import { config, setPlace } from './config';
import { createInnerApp } from './site';
import { listen } from './security/helpers';
import { state } from './store';

let site: { port: number; close: () => Promise<void> };
const put = (body: unknown) => fetch(`http://127.0.0.1:${site.port}/api/location`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = async <T>(path: string) => (await (await fetch(`http://127.0.0.1:${site.port}/api${path}`)).json()) as T;
type Today = { prayers: { name: string; time: string }[] };

beforeAll(async () => {
  site = await listen(createInnerApp());
});
beforeEach(() => {
  delete state.location;
  setPlace(null);
});
afterAll(async () => {
  delete state.location;
  setPlace(null);
  await site.close();
});

describe('where the user is', () => {
  it('starts as Riyadh, and prayer times and the clock follow a new place at once', async () => {
    expect([config.latitude, config.longitude, config.timezone]).toEqual([24.7136, 46.6753, 'Asia/Riyadh']);
    const riyadh = await get<Today>('/today');
    const jeddah = CITIES.find((c) => c.en === 'Jeddah')!;
    const res = await put({ latitude: jeddah.latitude, longitude: jeddah.longitude, timezone: jeddah.timezone, name: 'جدة' });
    expect(res.status).toBe(200);
    expect(state.location).toMatchObject({ name: 'جدة', timezone: 'Asia/Riyadh' });
    const after = await get<Today>('/today');
    // Jeddah is about seven degrees west of Riyadh: every prayer is some 25 to 35 minutes later.
    for (const p of riyadh.prayers) {
      const later = (Date.parse(after.prayers.find((x) => x.name === p.name)!.time) - Date.parse(p.time)) / 60_000;
      expect(later).toBeGreaterThan(15);
      expect(later).toBeLessThan(45);
    }
    expect((await get<{ location: { name: string } }>('/status')).location.name).toBe('جدة');
  });

  it('moves the clock with the time zone, and keeps the position no more exact than needed', async () => {
    expect((await put({ latitude: 51.50735123, longitude: -0.12775987, timezone: 'Europe/London', name: 'London' })).status).toBe(200);
    expect(config.timezone).toBe('Europe/London');
    expect(process.env.TZ).toBe('Europe/London');
    expect(state.location).toMatchObject({ latitude: 51.5074, longitude: -0.1278 });
  });

  it('refuses a place that is not one', async () => {
    const before = state.location;
    for (const bad of [{ latitude: 95, longitude: 10, timezone: 'Asia/Riyadh' }, { latitude: 10, longitude: 200, timezone: 'Asia/Riyadh' }, { latitude: '24', longitude: 46, timezone: 'Asia/Riyadh' }, { latitude: 24, longitude: 46, timezone: 'Mars/Olympus' }, { latitude: 24, longitude: 46 }, {}]) {
      expect((await put(bad)).status).toBe(400);
    }
    expect(state.location).toEqual(before);
  });

  it('names "my location" by the nearest city when one is close', () => {
    expect(nearestCity(21.5, 39.2)?.en).toBe('Jeddah');
    expect(nearestCity(24.75, 46.7)?.en).toBe('Riyadh');
    expect(nearestCity(0, 0)).toBeNull();
    // every city in the list has a real time zone and a position on Earth
    for (const c of CITIES) {
      expect(() => new Intl.DateTimeFormat('en', { timeZone: c.timezone })).not.toThrow();
      expect(Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180).toBe(true);
    }
  });
});
