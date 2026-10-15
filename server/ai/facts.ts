import type { BriefingFacts, Lang, MailInsight } from '../../shared/types.js';
import { eventEnd, leaveTime } from '../../shared/schedule.js';
import { asanaConfigured, cachedTasks, todayIso } from '../asana.js';
import { cachedInbox } from '../gmail-inbox.js';
import { handledOf } from '../mail-handled.js';
import { allEvents, save, state } from '../store.js';
import { dayKey } from '../usage.js';
import { computeStress, weekOf } from '../stress.js';
import type { MailItem } from '../../shared/types.js';

/**
 * The counts and the next event for the briefing card. Everything here is already in memory, so it is
 * free: no Claude call. (The emails to decide or answer come from Claude's saved sort of the inbox,
 * when there is one, minus the ones already dealt with.)
 */
const MIN = 60_000;

/** Meetings still ahead today: how many run back to back (less than 15 minutes between), and the hours left in them. */
function scheduleLoad(todays: { start: string; minutes: number }[], now: number) {
  const ahead = todays.filter((e) => Date.parse(e.start) + e.minutes * MIN > now).sort((a, b) => a.start.localeCompare(b.start));
  let backToBack = 0;
  for (let i = 1; i < ahead.length; i++) {
    const gap = Date.parse(ahead[i].start) - (Date.parse(ahead[i - 1].start) + ahead[i - 1].minutes * MIN);
    if (gap < 15 * MIN) backToBack++;
  }
  const minutes = ahead.reduce((a, e) => a + Math.max(0, Date.parse(e.start) + e.minutes * MIN - Math.max(now, Date.parse(e.start))), 0);
  return { left: ahead.length, backToBack, hoursLeft: minutes / 60 / MIN };
}

/** The day before `key` (a YYYY-MM-DD), `back` days earlier. */
const dayBefore = (key: string, back: number) => new Date(Date.parse(`${key}T12:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);

export function briefingFacts(lang: Lang, now = new Date()): BriefingFacts {
  const today = dayKey(now);
  const events = allEvents().filter((e) => !e.allDay);
  const todays = events.filter((e) => dayKey(new Date(e.start)) === today);
  const next = events.find((e) => Date.parse(e.start) > now.getTime());

  const tasks = asanaConfigured ? cachedTasks() : [];
  const todayDue = todayIso();

  const inbox = cachedInbox();
  const waitingForYou = new Set(inbox.filter((m) => !handledOf(m.uid)).map((m) => m.uid));
  const saved = state.aiCache[`mail-digest:${lang}`]?.value as { items?: MailInsight[] } | undefined;
  const sorted = (saved?.items ?? []).filter((i) => waitingForYou.has(i.uid));

  const wa = new Set<string>();
  for (const m of state.inbox) if (m.channel === 'whatsapp' && !m.replied) wa.add(m.phone ?? m.from);

  const leave = next ? leaveTime(next) : null;

  // How loaded the day is. Importance comes from Claude's saved sorts (email, WhatsApp) when there are any.
  const waitingPhones = new Set<string>(wa);
  const waSaved = state.aiCache[`whatsapp-digest:${lang}`]?.value as { items?: { key: string; priority: string }[] } | undefined;
  const waImportant = (waSaved?.items ?? []).filter((i) => i.priority === 'high' && waitingPhones.has(i.key)).length;
  const myReminders = state.reminders.filter((r) => !r.done && r.at);
  const dueToday = myReminders.filter((r) => dayKey(new Date(r.at!)) === today);
  const nextToday = next && dayKey(new Date(next.start)) === today ? next : undefined;
  const minutesToNext = nextToday ? Math.round(((leave ?? new Date(nextToday.start)).getTime() - now.getTime()) / MIN) : undefined;
  const email = {
    unread: inbox.filter((m: MailItem) => m.unread && waitingForYou.has(m.uid)).length,
    toDecide: sorted.filter((i) => i.category === 'decide').length,
    toReply: sorted.filter((i) => i.category === 'reply').length,
  };
  const overdue = tasks.filter((t) => t.dueOn && t.dueOn < todayDue).length;
  const dueTodayTasks = tasks.filter((t) => t.dueOn === todayDue).length;
  const stress = computeStress({
    events: scheduleLoad(todays, now.getTime()),
    tasks: { overdue, dueToday: dueTodayTasks },
    email: { toDecide: email.toDecide, toReply: email.toReply, important: sorted.filter((i) => i.priority === 'high').length, unreadUnsorted: saved ? 0 : email.unread },
    whatsapp: { waiting: wa.size, important: waImportant },
    reminders: { dueToday: dueToday.length, late: dueToday.filter((r) => Date.parse(r.at!) < now.getTime()).length },
    minutesToNext,
  });
  // The day's highest score is kept, so the week shows how loaded each day got.
  if (stress.score > (state.stressDays[today] ?? 0)) {
    state.stressDays[today] = stress.score;
    for (const key of Object.keys(state.stressDays).sort().slice(0, -30)) delete state.stressDays[key];
    save();
  }

  return {
    next: next && { id: next.id, title: next.title, start: next.start, place: next.place, leaveAt: leave?.toISOString() },
    events: { left: todays.filter((e) => eventEnd(e) > now.getTime()).length, total: todays.length },
    tasks: { overdue, dueToday: dueTodayTasks },
    reminders: { open: state.reminders.filter((r) => !r.done).length },
    email,
    whatsapp: { waiting: wa.size },
    stress: { ...stress, week: weekOf(state.stressDays, today, dayBefore) },
  };
}
