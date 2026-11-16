import type { Lang } from '../shared/types.js';
import { cachedInbox } from './gmail-inbox.js';
import { state } from './store.js';

/**
 * What the empty chat offers to tap: first what the user really asks for (their own repeated orders), then what
 * today calls for (unanswered messages, open follow-ups, meetings), then the usual examples. No AI call: it is
 * counted from what MAAI already holds, so it is instant and free.
 */

const MAX = 4;
const FROM_HABIT = 2;
const ARABIC = /[؀-ۿ]/;
/** A number long enough to be a phone or an ID: such a message is not offered again as a chip. */
const HAS_NUMBER = /[\d٠-٩]{5,}/;

const EXAMPLES: Record<Lang, string[]> = {
  ar: ['احجز اجتماع مع سارة الأسبوع الجاي، الصباح لو أمكن', 'ذكّرني أتصل على أمي بعد صلاة المغرب', 'كيف جدولي العصر؟'],
  en: ['Book a meeting with Sara next week, mornings if possible', 'Remind me to call my mother after Maghrib', 'What does my afternoon look like?'],
};

const TEXT = {
  whatsapp: { ar: 'وش رسائل الواتساب اللي تحتاج رد؟', en: 'Which WhatsApp messages need an answer?' },
  followups: { ar: 'وش صار على متابعات الفريق؟', en: 'How are my team follow-ups doing?' },
  mail: { ar: 'وش أهم الإيميلات اللي ما قريتها؟', en: 'What are the important emails I have not read?' },
  today: { ar: 'كيف جدولي اليوم؟', en: 'What does my day look like?' },
} satisfies Record<string, Record<Lang, string>>;

/** Two wordings of the same order count as one: spaces, marks and letter forms that vary are evened out. */
const key = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The user's own orders they send again and again (said twice or more), most often first; the newest wording is kept. */
function habits(lang: Lang): string[] {
  const seen = new Map<string, { text: string; count: number; last: number }>();
  let order = 0;
  // Oldest conversation first, so "last" grows with time.
  for (const conversation of [...state.conversations].reverse()) {
    for (const turn of conversation.turns) {
      order += 1;
      if (turn.role !== 'user' || turn.attachments?.length) continue;
      const text = turn.text.replace(/\s+/g, ' ').trim();
      if (text.length < 8 || text.length > 70 || HAS_NUMBER.test(text) || ARABIC.test(text) !== (lang === 'ar')) continue;
      const k = key(text);
      if (!k) continue;
      const had = seen.get(k);
      seen.set(k, { text, count: (had?.count ?? 0) + 1, last: order });
    }
  }
  return [...seen.values()]
    .filter((h) => h.count >= 2)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, FROM_HABIT)
    .map((h) => h.text);
}

/** What today calls for, from what MAAI already holds. */
function situation(lang: Lang, now: Date): string[] {
  const out: string[] = [];
  const day = 86_400_000;
  if (state.inbox.some((m) => m.channel === 'whatsapp' && !m.replied && !m.group && now.getTime() - Date.parse(m.receivedAt) < 2 * day)) out.push(TEXT.whatsapp[lang]);
  if (state.duties.some((d) => d.status === 'open' || d.status === 'acknowledged' || d.status === 'blocked')) out.push(TEXT.followups[lang]);
  if (cachedInbox().some((m) => m.unread)) out.push(TEXT.mail[lang]);
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  if (state.events.some((e) => !e.demo && new Date(e.start).toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }) === today && Date.parse(e.start) > now.getTime())) out.push(TEXT.today[lang]);
  return out;
}

export function chatSuggestions(lang: Lang, now = new Date()): string[] {
  const out: string[] = [];
  const taken = new Set<string>();
  for (const text of [...habits(lang), ...situation(lang, now), ...EXAMPLES[lang]]) {
    const k = key(text);
    if (taken.has(k)) continue;
    taken.add(k);
    out.push(text);
    if (out.length >= MAX) break;
  }
  return out;
}
