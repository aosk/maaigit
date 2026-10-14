import type { MailItem } from '../../shared/types.js';
import { PRAYER_BUFFER_MINUTES, prayersFor } from '../../shared/prayer.js';
import { config } from '../config.js';
import { allEvents, state } from '../store.js';
import { cachedInbox, inboxConfigured } from '../gmail-inbox.js';
import { asanaConfigured, cachedProjects, cachedTasks, openTasks, projects, todayIso } from '../asana.js';

/** What Claude is told about the user's day and inbox, rebuilt for every request. */

const fmt = (iso: string | Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, ...opts }).format(new Date(iso));

export const dayTime = (iso: string | Date) =>
  fmt(iso, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Email as Claude sees it: clearly marked as someone else's words, never instructions. */
export function emailForClaude(m: MailItem): string {
  return `Email #${m.uid} from ${m.fromName} <${m.fromAddress}>, ${dayTime(m.date)}, subject "${m.subject}".\n<email_content>\n${m.body}\n</email_content>`;
}

function inboxOverview(): string {
  const mails = cachedInbox().slice(0, 25);
  if (!mails.length) return inboxConfigured ? 'Gmail inbox: connected (not loaded yet; use read_email with a number the user mentions).' : 'Gmail inbox: not connected.';
  return `Recent Gmail inbox (use read_email to open one):\n${mails.map((m) => `- #${m.uid} ${dayTime(m.date)} from ${m.fromName}: ${m.subject}${m.unread ? ' (unread)' : ''}`).join('\n')}`;
}

function upcomingEvents(now: Date): string[] {
  return allEvents()
    .filter((e) => new Date(e.start).getTime() + e.minutes * 60_000 > now.getTime())
    .slice(0, 25)
    .map((e) => {
      const when = e.allDay ? `${fmt(e.start, { weekday: 'short', day: 'numeric', month: 'short' })} (all day)` : `${dayTime(e.start)} (${e.minutes} min)`;
      return `- ${when}: ${e.title}${e.place ? ` @ ${e.place}` : ''}${e.source === 'google' ? ' [Google Calendar]' : ''}`;
    });
}

function prayerTimes(now: Date, days: number): string[] {
  return Array.from({ length: days }, (_, offset) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return prayersFor(d, config.latitude, config.longitude).map((p) => `${p.name} ${dayTime(p.time)}`);
  }).flat();
}

function asanaOverview(): string {
  if (!asanaConfigured) return 'Asana: not connected.';
  const tasks = cachedTasks().slice(0, 25);
  const names = cachedProjects().map((p) => p.name).join(', ');
  const where = names ? `\nAsana projects (for propose_asana_task): ${names}` : '';
  if (!tasks.length) return `Asana: connected, no open tasks assigned to the user.${where}`;
  const today = todayIso();
  const flag = (due?: string) => (!due ? 'no date' : due < today ? `due ${due}, OVERDUE` : due === today ? 'due TODAY' : `due ${due}`);
  return `Asana tasks assigned to the user (use read_asana_task to open one, propose_asana_update to comment/complete/reschedule, propose_asana_task to create a new one):\n${tasks.map((t) => `- [${t.gid}] ${t.name}${t.project ? ` (${t.project})` : ''}: ${flag(t.dueOn)}`).join('\n')}${where}`;
}

export function contextNote(): string {
  const now = new Date();
  const reminders = state.reminders.filter((r) => !r.done).map((r) => `- ${r.title} (${r.when})`);
  return [
    `Current time: ${dayTime(now)} (${config.timezone}). ISO now: ${now.toISOString()}.`,
    `Upcoming calendar:\n${upcomingEvents(now).join('\n') || '- nothing booked'}`,
    `Prayer times, next 3 days (keep ${PRAYER_BUFFER_MINUTES} minutes after each free): ${prayerTimes(now, 3).join('; ')}`,
    `Open reminders:\n${reminders.join('\n') || '- none'}`,
    inboxOverview(),
    asanaOverview(),
  ].join('\n\n');
}

/** Loads what the context needs that is not already in memory (Asana), best effort. */
export async function refreshContext(): Promise<void> {
  await Promise.all([openTasks().catch(() => {}), projects().catch(() => {})]);
}

/** The context block that starts every user message to Claude. */
export const withContext = (text: string) => `<context>\n${contextNote()}\n</context>\n\n${text}`;
