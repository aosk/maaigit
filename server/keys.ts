import type { ApiKeyEntry, ApiKeyView, HealthCheck, KeyService, MailItem } from '../shared/types.js';
import { config } from './config.js';
import { cachedInbox } from './gmail-inbox.js';
import { alertKey } from './notify.js';
import { id, save, state } from './store.js';

/**
 * Reminders to renew API keys and app passwords before they expire. MAAI never stores a key itself: only its name,
 * which service it belongs to, where it is used (the environment variable) and the day it expires.
 *
 * Entries come from three places:
 * - the keys MAAI itself is set up with (read from the environment: their names only), listed so a date can be added;
 * - the user, in Admin → Keys & audit;
 * - expiry notices in the user's Gmail inbox (Anthropic's "API key expiring soon", and similar notices from the
 *   services MAAI knows), picked up by themselves. A notice only adds a reminder: it can never change anything else.
 *
 * The phone is alerted 14, 7, 3 and 1 days before, on the day, and once after it has expired; the health check turns
 * amber within 14 days and red within 3.
 */

const DAY = 86_400_000;
/** Days before the expiry when the phone is told. */
const ALERT_DAYS = [14, 7, 3, 1, 0] as const;

const SERVICES: Record<KeyService, { name: string; renewUrl?: string; senders: string[] }> = {
  anthropic: { name: 'Anthropic (Claude)', renewUrl: 'https://platform.claude.com/settings/keys', senders: ['anthropic.com'] },
  xai: { name: 'xAI (Grok)', renewUrl: 'https://console.x.ai', senders: ['x.ai'] },
  render: { name: 'Render', renewUrl: 'https://dashboard.render.com/u/settings#api-keys', senders: ['render.com'] },
  openai: { name: 'OpenAI', renewUrl: 'https://platform.openai.com/api-keys', senders: ['openai.com'] },
  groq: { name: 'Groq', renewUrl: 'https://console.groq.com/keys', senders: ['groq.com'] },
  google: { name: 'Google', renewUrl: 'https://myaccount.google.com/apppasswords', senders: ['google.com', 'accounts.google.com'] },
  asana: { name: 'Asana', renewUrl: 'https://app.asana.com/0/my-apps', senders: ['asana.com'] },
  twilio: { name: 'Twilio', renewUrl: 'https://console.twilio.com', senders: ['twilio.com'] },
  github: { name: 'GitHub', renewUrl: 'https://github.com/settings/tokens', senders: ['github.com'] },
  other: { name: 'Other', senders: [] },
};

/** The keys MAAI reads from its environment, by variable: which service, and what it does. */
const ENV_KEYS: { env: string; service: KeyService; name: string }[] = [
  { env: 'ANTHROPIC_API_KEY', service: 'anthropic', name: 'MAAI’s Claude key' },
  { env: 'ANTHROPIC_ADMIN_KEY', service: 'anthropic', name: 'Anthropic admin key (usage and cost)' },
  { env: 'RENDER_API_KEY', service: 'render', name: 'Render API key (usage and cost)' },
  { env: 'STT_API_KEY', service: 'openai', name: 'Smart voice (speech to text)' },
  { env: 'OPENAI_API_KEY', service: 'openai', name: 'OpenAI key' },
  { env: 'ASANA_TOKEN', service: 'asana', name: 'Asana token' },
  { env: 'GMAIL_APP_PASSWORD', service: 'google', name: 'Gmail app password' },
  { env: 'TWILIO_AUTH_TOKEN', service: 'twilio', name: 'Twilio auth token' },
];

const keys = () => (state.keys ??= []);

/** A string that looks like a secret itself (a key pasted by mistake), never kept. */
export const looksSecret = (s: string) => /\b(sk-ant-|sk-|xai-|rnd_|ghp_|github_pat_|gsk_|AKIA)[A-Za-z0-9_-]{8,}/.test(s) || /[A-Za-z0-9_+/=-]{40,}/.test(s);

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** Whole days from today (in the app's time zone) to `day`: 0 on the day, negative once past. */
function daysLeft(day: string, now = new Date()): number {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

/** Green, amber or red for a key's date: within 14 days amber, within 3 (or past) red. */
const keyLevel = (left: number | undefined): ApiKeyView['level'] => (left === undefined ? 'none' : left <= 3 ? 'high' : left <= 14 ? 'medium' : 'low');

/** Every key, the stored ones with the ones MAAI is set up with that have no entry yet, soonest expiry first. */
export function keysView(now = new Date()): ApiKeyView[] {
  const stored = keys().map((k): ApiKeyView => {
    const left = k.expiresOn ? daysLeft(k.expiresOn, now) : undefined;
    return { ...k, daysLeft: left, level: keyLevel(left), inUse: Boolean(k.envVar && process.env[k.envVar]), renewUrl: SERVICES[k.service]?.renewUrl };
  });
  const placeholders = ENV_KEYS.filter((e) => process.env[e.env]?.trim() && !keys().some((k) => k.envVar === e.env)).map(
    (e): ApiKeyView => ({ id: `env:${e.env}`, name: e.name, service: e.service, envVar: e.env, source: 'detected', addedAt: '', level: 'none', inUse: true, renewUrl: SERVICES[e.service].renewUrl }),
  );
  return [...stored, ...placeholders].sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || a.name.localeCompare(b.name));
}

export class KeyInputError extends Error {}

function clean(input: Partial<ApiKeyEntry>): Partial<ApiKeyEntry> {
  const out: Partial<ApiKeyEntry> = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim().slice(0, 80);
    if (!name) throw new KeyInputError('Give the key a name.');
    if (looksSecret(name)) throw new KeyInputError('That looks like the key itself. Only its name is kept here, never the key.');
    out.name = name;
  }
  if (input.service !== undefined) {
    if (!(input.service in SERVICES)) throw new KeyInputError('Unknown service.');
    out.service = input.service;
  }
  if (input.expiresOn !== undefined) {
    if (input.expiresOn !== '' && !isDay(input.expiresOn)) throw new KeyInputError('The expiry date should be a day, like 2026-11-12.');
    out.expiresOn = input.expiresOn || undefined;
  }
  if (input.envVar !== undefined) {
    const env = String(input.envVar).trim();
    if (env && !/^[A-Z][A-Z0-9_]{1,60}$/.test(env)) throw new KeyInputError('The environment variable is a name like ANTHROPIC_API_KEY.');
    out.envVar = env || undefined;
  }
  if (input.note !== undefined) {
    const note = String(input.note).trim().slice(0, 200);
    if (looksSecret(note)) throw new KeyInputError('That note looks like it holds a key. Keep keys on Render, not here.');
    out.note = note || undefined;
  }
  return out;
}

export function addKey(input: Partial<ApiKeyEntry>, now = new Date()): ApiKeyView {
  const fields = clean({ service: 'other', ...input });
  if (!fields.name) throw new KeyInputError('Give the key a name.');
  const entry: ApiKeyEntry = { id: id(), name: fields.name, service: fields.service ?? 'other', envVar: fields.envVar, expiresOn: fields.expiresOn, note: fields.note, source: 'user', addedAt: now.toISOString() };
  keys().push(entry);
  save();
  return keysView(now).find((k) => k.id === entry.id)!;
}

/** Changes a key; for one only detected from the environment, this is when it gets its own entry. */
export function updateKey(keyId: string, input: Partial<ApiKeyEntry> & { renewed?: boolean }, now = new Date()): ApiKeyView {
  let entry = keys().find((k) => k.id === keyId);
  if (!entry && keyId.startsWith('env:')) {
    const known = ENV_KEYS.find((e) => `env:${e.env}` === keyId);
    if (!known) throw new KeyInputError('No such key.');
    entry = { id: id(), name: known.name, service: known.service, envVar: known.env, source: 'detected', addedAt: now.toISOString() };
    keys().push(entry);
  }
  if (!entry) throw new KeyInputError('No such key.');
  Object.assign(entry, clean(input));
  if (input.renewed) entry.renewedAt = now.toISOString();
  save();
  return keysView(now).find((k) => k.id === entry.id)!;
}

export function removeKey(keyId: string): void {
  const list = keys();
  const at = list.findIndex((k) => k.id === keyId);
  if (at < 0) throw new KeyInputError('No such key.');
  list.splice(at, 1);
  save();
}

// ---------- Expiry notices in the inbox ----------

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "November 12, 2026", "12 November 2026" or "2026-11-12" as YYYY-MM-DD. */
function parseDay(text: string): string | undefined {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const mdy = /\b([A-Z][a-z]+)\s+(\d{1,2}),?\s+(20\d{2})\b/.exec(text);
  const dmy = /\b(\d{1,2})\s+([A-Z][a-z]+)\s+(20\d{2})\b/.exec(text);
  const [month, day, year] = mdy ? [mdy[1], mdy[2], mdy[3]] : dmy ? [dmy[2], dmy[1], dmy[3]] : [];
  const m = month ? MONTHS.indexOf(month.toLowerCase()) : -1;
  if (m < 0 || !day || !year) return undefined;
  return `${year}-${String(m + 1).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
}

/** The service an email comes from, by the sender's own domain (a display name can say anything). */
function serviceOf(address: string): KeyService | undefined {
  const domain = address.toLowerCase().split('@')[1] ?? '';
  return (Object.keys(SERVICES) as KeyService[]).find((s) => SERVICES[s].senders.some((d) => domain === d || domain.endsWith(`.${d}`)));
}

/** What an expiry notice says: which key and when, or nothing when it is not one (or not from the service itself). */
export function readExpiryNotice(mail: Pick<MailItem, 'fromAddress' | 'subject' | 'body'>): { service: KeyService; name: string; expiresOn: string } | undefined {
  const service = serviceOf(mail.fromAddress);
  if (!service) return undefined;
  const text = `${mail.subject}\n${mail.body}`.replace(/\s+/g, ' ');
  if (!/\b(api key|key|token|password|credential)s?\b[^.]{0,80}\bexpir/i.test(text) && !/\bexpir\w*\b[^.]{0,60}\b(api key|key|token)\b/i.test(text)) return undefined;
  const at = /\bexpire[sd]?\b[^.]{0,40}?\bon\s+([^.()]{6,30})/i.exec(text);
  const expiresOn = parseDay(at?.[1] ?? '') ?? parseDay(text);
  if (!expiresOn) return undefined;
  // Anthropic writes: The API key <name> (apikey_…) in your organization …
  const named = /\b(?:API key|key|token)\s+["“]?([\w.-]{2,60})["”]?\s*\((?:apikey_|id:? )/i.exec(text) ?? /\b(?:API key|token)\s+["“]([^"”]{2,60})["”]/i.exec(text);
  const name = (named?.[1] ?? mail.subject).trim().slice(0, 80);
  if (looksSecret(name)) return undefined;
  return { service, name, expiresOn };
}

/** Adds (or moves the date of) a reminder for each expiry notice in the inbox. Returns how many changed. */
export function noteExpiryNotices(mails: MailItem[], now = new Date()): number {
  let changed = 0;
  for (const mail of mails) {
    const found = readExpiryNotice(mail);
    if (!found) continue;
    const same = keys().find((k) => k.service === found.service && k.name.toLowerCase() === found.name.toLowerCase());
    if (same) {
      // Each notice counts once (a date the user changed afterwards stays), and an older notice never undoes a
      // renewal the user recorded with a later date.
      if (same.emailUid === mail.uid || same.expiresOn === found.expiresOn) continue;
      if (same.renewedAt && same.expiresOn && same.expiresOn > found.expiresOn) continue;
      same.expiresOn = found.expiresOn;
      same.emailUid = mail.uid;
    } else {
      keys().push({ id: id(), name: found.name, service: found.service, expiresOn: found.expiresOn, source: 'email', emailUid: mail.uid, addedAt: now.toISOString(), note: `From the email “${mail.subject.slice(0, 80)}”` });
    }
    changed++;
  }
  if (changed) save();
  return changed;
}

// ---------- Reminders and the health check ----------

/** The reminders due now: one per key and step (14, 7, 3, 1 days, the day, and once after), each sent once. */
export function dueKeyAlerts(now = new Date()): { key: string; entry: ApiKeyView }[] {
  const out: { key: string; entry: ApiKeyView }[] = [];
  for (const k of keysView(now)) {
    if (!k.expiresOn || k.daysLeft === undefined) continue;
    const step = k.daysLeft < 0 ? 'expired' : ALERT_DAYS.find((d, i) => k.daysLeft! <= d && (i === ALERT_DAYS.length - 1 || k.daysLeft! > ALERT_DAYS[i + 1]));
    if (step === undefined) continue;
    // Expired more than a week ago: told already, no more.
    if (k.daysLeft < -7) continue;
    out.push({ key: `apikey:${k.id}:${k.expiresOn}:${step}`, entry: k });
  }
  return out.filter((d) => !state.sentAlerts.includes(d.key));
}

export function keysCheck(now = new Date()): HealthCheck {
  const list = keysView(now);
  const dated = list.filter((k) => k.expiresOn);
  const soon = dated.filter((k) => k.daysLeft! <= 14);
  const name = 'API keys';
  if (!list.length) return { id: 'keys', name, status: 'off', detail: 'No keys listed.', fix: 'Add your keys and their expiry dates in Admin → Keys & audit.' };
  if (!soon.length) {
    const next = dated[0];
    return { id: 'keys', name, status: 'ok', detail: next ? `Next to expire: ${next.name} in ${next.daysLeft} days (${next.expiresOn}).${list.length > dated.length ? ` ${list.length - dated.length} without a date.` : ''}` : `${list.length} key(s), none with an expiry date yet.` };
  }
  const worst = soon[0];
  const when = (k: ApiKeyView) => (k.daysLeft! < 0 ? `${k.name} EXPIRED ${-k.daysLeft!} day(s) ago` : k.daysLeft === 0 ? `${k.name} expires TODAY` : `${k.name} expires in ${k.daysLeft} day(s)`);
  return {
    id: 'keys',
    name,
    status: worst.daysLeft! <= 3 ? 'fail' : 'warn',
    detail: `${soon.map(when).join('; ')}.`,
    fix: `Make a new key${worst.renewUrl ? ` (${SERVICES[worst.service].name})` : ''}, put it where the old one is used${worst.envVar ? ` (${worst.envVar} on Render)` : ''}, then mark it renewed with its new date in Admin → Keys & audit.`,
  };
}

/** For the assistant: keys expiring within 30 days (names and dates only). */
export function keysNote(now = new Date()): string {
  const soon = keysView(now).filter((k) => k.daysLeft !== undefined && k.daysLeft <= 30);
  if (!soon.length) return '';
  return `API keys to renew soon (names only; the user renews them in the service's console, then in Admin → Keys & audit): ${soon.map((k) => `${k.name} (${SERVICES[k.service].name}${k.envVar ? `, ${k.envVar}` : ''}) ${k.daysLeft! < 0 ? `EXPIRED on ${k.expiresOn}` : `expires ${k.expiresOn}, in ${k.daysLeft} day(s)`}`).join('; ')}.`;
}

/** Reads new expiry notices from the inbox and sends the reminders that are due. */
async function watchKeys(now = new Date()): Promise<void> {
  noteExpiryNotices(cachedInbox(), now);
  for (const { key, entry } of dueKeyAlerts(now)) {
    state.sentAlerts.push(key);
    const left = entry.daysLeft!;
    const where = entry.envVar ? ` (${entry.envVar})` : '';
    await alertKey(key, (lang) =>
      lang === 'ar'
        ? { title: left < 0 ? `انتهى مفتاح ${entry.name}` : left === 0 ? `مفتاح ${entry.name} ينتهي اليوم` : `مفتاح ${entry.name} ينتهي بعد ${left} يوم`, body: `${SERVICES[entry.service].name}${where}: سوّ مفتاح جديد وحطّه مكانه، ثم سجّل التجديد في الإدارة ← المفاتيح.` }
        : { title: left < 0 ? `${entry.name} has expired` : left === 0 ? `${entry.name} expires today` : `${entry.name} expires in ${left} day${left === 1 ? '' : 's'}`, body: `${SERVICES[entry.service].name}${where}: make a new key, put it in place, then mark it renewed in Admin → Keys.` },
    ).catch(() => {});
  }
  if (state.sentAlerts.length > 500) state.sentAlerts = state.sentAlerts.slice(-300);
  save();
}

/** Looks every 15 minutes (the inbox is read on its own schedule; this only reads what is already there). */
export function startKeyWatch(): void {
  setTimeout(() => void watchKeys().catch(() => {}), 90_000).unref();
  setInterval(() => void watchKeys().catch(() => {}), 15 * 60_000).unref();
}
