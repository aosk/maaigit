import fs from 'node:fs';
import path from 'node:path';
import webpush, { type PushSubscription } from 'web-push';
import type { AppAlert, CalendarEvent, Lang, NotifyPrefs, PrayerName, Reminder } from '../shared/types.js';
import { prayersFor } from '../shared/prayer.js';
import { dayPeriod, leaveTime } from '../shared/schedule.js';
import { config } from './config.js';
import { writePrivate } from './secure-fs.js';
import { allEvents, id, save, state } from './store.js';
import { failed, ok } from './signals.js';

/**
 * Alerts: reminders, "time to leave", heads-ups before events and prayers.
 * Sent as Web Push (so they arrive with the app closed) and also kept in a
 * short list the open app shows as a banner.
 */

/** Alerts that come due while the computer was asleep still go out if they are at most this late. */
const GRACE_MS = 10 * 60_000;

// ---------- Keys for Web Push, made once and kept in data/push.json ----------

const KEYS_FILE = path.join(config.dataDir, 'push.json');

function vapidKeys(): { publicKey: string; privateKey: string } {
  try {
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')) as { publicKey: string; privateKey: string };
  } catch {
    const keys = webpush.generateVAPIDKeys();
    writePrivate(KEYS_FILE, JSON.stringify(keys, null, 2));
    return keys;
  }
}

const keys = vapidKeys();
webpush.setVapidDetails(process.env.MAAI_CONTACT ?? 'mailto:maai@example.com', keys.publicKey, keys.privateKey);
export const publicKey = keys.publicKey;

/**
 * The servers browsers use to deliver push messages. MAAI sends to whatever address a device gives
 * when it turns notifications on, so only these are accepted: an address pointing anywhere else
 * could make the server send requests to internal places.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function isPushServiceUrl(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && (url.port === '' || url.port === '443') && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

// ---------- Wording ----------

const PRAYER_NAMES: Record<Lang, Record<PrayerName, string>> = {
  en: { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' },
  ar: { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' },
};

const clock = (d: Date, lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-nu-arab' : 'en-GB', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit', hour12: false }).format(d);

type Text = { title: string; body: string };
type Due = { key: string; at: Date; kind: AppAlert['kind']; text: (lang: Lang) => Text | Promise<Text> };

/** Writes the briefing text (and refreshes what it is based on). Given by whoever starts the scheduler. */
type BriefingWriter = (lang: Lang) => Promise<string>;

const BRIEFING_TITLES: Record<Lang, Record<'morning' | 'noon' | 'night', string>> = {
  en: { morning: 'Morning briefing', noon: 'Noon briefing', night: 'Night briefing' },
  ar: { morning: 'موجز الصباح', noon: 'موجز الظهر', night: 'موجز الليل' },
};
const BRIEFING_FALLBACK: Record<Lang, string> = { en: 'Open MAAI to see your day.', ar: 'افتح مساعد لترى يومك.' };

/** The briefing notification: titled for the time of day, with the day summarised in the body. */
function briefingDue(key: string, at: Date, write: BriefingWriter): Due {
  return {
    key,
    at,
    kind: 'briefing',
    text: async (lang) => ({
      title: BRIEFING_TITLES[lang][dayPeriod(at, config.timezone)],
      // If writing it fails (say, Claude is unreachable) the notification still arrives.
      body: await write(lang).catch((error: Error) => {
        console.error('Briefing notification text failed:', error.message);
        return BRIEFING_FALLBACK[lang];
      }),
    }),
  };
}

// ---------- What is due ----------

/** The first moment a prayer reminder fires: today if it is still ahead, otherwise tomorrow. Saved as `at` so it can't repeat unasked. */
export function firstPrayerTime(prayer: NonNullable<Reminder['prayer']>, offsetMinutes: number, now: Date, latitude: number, longitude: number): Date {
  for (let ahead = 0; ahead < 2; ahead++) {
    const day = new Date(now);
    day.setDate(day.getDate() + ahead);
    const found = prayersFor(day, latitude, longitude).find((p) => p.name === prayer);
    const time = found ? new Date(found.time.getTime() + offsetMinutes * 60_000) : undefined;
    if (time && time.getTime() > now.getTime()) return time;
  }
  return now;
}

/** When a reminder fires on the given day, or null if it doesn't. */
export function reminderTime(r: Reminder, day: Date, latitude: number, longitude: number): Date | null {
  if (r.done) return null;
  if (r.prayer) {
    const prayer = prayersFor(day, latitude, longitude).find((p) => p.name === r.prayer);
    if (!prayer) return null;
    if (r.at) {
      // The first day it applies to: once = that day only, weekly = that weekday, daily = that day onwards.
      const start = new Date(r.at);
      if (r.repeat === 'once' && start.toDateString() !== day.toDateString()) return null;
      if (r.repeat === 'weekly' && start.getDay() !== day.getDay()) return null;
      if (day < new Date(start.toDateString())) return null;
    }
    return new Date(prayer.time.getTime() + (r.offsetMinutes ?? 0) * 60_000);
  }
  if (!r.at) return null;
  const at = new Date(r.at);
  if (r.repeat === 'once') return at.toDateString() === day.toDateString() ? at : null;
  if (r.repeat === 'weekly' && at.getDay() !== day.getDay()) return null;
  if (day < new Date(at.toDateString())) return null;
  const t = new Date(day);
  t.setHours(at.getHours(), at.getMinutes(), 0, 0);
  return t;
}

/** Everything that should fire between `now - GRACE_MS` and `now`. */
export function dueAlerts(
  now: Date,
  data: { reminders: Reminder[]; events: CalendarEvent[] },
  prefs: NotifyPrefs,
  latitude: number,
  longitude: number,
  writeBriefing?: BriefingWriter,
): Due[] {
  const out: Due[] = [];
  const day = now.toDateString();

  if (prefs.reminders) {
    for (const r of data.reminders) {
      const at = reminderTime(r, now, latitude, longitude);
      if (at) {
        out.push({
          key: `rem:${r.id}:${day}`,
          at,
          kind: 'reminder',
          text: (lang) => ({ title: lang === 'ar' ? 'تذكير' : 'Reminder', body: r.title }),
        });
      }
    }
  }

  for (const e of data.events) {
    const start = new Date(e.start);
    const leave = leaveTime(e);
    if (prefs.leave && leave) {
      out.push({
        key: `leave:${e.id}:${e.start}`,
        at: leave,
        kind: 'leave',
        text: (lang) =>
          lang === 'ar'
            ? { title: `حان وقت الخروج: ${e.title}`, body: `يبدأ الساعة ${clock(start, lang)} · ${e.travelMinutes} دقيقة بالسيارة` }
            : { title: `Time to leave: ${e.title}`, body: `Starts at ${clock(start, lang)} · ${e.travelMinutes} min drive` },
      });
    }
    if (prefs.events) {
      out.push({
        key: `event:${e.id}:${e.start}`,
        at: new Date(start.getTime() - prefs.eventMinutes * 60_000),
        kind: 'event',
        text: (lang) =>
          lang === 'ar'
            ? { title: e.title, body: `يبدأ بعد ${prefs.eventMinutes} دقيقة، الساعة ${clock(start, lang)}` }
            : { title: e.title, body: `Starts in ${prefs.eventMinutes} min, at ${clock(start, lang)}` },
      });
    }
  }

  if (prefs.prayers) {
    for (const p of prayersFor(now, latitude, longitude)) {
      out.push({
        key: `prayer:${p.name}:${day}`,
        at: new Date(p.time.getTime() - prefs.prayerMinutes * 60_000),
        kind: 'prayer',
        text: (lang) =>
          lang === 'ar'
            ? { title: `صلاة ${PRAYER_NAMES.ar[p.name]}`, body: `بعد ${prefs.prayerMinutes} دقائق، الساعة ${clock(p.time, lang)}` }
            : { title: PRAYER_NAMES.en[p.name], body: `In ${prefs.prayerMinutes} minutes, at ${clock(p.time, lang)}` },
      });
    }
  }

  if (prefs.briefing && writeBriefing) {
    const [hours, minutes] = (/^([01]\d|2[0-3]):[0-5]\d$/.test(prefs.briefingTime) ? prefs.briefingTime : '07:00').split(':').map(Number);
    const at = new Date(now);
    at.setHours(hours, minutes, 0, 0);
    out.push(briefingDue(`briefing:${day}`, at, writeBriefing));
  }

  return out.filter((d) => d.at.getTime() <= now.getTime() && d.at.getTime() > now.getTime() - GRACE_MS);
}

// ---------- Sending ----------

/** A small picture at the front of each title, so an alert reads as a reminder at a glance. */
const ICONS: Record<AppAlert['kind'], string> = { reminder: '⏰', leave: '🚗', event: '📅', prayer: '🕌', briefing: '🗓️', message: '💬', health: '🩺', test: '🔔' };

async function deliver(due: Pick<Due, 'key' | 'kind' | 'text'>, url = '/#/today') {
  // Written once per language, even with several devices (a briefing costs an AI call).
  const written = new Map<Lang, Promise<Text>>();
  const textFor = (lang: Lang) => written.get(lang) ?? written.set(lang, Promise.resolve(due.text(lang))).get(lang)!;

  const appLang: Lang = state.subscriptions[0]?.lang ?? 'en';
  const shown = await textFor(appLang);
  state.alerts.unshift({ id: id(), at: new Date().toISOString(), kind: due.kind, ...shown, title: `${ICONS[due.kind]} ${shown.title}` });
  state.alerts.length = Math.min(state.alerts.length, 30);

  const gone: string[] = [];
  await Promise.all(
    state.subscriptions.map(async (s) => {
      try {
        const { title, body } = await textFor(s.lang);
        // Urgency "high" asks the phone to show it straight away, even when it is saving power.
        const payload = JSON.stringify({ title: `${ICONS[due.kind]} ${title}`, body, tag: due.key, kind: due.kind, lang: s.lang, url });
        await webpush.sendNotification(s.subscription, payload, { TTL: 3600, urgency: 'high' });
        ok('push');
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410: the phone or browser dropped this subscription; stop sending to it.
        if (status === 404 || status === 410) gone.push(s.subscription.endpoint);
        else {
          console.error('Push failed', status ?? '', (error as Error).message);
          failed('push', `${status ?? 'network'}: ${(error as Error).message}`);
        }
      }
    }),
  );
  if (gone.length) state.subscriptions = state.subscriptions.filter((s) => !gone.includes(s.subscription.endpoint));
  save();
}

/** Tells the user's phones about a WhatsApp message (when they chose to be told); opens the Inbox when tapped. */
export async function alertMessage(key: string, text: (lang: Lang) => Text): Promise<void> {
  if (!state.notifyPrefs.messages) return;
  await deliver({ key, kind: 'message', text }, '/#/inbox');
}

/** Tells the user's phones that a part of MAAI stopped working, or works again (when they chose to be told). */
export async function alertHealth(key: string, text: (lang: Lang) => Text): Promise<void> {
  if (!state.notifyPrefs.health) return;
  await deliver({ key, kind: 'health', text }, '/#/admin');
}

/** An order from the user's WhatsApp number made approval cards: always told, opening the assistant where they wait. */
export async function alertOrderCards(count: number): Promise<void> {
  await deliver({
    key: `order:${Date.now()}`,
    kind: 'message',
    text: (lang) =>
      lang === 'ar'
        ? { title: 'بانتظار موافقتك', body: `${count === 1 ? 'بطاقة واحدة' : `${count} بطاقات`} من أمرك في الواتساب` }
        : { title: 'Waiting for your approval', body: `${count} card(s) from your WhatsApp order` },
  }, '/#/assistant');
}

/** WhatsApp on the device needs linking: always told (the bot stops delivering until it is), opening the Inbox, which shows the code. */
export async function alertLink(): Promise<void> {
  await deliver({
    key: `link:${Date.now()}`,
    kind: 'health',
    text: (lang) =>
      lang === 'ar'
        ? { title: 'واتساب يحتاج ربط', body: 'افتح MAAI لترى رمز الربط وتكتبه في واتساب' }
        : { title: 'WhatsApp needs linking', body: 'Open MAAI to see the code to type in WhatsApp' },
  }, '/#/inbox');
}

export async function sendTest() {
  await deliver({
    key: `test:${Date.now()}`,
    kind: 'test',
    text: (l) => (l === 'ar' ? { title: 'مساعد', body: 'التنبيهات تعمل ✓' } : { title: 'MAAI', body: 'Notifications are working ✓' }),
  });
}

export function subscribe(subscription: PushSubscription, lang: Lang) {
  state.subscriptions = state.subscriptions.filter((s) => s.subscription.endpoint !== subscription.endpoint);
  state.subscriptions.push({ subscription, lang, createdAt: new Date().toISOString() });
  save();
}

export function unsubscribe(endpoint: string) {
  state.subscriptions = state.subscriptions.filter((s) => s.subscription.endpoint !== endpoint);
  save();
}

let writeBriefing: BriefingWriter | undefined;

/** Sends today's briefing right now, to every device (the "send a test" button). */
export async function sendBriefingNow(): Promise<void> {
  if (!writeBriefing) throw new Error('The briefing is not available right now.');
  await deliver(briefingDue(`briefing-now:${Date.now()}`, new Date(), writeBriefing));
}

/** Checks every 30 seconds for anything due. `write` writes the briefing notification's text. */
export function startScheduler(write?: BriefingWriter) {
  writeBriefing = write;
  const tick = async () => {
    const due = dueAlerts(new Date(), { reminders: state.reminders, events: allEvents().filter((e) => !e.allDay) }, state.notifyPrefs, config.latitude, config.longitude, writeBriefing).filter((d) => !state.sentAlerts.includes(d.key));
    for (const d of due) {
      state.sentAlerts.push(d.key);
      await deliver(d);
    }
    if (state.sentAlerts.length > 500) state.sentAlerts = state.sentAlerts.slice(-300);
  };
  setInterval(() => void tick().catch((e) => console.error('Alert check failed', e)), 30_000);
  void tick();
}
