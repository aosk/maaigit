import type { Duty } from '../shared/types.js';
import { queueCommand } from './bot.js';
import { alertFollowup } from './notify.js';
import { audit, save, state } from './store.js';
import { escalationText, reminderText } from './team-text.js';
import { beingRead } from './team-replies.js';
import { memberOf, openDuties } from './teams.js';

/**
 * The reminders. Every minute each open follow-up is looked at: the first reminder goes out a day before it is due
 * (at once if it was made later than that), a second one when nobody has answered the first within the wait the
 * user set, and after the second goes unanswered the user is told. Nothing goes out on the team's days off or outside
 * the sending hours, and nobody gets more than a few messages a day. A person who answers stops the chain: what the
 * answer means is read in server/team-replies.ts.
 */

const DAY_MS = 86_400_000;
/** Most reminders to one person in a day, across everything they owe. */
const MAX_PER_PERSON_DAY = 6;

/** Whether a message to this person may go out now: not on their team's days off, and inside the sending hours (Riyadh). */
function mayMessageNow(duty: Duty, now: Date): boolean {
  const { fromHour, toHour } = state.teamSettings;
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const off = state.teams.find((t) => t.id === duty.teamId)?.offDays ?? [5, 6];
  return !off.includes(weekday) && hour >= fromHour && hour < toHour;
}

type Action = { do: 'remind'; n: 1 | 2 | 3 } | { do: 'escalate' } | null;

/** What this follow-up needs now, from what was sent and answered so far. */
export function nextAction(duty: Duty, now: Date): Action {
  if (duty.status === 'done' || duty.status === 'cancelled' || duty.status === 'blocked') return null;
  const wait = state.teamSettings.hoursBetween * 3_600_000;
  const due = Date.parse(duty.due);
  const last = duty.reminders.at(-1);
  const answered = last ? duty.replies.some((r) => r.at > last.at) : false;
  if (duty.status === 'acknowledged') {
    // Said they will do it: nothing more until it falls due, then one reminder, then the user if that goes unanswered.
    if (!duty.reminders.some((r) => r.n === 3)) return now.getTime() >= due ? { do: 'remind', n: 3 } : null;
    return !answered && !duty.escalatedAt && now.getTime() - Date.parse(last!.at) >= wait ? { do: 'escalate' } : null;
  }
  if (!last) return now.getTime() >= due - DAY_MS ? { do: 'remind', n: 1 } : null;
  if (answered) return !duty.reminders.some((r) => r.n === 3) && now.getTime() >= due ? { do: 'remind', n: 3 } : null;
  if (now.getTime() - Date.parse(last.at) < wait) return null;
  if (last.n === 1) return { do: 'remind', n: 2 };
  return duty.escalatedAt ? null : { do: 'escalate' };
}

const sentToday = (phone: string, now: Date) =>
  state.duties.reduce((n, d) => n + (d.phone === phone ? d.reminders.filter((r) => now.getTime() - Date.parse(r.at) < DAY_MS).length : 0), 0);

/** The "did not answer" alert on the user's WhatsApp. True when it is queued or there is no number to send it to. */
function alertOnWhatsApp(duty: Duty, now: Date): boolean {
  const alert = state.teamSettings.alertPhone;
  if (!alert) return true;
  try {
    queueCommand({ kind: 'reply', phone: alert, toName: 'MAAI', text: `🤖 MAAI\n${escalationText(duty)}`, automatic: true, tag: 'self' }, now.getTime());
    return true;
  } catch (error) {
    console.error('Follow-up alert on WhatsApp failed:', (error as Error).message);
    return false;
  }
}

/** One pass over the open follow-ups. Returns how many messages were sent (reminders and alerts). */
export function teamReminderTick(now = new Date()): number {
  if (!state.teamSettings.enabled) return 0;
  let sent = 0;
  for (const duty of openDuties()) {
    const member = memberOf(duty.phone);
    if (!member) continue;
    if (duty.alertUnsent && alertOnWhatsApp(duty, now)) {
      duty.alertUnsent = false;
      save();
      sent += 1;
    }
    // Their answer is being read this moment: what it says decides what comes next.
    if (beingRead(duty.phone)) continue;
    const action = nextAction(duty, now);
    if (!action) continue;
    if (action.do === 'escalate') {
      // The user is told at any hour (it is for them, not for the team).
      duty.escalatedAt = now.toISOString();
      audit(`${duty.name} did not answer: ${duty.title}`, 'MAAI', 'done');
      void alertFollowup(`followup:${duty.id}:escalated`, escalationText(duty)).catch((e: Error) => console.error('Follow-up alert failed:', e.message));
      // The WhatsApp copy may have to wait for the device bot: it is tried again on later passes until it is queued.
      duty.alertUnsent = !alertOnWhatsApp(duty, now);
      save();
      sent += 1;
      continue;
    }
    if (!mayMessageNow(duty, now) || sentToday(duty.phone, now) >= MAX_PER_PERSON_DAY) continue;
    const text = reminderText(action.n, duty, member);
    try {
      queueCommand({ kind: 'reply', phone: duty.phone, toName: member.name, text, automatic: true, tag: 'team' }, now.getTime());
    } catch (error) {
      // The device bot is not connected right now: the same reminder is tried again at the next pass.
      console.error('Team reminder not sent:', (error as Error).message);
      continue;
    }
    duty.reminders.push({ at: now.toISOString(), n: action.n, text });
    save();
    sent += 1;
  }
  return sent;
}

/** Starts the minute-by-minute pass. */
export function startTeamReminders(everyMs = 60_000): void {
  setTimeout(() => teamReminderTick(), 30_000).unref();
  setInterval(() => teamReminderTick(), everyMs).unref();
}
