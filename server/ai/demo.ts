import type { Lang, PrayerName, Proposal, Tone } from '../../shared/types.js';
import type { DayPeriod } from '../../shared/schedule.js';
import { allEvents, id, state } from '../store.js';

/** Demo mode: simple canned answers when no API key is set, so every screen still works. */

export function demoBriefing(lang: Lang, period: DayPeriod = 'morning'): string {
  const now = Date.now();
  const sameDay = (iso: string) => new Date(iso).toDateString() === new Date(now).toDateString();
  const today = allEvents().filter((e) => sameDay(e.start));
  // At noon and night only what is still ahead counts.
  const events = (period === 'morning' ? today : today.filter((e) => Date.parse(e.start) + e.minutes * 60_000 > now)).length;
  const reminders = state.reminders.filter((r) => !r.done).length;
  const left = period === 'morning' ? '' : lang === 'ar' ? ' متبقية' : ' left';
  return lang === 'ar'
    ? `لديك ${events.toLocaleString('ar-SA')} مواعيد${left} و${reminders.toLocaleString('ar-SA')} تذكيرات${period === 'morning' ? ' اليوم' : ''}. أضف مفتاح Claude لتحصل على موجز ذكي.`
    : `You have ${events} event${events === 1 ? '' : 's'}${left} and ${reminders} reminder${reminders === 1 ? '' : 's'}${period === 'morning' ? ' today' : ''}. Add a Claude API key for a smart briefing.`;
}

function nextFreeMornings(minutes: number): { start: string; note?: string }[] {
  const events = allEvents();
  const out: { start: string; note?: string }[] = [];
  for (let day = 1; out.length < 3 && day < 14; day++) {
    const d = new Date();
    d.setDate(d.getDate() + day);
    d.setHours(9 + (day % 2), day % 3 === 0 ? 30 : 0, 0, 0);
    const busy = events.some((e) => {
      const s = new Date(e.start).getTime();
      return d.getTime() < s + e.minutes * 60_000 && d.getTime() + minutes * 60_000 > s;
    });
    if (!busy) out.push({ start: d.toISOString(), note: out.length === 0 ? 'Best fit' : undefined });
  }
  return out;
}

const PRAYER_WORDS: [RegExp, PrayerName][] = [[/fajr|الفجر/, 'fajr'], [/dhuhr|الظهر/, 'dhuhr'], [/asr|العصر/, 'asr'], [/maghrib|المغرب/, 'maghrib'], [/isha|العشاء/, 'isha']];

/** Guesses a card from keywords; returns undefined when nothing matches. */
function demoProposal(userText: string, ar: boolean): Proposal | undefined {
  const t = userText.toLowerCase();
  const address = userText.match(/[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}/i)?.[0];
  if (/e-?mail|ايميل|إيميل|بريد/.test(t) && address) {
    const subject = ar ? 'رسالة من مساعد' : 'A note from MAAI';
    return {
      id: id(),
      kind: 'email',
      status: 'pending',
      title: subject,
      to: address,
      subject,
      body: ar ? 'السلام عليكم،\n\n(اكتب رسالتك هنا)\n\nمع التحية' : 'Hello,\n\n(Write your message here)\n\nBest regards',
    };
  }
  if (/meet|book|اجتماع|موعد|احجز/.test(t)) {
    const name = userText.match(/with\s+([A-Z][\w-]+)/)?.[1] ?? userText.match(/مع\s+(\S+)/)?.[1] ?? 'Sara';
    return { id: id(), kind: 'meeting', status: 'pending', title: `Meeting with ${name}`, attendee: name, minutes: 30, options: nextFreeMornings(30) };
  }
  if (/remind|ذكر/.test(t)) {
    const prayer = PRAYER_WORDS.find(([re]) => re.test(t))?.[1];
    return {
      id: id(),
      kind: 'reminder',
      status: 'pending',
      title: userText.replace(/^(please\s+)?remind me (to\s+)?/i, '').replace(/^ذكّ?رني\s*/, ''),
      when: prayer ? (ar ? 'بعد الصلاة بربع ساعة' : '15 min after the prayer') : ar ? 'بعد ساعة' : 'In an hour',
      at: prayer ? undefined : new Date(Date.now() + 3_600_000).toISOString(),
      prayer,
      offsetMinutes: prayer ? 15 : undefined,
      repeat: 'once',
    };
  }
  return undefined;
}

export function demoChat(userText: string, lang: Lang): { text: string; proposals: Proposal[] } {
  const ar = lang === 'ar';
  const proposal = demoProposal(userText, ar);
  if (proposal) {
    return { text: ar ? 'جهزت لك الطلب. اضغط «موافق» لتأكيده. (وضع تجريبي)' : 'Here it is. Tap Approve to confirm it. (Demo mode)', proposals: [proposal] };
  }
  return {
    text: ar
      ? 'أنا في الوضع التجريبي. جرّب: «احجز اجتماع مع سارة» أو «ذكّرني أتصل على أمي». أضف مفتاح Claude لمحادثة كاملة.'
      : 'I\'m in demo mode. Try "Book a meeting with Sara" or "Remind me to call mum". Add a Claude API key for full conversations.',
    proposals: [],
  };
}

export function demoDraft(input: { from: string; tone: Tone }): { draft: string; summary: string } {
  const drafts: Record<Tone, string> = {
    short: `Thanks ${input.from}, I'll get back to you shortly.`,
    friendly: `Hi ${input.from}, thanks for the message! Let me check my day and get back to you soon.`,
    formal: `Dear ${input.from}, thank you for your message. I will review my schedule and confirm shortly.`,
    arabic: `أهلاً ${input.from}، شكراً على رسالتك. بشوف جدولي وأرد عليك قريب.`,
  };
  return { draft: drafts[input.tone], summary: 'Demo mode: add a Claude API key for smart drafts that check your calendar.' };
}
