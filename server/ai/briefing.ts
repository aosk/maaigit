import type { Briefing, Lang } from '../../shared/types.js';
import { dayPeriod, type DayPeriod } from '../../shared/schedule.js';
import { config } from '../config.js';
import { agentEnabled } from '../store.js';
import { client, create, textOf } from './claude.js';
import { contextNote, refreshContext } from './context.js';
import { demoBriefing } from './demo.js';

/** What each briefing is for: the day ahead, what is left of it, or a wrap-up and tomorrow. */
const FOCUS: Record<DayPeriod, string> = {
  morning: "the user's morning briefing: today's events and reminders, when to leave for anything with travel time",
  noon: "the user's midday briefing: what is left of today (events, reminders) and what is next, and when to leave for anything with travel time",
  night: "the user's evening briefing: a brief wrap-up of what is still open today, then what tomorrow holds (first event, anything due)",
};

/** The two-sentence briefing on Today, for the time of day it is now. */
export async function briefing(lang: Lang, now = new Date()): Promise<Briefing> {
  const period = dayPeriod(now, config.timezone);
  if (!client || !agentEnabled('planner')) return { period, text: demoBriefing(lang, period), source: 'demo' };
  await refreshContext();
  const response = await create({
    system: `You are MAAI. Write ${FOCUS[period]}, in ${lang === 'ar' ? 'Arabic' : 'English'}: two short sentences, spoken style, no lists. Include any Asana tasks that are overdue or due today, and mention WhatsApp messages waiting for an answer only if one looks important. Use only what the context shows; do not invent details.`,
    effort: 'low',
    maxTokens: 2000,
    messages: [{ role: 'user', content: contextNote() }],
  });
  return { period, text: textOf(response.content) || demoBriefing(lang, period), source: 'claude' };
}
