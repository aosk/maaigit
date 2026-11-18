import { describe, expect, it } from 'vitest';
import { readSite } from './monitorSite';

/** The shape the user's site answers with (values made up). */
const answer = {
  status: 'ok',
  service: 'hail-moving-atlas',
  checked_at: '2026-11-18T21:57:01Z',
  timezone: 'Asia/Riyadh',
  health: { database: 'ok', database_latency_ms: 12.4 },
  visitors: {
    metric: 'daily_unique',
    definition: 'unique visitors per day',
    today: 41,
    yesterday: 57,
    last_7_days: 310,
    last_30_days: 1204,
    total_daily_unique: 5320,
    counting_started_on: '2026-08-01',
    range: { from: '2026-10-20', to: '2026-11-18', days: 30 },
    daily: [
      { date: '2026-11-18', visitors: 41 },
      { date: '2026-11-16', visitors: 33 },
      { date: '2026-11-17', visitors: 57 },
    ],
  },
};

describe("reading the user's site", () => {
  it('reads its state, its database and its visitors, days oldest first', () => {
    const site = readSite(answer)!;
    expect(site).toMatchObject({ up: true, status: 'ok', service: 'hail-moving-atlas', checkedAt: '2026-11-18T21:57:01Z' });
    expect(site.parts).toEqual([{ name: 'database', up: true, state: 'ok', ms: 12.4 }]);
    expect(site.visitors).toMatchObject({ today: 41, yesterday: 57, week: 310, month: 1204, total: 5320, since: '2026-08-01', definition: 'unique visitors per day' });
    expect(site.visitors!.daily).toEqual([{ date: '2026-11-16', count: 33 }, { date: '2026-11-17', count: 57 }, { date: '2026-11-18', count: 41 }]);
  });

  it('shows trouble plainly', () => {
    const site = readSite({ ...answer, status: 'degraded', health: { database: 'down' } })!;
    expect(site.up).toBe(false);
    expect(site.parts).toEqual([{ name: 'database', up: false, state: 'down', ms: undefined }]);
  });

  it('finds the date and the count in a day whatever they are called', () => {
    const rows = [{ day: '2026-11-17', unique: 5 }, { when: '2026-11-18T00:00:00Z', n: 7 }, { nothing: true }, 'x'];
    expect(readSite({ visitors: { daily: rows } })!.visitors!.daily).toEqual([{ date: '2026-11-17', count: 5 }, { date: '2026-11-18', count: 7 }]);
  });

  it('gives null for an answer of another shape, so it is shown as it is', () => {
    for (const other of [null, 'ok', [1, 2], { requests: 5 }]) expect(readSite(other)).toBeNull();
  });
});
