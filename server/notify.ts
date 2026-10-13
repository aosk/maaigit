import fs from 'node:fs';
import path from 'node:path';
import webpush, { type PushSubscription } from 'web-push';
import type { AppAlert, CalendarEvent, Lang, NotifyPrefs, PrayerName, Reminder } from '../shared/types.js';
import { prayersFor } from '../shared/prayer.js';
import { leaveTime } from '../shared/schedule.js';
import { config } from './config.js';
import { allEvents, id, save, state } from './store.js';

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
    return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
  } catch {
    const keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
    fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
    return keys;
  }
}

const keys = vapidKeys();
webpush.setVapidDetails(process.env.MAAI_CONTACT ?? 'mailto:maai@example.com', keys.publicKey, keys.privateKey);
export const publicKey = keys.publicKey;

// ---------- Wording ----------

const PRAYER_NAMES: Record<Lang, Record<PrayerName, string>> = {
  en: { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' },
  ar: { fajr: 'الفجر', dhuhr: 'الظهر', asr: 'العصر', maghrib: 'المغرب', isha: 'العشاء' },
};

const clock = (d: Date, lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-nu-arab' : 'en-GB', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit', hour12: false }).format(d);

type Due = { key: string; at: Date; kind: AppAlert['kind']; text: (lang: Lang) => { title: string; body: string } };

// ---------- What is due ----------

/** When a reminder fires on the given day, or null if it doesn't. */
export function reminderTime(r: Reminder, day: Date, latitude: number, longitude: number): Date | null {
  if (r.done) return null;
  if (r.prayer) {
    const prayer = prayersFor(day, latitude, longitude).find((p) => p.name === r.prayer);
    if (!prayer) return null;
    if (r.repeat === 'once' && r.at && new Date(r.at).toDateString() !== day.toDateString()) return null;
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

  return out.filter((d) => d.at.getTime() <= now.getTime() && d.at.getTime() > now.getTime() - GRACE_MS);
}

// ---------- Sending ----------

async function deliver(due: Pick<Due, 'key' | 'kind' | 'text'>) {
  const appLang: Lang = state.subscriptions[0]?.lang ?? 'en';
  const shown = due.text(appLang);
  state.alerts.unshift({ id: id(), at: new Date().toISOString(), kind: due.kind, ...shown });
  state.alerts.length = Math.min(state.alerts.length, 30);

  const gone: string[] = [];
  await Promise.all(
    state.subscriptions.map(async (s) => {
      const { title, body } = due.text(s.lang);
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({ title, body, tag: due.key, url: '/#/today' }), { TTL: 3600 });
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        // 404/410: the phone or browser dropped this subscription; stop sending to it.
        if (status === 404 || status === 410) gone.push(s.subscription.endpoint);
        else console.error('Push failed', status ?? '', (error as Error).message);
      }
    }),
  );
  if (gone.length) state.subscriptions = state.subscriptions.filter((s) => !gone.includes(s.subscription.endpoint));
  save();
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

/** Checks every 30 seconds for anything due. */
export function startScheduler() {
  const tick = async () => {
    const due = dueAlerts(new Date(), { reminders: state.reminders, events: allEvents().filter((e) => !e.allDay) }, state.notifyPrefs, config.latitude, config.longitude).filter((d) => !state.sentAlerts.includes(d.key));
    for (const d of due) {
      state.sentAlerts.push(d.key);
      await deliver(d);
    }
    if (state.sentAlerts.length > 500) state.sentAlerts = state.sentAlerts.slice(-300);
  };
  setInterval(() => void tick().catch((e) => console.error('Alert check failed', e)), 30_000);
  void tick();
}
