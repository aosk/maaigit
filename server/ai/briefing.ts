import type { Briefing, Lang } from '../../shared/types.js';
import { agentEnabled } from '../store.js';
import { client, create, textOf } from './claude.js';
import { contextNote } from './context.js';
import { demoBriefing } from './demo.js';

/** The two-sentence morning briefing on Today. */
export async function briefing(lang: Lang): Promise<Briefing> {
  if (!client || !agentEnabled('planner')) return { text: demoBriefing(lang), source: 'demo' };
  const response = await create({
    system: `You are MAAI. Write the user's morning briefing for today in ${lang === 'ar' ? 'Arabic' : 'English'}: two short sentences, spoken style, no lists. Mention how many events and reminders today, and when to leave for anything with travel time. Do not invent details.`,
    effort: 'low',
    maxTokens: 2000,
    messages: [{ role: 'user', content: contextNote() }],
  });
  return { text: textOf(response.content) || demoBriefing(lang), source: 'claude' };
}
