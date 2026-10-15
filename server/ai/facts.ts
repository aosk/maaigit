import type { BriefingFacts, Lang, MailInsight } from '../../shared/types.js';
import { eventEnd, leaveTime } from '../../shared/schedule.js';
import { asanaConfigured, cachedTasks, todayIso } from '../asana.js';
import { cachedInbox } from '../gmail-inbox.js';
import { handledOf } from '../mail-handled.js';
import { allEvents, state } from '../store.js';
import { dayKey } from '../usage.js';

/**
 * The counts and the next event for the briefing card. Everything here is already in memory, so it is
 * free: no Claude call. (The emails to decide or answer come from Claude's saved sort of the inbox,
 * when there is one, minus the ones already dealt with.)
 */
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
  return {
    next: next && { id: next.id, title: next.title, start: next.start, place: next.place, leaveAt: leave?.toISOString() },
    events: { left: todays.filter((e) => eventEnd(e) > now.getTime()).length, total: todays.length },
    tasks: { overdue: tasks.filter((t) => t.dueOn && t.dueOn < todayDue).length, dueToday: tasks.filter((t) => t.dueOn === todayDue).length },
    reminders: { open: state.reminders.filter((r) => !r.done).length },
    email: {
      unread: inbox.filter((m) => m.unread && waitingForYou.has(m.uid)).length,
      toDecide: sorted.filter((i) => i.category === 'decide').length,
      toReply: sorted.filter((i) => i.category === 'reply').length,
    },
    whatsapp: { waiting: wa.size },
  };
}
