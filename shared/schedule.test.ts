import { describe, expect, it } from 'vitest';
import { LEAVE_BUFFER_MINUTES, dedupeEvents, eventEnd, leaveTime } from './schedule';

describe('schedule helpers', () => {
  const start = '2026-10-14T13:00:00.000Z';

  it('works out when an event ends', () => {
    expect(eventEnd({ start, minutes: 45 })).toBe(Date.parse('2026-10-14T13:45:00.000Z'));
  });

  it('says when to leave, with a margin on top of travel time', () => {
    expect(leaveTime({ start, travelMinutes: 20 })?.getTime()).toBe(Date.parse(start) - (20 + LEAVE_BUFFER_MINUTES) * 60_000);
    expect(leaveTime({ start })).toBeNull();
  });
});

describe('de-duplicating events', () => {
  const e = (title: string, start = '2026-10-14T07:00:00.000Z', minutes = 30) => ({ title, start, minutes });

  it('shows a meeting once when two calendars have it, keeping the first', () => {
    const own = { ...e('Call with Omar'), travelMinutes: 10 };
    const { events, merged } = dedupeEvents([own, { ...e('call with omar ') }, e('Other')]);
    expect(merged).toBe(1);
    expect(events).toHaveLength(2);
    expect(events[0]).toBe(own);
  });

  it('keeps meetings that differ in time or length', () => {
    expect(dedupeEvents([e('Sync'), e('Sync', '2026-10-15T07:00:00.000Z'), e('Sync', undefined, 60)]).merged).toBe(0);
  });
});
