import { describe, expect, it } from 'vitest';
import { LEAVE_BUFFER_MINUTES, eventEnd, leaveTime } from './schedule';

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
