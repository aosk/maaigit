import type { Duty, Team, TeamMember } from '../shared/types';

/** The rules and wording behind the teams screens, kept free of React so they can be tested. */

const RIYADH = 'Asia/Riyadh';
const OPEN = new Set<Duty['status']>(['open', 'acknowledged', 'blocked']);

/** People under each team they follow (a person in two teams shows in both), in the order of the teams. */
export function groupByTeam(teams: Team[], members: TeamMember[]): { team: Team; members: TeamMember[] }[] {
  return teams.map((team) => ({ team, members: members.filter((m) => m.teamIds.includes(team.id)).sort((a, b) => a.name.localeCompare(b.name)) }));
}

/** Open follow-ups (soonest first) and finished ones (latest first). */
export function splitDuties(duties: Duty[]): { open: Duty[]; finished: Duty[] } {
  const open = duties.filter((d) => OPEN.has(d.status)).sort((a, b) => a.due.localeCompare(b.due));
  const finished = duties.filter((d) => !OPEN.has(d.status)).sort((a, b) => (b.closedAt ?? b.due).localeCompare(a.closedAt ?? a.due));
  return { open, finished };
}

/** Riyadh calendar day of a moment, as YYYY-MM-DD. */
const riyadhDay = (at: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: RIYADH, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** "Today 18:30", "Tomorrow 09:00" or "Sat, 21 Nov, 18:30", always in Riyadh time. */
export function dueText(iso: string, lang: 'ar' | 'en', words: { today: string; tomorrow: string }, now = new Date()): string {
  const at = new Date(iso);
  const locale = lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-arab' : 'en-GB';
  const hm = new Intl.DateTimeFormat(locale, { timeZone: RIYADH, hour: 'numeric', minute: '2-digit', hour12: false }).format(at);
  const day = riyadhDay(at);
  if (day === riyadhDay(now)) return `${words.today} ${hm}`;
  if (day === riyadhDay(new Date(now.getTime() + 86_400_000))) return `${words.tomorrow} ${hm}`;
  return new Intl.DateTimeFormat(locale, { timeZone: RIYADH, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: false }).format(at);
}

/** What a datetime-local box holds ("2026-11-20T18:00", Riyadh time) as the ISO moment the server takes; '' when empty or wrong. */
export function dueFromInput(value: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(value.trim());
  if (!m) return '';
  const at = Date.parse(`${m[1]}T${m[2] ?? '23:59'}:00+03:00`);
  return Number.isFinite(at) ? new Date(at).toISOString() : '';
}

/** The datetime-local value (Riyadh time) of a moment, to start the date box from. */
export function inputFromDue(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: RIYADH, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** Turns one day off or on in a team's list of days off. */
export const toggleDay = (offDays: number[], day: number): number[] => (offDays.includes(day) ? offDays.filter((d) => d !== day) : [...offDays, day].sort());

/** Digits of what the owner typed; the server accepts 8 to 15 (a local 05… number is made international there). */
export const phoneOk = (raw: string): boolean => {
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
};

/** A language other than Arabic or English: 2 to 8 letters. */
export const langOk = (raw: string): boolean => /^\p{L}{2,8}$/u.test(raw.trim());

/** Sending hours: whole numbers 0 to 23 with the start before the end. */
export const hoursOk = (from: number, to: number): boolean => Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to <= 23 && from < to;

/** +digits for showing a number. */
export const plusDigits = (phone: string): string => `+${phone.replace(/\D/g, '')}`;

/** The language box value as the server wants it: 'ar', 'en', or the free text. */
export const memberLang = (choice: 'ar' | 'en' | 'other', other: string): string => (choice === 'other' ? other.trim().toLowerCase() : choice);

/** The choice that shows a saved language. */
export const langChoice = (lang: string): 'ar' | 'en' | 'other' => (lang === 'ar' || lang === 'en' ? lang : 'other');
