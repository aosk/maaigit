import type { Stress, StressFactor, StressLevel } from '../shared/types.js';

/**
 * The day's load, as a score out of 100. It is plain arithmetic on things MAAI already knows (no AI), and
 * every point comes from one visible cause, so it can always say why. Each part has a ceiling, so no single
 * thing can make the whole day look worse than it is:
 *
 *   schedule 22   meetings still ahead, back-to-back ones, and hours in meetings
 *   tasks    22   overdue tasks count most, then those due today
 *   email    18   emails that need a decision or an answer, important ones, and unread when not yet sorted
 *   whatsapp 14   people waiting for an answer, important ones count more
 *   reminders 9   those due today, more if one is already late
 *   time      5   something starting very soon
 *   stocks   10   StockSmart's day: a loss, measured against your daily loss limit (paper counts half, it is
 *                 practice); trading stopped, or the SNB bot failing while real money is on. Gains add nothing.
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
  /** StockSmart today: profit or loss (SAR and % of capital), the daily loss limit (%), and what is wrong, if anything. */
  stocks?: { dayPnl: number; dayPnlPct: number; lossLimitPct: number; live: boolean; halted: boolean; botProblem: boolean };
}

const CEILING: Record<StressFactor, number> = { schedule: 22, tasks: 22, email: 18, whatsapp: 14, reminders: 9, time: 5, stocks: 10 };

const cap = (key: StressFactor, points: number) => Math.min(CEILING[key], Math.round(Math.max(0, points)));

export const levelOf = (score: number): StressLevel => (score < 25 ? 'calm' : score < 50 ? 'steady' : score < 75 ? 'busy' : 'heavy');

/** A loss at the daily limit is the full 10 (5 on paper); a stop is at least 6, a failing bot with real money at least 4. */
function stocksPoints(s: StressInputs['stocks']): number {
  if (!s) return 0;
  const lossShare = s.lossLimitPct > 0 ? Math.max(0, -s.dayPnlPct) / s.lossLimitPct : 0;
  let points = Math.min(1, lossShare) * CEILING.stocks * (s.live ? 1 : 0.5);
  if (s.halted) points = Math.max(points, 6);
  if (s.live && s.botProblem) points = Math.max(points, 4);
  return points;
}

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
    { key: 'stocks', count: Math.round(input.stocks?.dayPnl ?? 0), points: cap('stocks', stocksPoints(input.stocks)) },
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
