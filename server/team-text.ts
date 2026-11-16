import type { Duty, TeamMember } from '../shared/types.js';

/**
 * What MAAI says to the people in the user's teams: fixed texts, Arabic first (English for anyone who writes in it),
 * with the title the user gave. No model writes to them, so nothing a stranger types can become a message to a team.
 */

const isEnglish = (lang: string): boolean => !/^ar/i.test(lang);

const TAG = { ar: '🤖 تذكير آلي من مساعد عبدالرحمن', en: "🤖 Automated reminder from Abdulrahman's assistant" };

/** A due time the way a person says it: weekday, date and time in Riyadh (digits stay Latin so they read the same everywhere). */
export function dueText(iso: string, lang: string): string {
  const at = new Date(iso);
  const locale = isEnglish(lang) ? 'en-GB' : 'ar-SA-u-nu-latn-ca-gregory';
  const day = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh' }).format(at);
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Riyadh' }).format(at);
  return `${day} ${isEnglish(lang) ? 'at' : 'الساعة'} ${time}`;
}

/** The nth reminder: 1 the first, 2 the second, 3 when it falls due. */
export function reminderText(n: 1 | 2 | 3, duty: Duty, member: Pick<TeamMember, 'name' | 'lang'>): string {
  const en = isEnglish(member.lang);
  const when = dueText(duty.due, member.lang);
  const body = en
    ? n === 1
      ? `Peace be upon you ${member.name},\nReminder: ${duty.title}\nDue: ${when}\nReply "done" when it is finished, or tell me if something is in the way.`
      : n === 2
        ? `${member.name}, a second reminder: ${duty.title} (due ${when}). Done?`
        : `${member.name}, it is due now: ${duty.title}. Done? Or tell me if it will be late.`
    : n === 1
      ? `السلام عليكم ${member.name}،\nتذكير: ${duty.title}\nالموعد: ${when}\nأكّد لي بكلمة «تم» لما تنجزه، أو اكتب لي لو عندك عائق.`
      : n === 2
        ? `${member.name}، تذكير ثاني: ${duty.title} (الموعد ${when}). تم؟`
        : `${member.name}، حان موعد: ${duty.title}. تم؟ أو اكتب لي لو بيتأخر.`;
  return `${body}\n\n${en ? TAG.en : TAG.ar}`;
}

/** What they are told after they answer. */
export function ackText(kind: 'done' | 'ack' | 'moved' | 'passed' | 'received', duty: Duty, member: Pick<TeamMember, 'name' | 'lang'>): string {
  const en = isEnglish(member.lang);
  const tag = en ? TAG.en : TAG.ar;
  const text =
    kind === 'done'
      ? en ? `Recorded, thank you ${member.name} 🙏` : `تم تسجيله، شكراً ${member.name} 🙏`
      : kind === 'ack'
        ? en ? 'Noted 👍' : 'تمام 👍'
        : kind === 'moved'
          ? en ? `Noted, the new date is ${dueText(duty.due, member.lang)}.` : `تمام، سجلت الموعد الجديد: ${dueText(duty.due, member.lang)}.`
          : kind === 'passed'
            ? en ? 'Got it, I will tell Abdulrahman and come back to you.' : 'وصلني، أبلّغ عبدالرحمن وأرد عليك.'
            : en ? 'Your message reached Abdulrahman.' : 'وصلت رسالتك لعبدالرحمن.';
  return `${text}\n\n${tag}`;
}

/** What the user is told when someone does not answer. */
export function escalationText(duty: Duty, lang: 'ar' | 'en' = 'ar'): string {
  return lang === 'en'
    ? `⏰ ${duty.name} has not answered two reminders: ${duty.title} (due ${dueText(duty.due, 'en')}). Tell me what to do.`
    : `⏰ ${duty.name} ما رد على تذكيرين: ${duty.title} (الموعد ${dueText(duty.due, 'ar')}). تبي أتصرف؟`;
}
