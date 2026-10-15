import { describe, expect, it } from 'vitest';
import { computeStress, levelOf, weekOf, type StressInputs } from './stress';

const empty = (): StressInputs => ({
  events: { left: 0, backToBack: 0, hoursLeft: 0 },
  tasks: { overdue: 0, dueToday: 0 },
  email: { toDecide: 0, toReply: 0, important: 0, unreadUnsorted: 0 },
  whatsapp: { waiting: 0, important: 0 },
  reminders: { dueToday: 0, late: 0 },
});
const with_ = (patch: Partial<StressInputs>): StressInputs => ({ ...empty(), ...patch });

describe('the day\'s load score', () => {
  it('is zero and calm when nothing is waiting', () => {
    expect(computeStress(empty())).toMatchObject({ score: 0, level: 'calm', drivers: [] });
  });

  it('is made of visible parts that add up to the score', () => {
    const s = computeStress(with_({ tasks: { overdue: 2, dueToday: 1 }, email: { toDecide: 2, toReply: 1, important: 1, unreadUnsorted: 0 }, whatsapp: { waiting: 2, important: 0 }, events: { left: 3, backToBack: 1, hoursLeft: 4 } }));
    expect(s.factors.map((f) => f.key)).toEqual(['schedule', 'tasks', 'email', 'whatsapp', 'reminders', 'time']);
    expect(s.score).toBe(s.factors.reduce((a, f) => a + f.points, 0));
    expect(s.factors.find((f) => f.key === 'tasks')).toMatchObject({ count: 3, points: 13 }); // 2 overdue x5 + 1 due today x3
    expect(s.factors.find((f) => f.key === 'email')).toMatchObject({ count: 3, points: 13 }); // 2x4 + 1x2 + 1 important x3
    expect(s.factors.find((f) => f.key === 'schedule')!.points).toBe(9 + 3 + 6); // 3 meetings, 1 back to back, 2 hours beyond the first two
  });

  it('never lets one part count for more than its ceiling, and tops out at 100', () => {
    const worst = computeStress({ events: { left: 40, backToBack: 30, hoursLeft: 20 }, tasks: { overdue: 99, dueToday: 99 }, email: { toDecide: 99, toReply: 99, important: 99, unreadUnsorted: 99 }, whatsapp: { waiting: 99, important: 99 }, reminders: { dueToday: 99, late: 99 }, minutesToNext: 5 });
    expect(worst.score).toBe(100);
    expect(worst.level).toBe('heavy');
    for (const f of worst.factors) expect(f.points).toBeLessThanOrEqual(f.max);
    expect(worst.factors.reduce((a, f) => a + f.max, 0)).toBe(100);
    // a pile of emails alone cannot make the whole day look terrible
    expect(computeStress(with_({ email: { toDecide: 99, toReply: 99, important: 99, unreadUnsorted: 99 } })).score).toBe(20);
  });

  it('counts an overdue task more than one due today, and a late reminder more than one due later', () => {
    expect(computeStress(with_({ tasks: { overdue: 1, dueToday: 0 } })).score).toBeGreaterThan(computeStress(with_({ tasks: { overdue: 0, dueToday: 1 } })).score);
    expect(computeStress(with_({ reminders: { dueToday: 1, late: 1 } })).score).toBeGreaterThan(computeStress(with_({ reminders: { dueToday: 1, late: 0 } })).score);
  });

  it('adds time pressure only when something starts within the hour', () => {
    const at = (m?: number) => computeStress(with_({ minutesToNext: m })).factors.find((f) => f.key === 'time')!.points;
    expect([at(undefined), at(120), at(61), at(60), at(31), at(30), at(0), at(-5)]).toEqual([0, 0, 0, 3, 3, 5, 5, 0]);
  });

  it('names the biggest one or two causes, and none when nothing matters', () => {
    const s = computeStress(with_({ tasks: { overdue: 4, dueToday: 0 }, email: { toDecide: 3, toReply: 0, important: 0, unreadUnsorted: 0 }, whatsapp: { waiting: 1, important: 0 } }));
    expect(s.drivers).toEqual(['tasks', 'email']);
    expect(computeStress(with_({ reminders: { dueToday: 0, late: 0 }, whatsapp: { waiting: 0, important: 0 } })).drivers).toEqual([]);
  });

  it('puts the levels where they should be', () => {
    expect([0, 24, 25, 49, 50, 74, 75, 100].map(levelOf)).toEqual(['calm', 'calm', 'steady', 'steady', 'busy', 'busy', 'heavy', 'heavy']);
  });

  it('never goes down when there is more to do', () => {
    // a random walk: every step adds work to one part
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let input = empty();
    let last = 0;
    for (let i = 0; i < 300; i++) {
      const pick = Math.floor(rand() * 8);
      input = JSON.parse(JSON.stringify(input));
      if (pick === 0) input.events.left++;
      if (pick === 1) input.events.backToBack++;
      if (pick === 2) input.events.hoursLeft += 0.5;
      if (pick === 3) input.tasks.overdue++;
      if (pick === 4) input.tasks.dueToday++;
      if (pick === 5) input.email.toDecide++;
      if (pick === 6) input.whatsapp.waiting++;
      if (pick === 7) input.reminders.late++;
      const score = computeStress(input).score;
      expect(score).toBeGreaterThanOrEqual(last);
      expect(Number.isInteger(score) && score >= 0 && score <= 100).toBe(true);
      last = score;
    }
  });

  it('makes a week of seven days, today last, with zero for days with no record', () => {
    const before = (key: string, back: number) => new Date(Date.parse(`${key}T12:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);
    const week = weekOf({ '2026-10-15': 62, '2026-10-13': 40, '2026-09-01': 99 }, '2026-10-15', before);
    expect(week).toHaveLength(7);
    expect(week.map((d) => d.day)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
    expect(week.map((d) => d.score)).toEqual([0, 0, 0, 0, 40, 0, 62]);
  });
});
