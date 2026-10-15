import type { Stress, StressFactor, StressLevel } from '../shared/types.js';

/**
 * The day's load, as a score out of 100. It is plain arithmetic on things MAAI already knows (no AI), and
 * every point comes from one visible cause, so it can always say why. Each part has a ceiling, so no single
 * thing can make the whole day look worse than it is:
 *
 *   schedule 25   meetings still ahead, back-to-back ones, and hours in meetings
 *   tasks    25   overdue tasks count most, then those due today
 *   email    20   emails that need a decision or an answer, important ones, and unread when not yet sorted
 *   whatsapp 15   people waiting for an answer, important ones count more
 *   reminders 10  those due today, more if one is already late
 *   time      5   something starting very soon
 */

export interface StressInputs {
  events: { left: number; backToBack: number; hoursLeft: number };
  tasks: { overdue: number; dueToday: number };
  email: { toDecide: number; toReply: number; important: number; unreadUnsorted: number };
  whatsapp: { waiting: number; important: number };
  /** `late` are the ones among `dueToday` whose time has already passed. */
  reminders: { dueToday: number; late: number };
  /** Minutes until the next event starts (or until it is time to leave), if there is one today. */
  minutesToNext?: number;
}

const CEILING: Record<StressFactor, number> = { schedule: 25, tasks: 25, email: 20, whatsapp: 15, reminders: 10, time: 5 };

const cap = (key: StressFactor, points: number) => Math.min(CEILING[key], Math.round(Math.max(0, points)));

export const levelOf = (score: number): StressLevel => (score < 25 ? 'calm' : score < 50 ? 'steady' : score < 75 ? 'busy' : 'heavy');

export function computeStress(input: StressInputs): Omit<Stress, 'week'> {
  const { events, tasks, email, whatsapp, reminders } = input;
  const soon = input.minutesToNext;
  const parts: { key: StressFactor; count: number; points: number }[] = [
    { key: 'schedule', count: events.left, points: cap('schedule', events.left * 3 + events.backToBack * 3 + Math.max(0, events.hoursLeft - 2) * 3) },
    { key: 'tasks', count: tasks.overdue + tasks.dueToday, points: cap('tasks', tasks.overdue * 5 + tasks.dueToday * 3) },
    { key: 'email', count: email.toDecide + email.toReply + email.unreadUnsorted, points: cap('email', email.toDecide * 4 + email.toReply * 2 + email.important * 3 + email.unreadUnsorted) },
    { key: 'whatsapp', count: whatsapp.waiting, points: cap('whatsapp', whatsapp.waiting * 3 + whatsapp.important * 3) },
    { key: 'reminders', count: reminders.dueToday, points: cap('reminders', reminders.dueToday * 2 + reminders.late * 3) },
    { key: 'time', count: soon !== undefined && soon >= 0 && soon <= 60 ? 1 : 0, points: cap('time', soon === undefined || soon < 0 ? 0 : soon <= 30 ? 5 : soon <= 60 ? 3 : 0) },
  ];
  const factors = parts.map((p) => ({ ...p, max: CEILING[p.key] }));
  const score = Math.min(100, factors.reduce((a, f) => a + f.points, 0));
  // The parts that matter: at least a fifth of their ceiling, biggest first, at most two.
  const drivers = [...factors]
    .filter((f) => f.points > 0 && f.points >= f.max * 0.2)
    .sort((a, b) => b.points - a.points)
    .slice(0, 2)
    .map((f) => f.key);
  return { score, level: levelOf(score), factors, drivers };
}

/** The last seven days (today last) from the highest score each day reached; days with none count as 0. */
export function weekOf(days: Record<string, number>, today: string, dayBefore: (key: string, back: number) => string): Stress['week'] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = dayBefore(today, 6 - i);
    return { day, score: days[day] ?? 0 };
  });
}
