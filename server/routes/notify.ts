import { Router } from 'express';
import { DEFAULT_PREFS, audit, save, state } from '../store.js';
import { publicKey, sendTest, subscribe, unsubscribe } from '../notify.js';
import { HttpError, lang, text, wrap } from './http.js';

export const notify = Router();

notify.get('/notify', (_req, res) => {
  res.json({ publicKey, devices: state.subscriptions.length, prefs: state.notifyPrefs });
});

notify.patch('/notify/prefs', (req, res) => {
  const p = { ...DEFAULT_PREFS, ...state.notifyPrefs };
  for (const key of ['reminders', 'leave', 'events', 'prayers'] as const) {
    if (typeof req.body[key] === 'boolean') p[key] = req.body[key];
  }
  for (const key of ['eventMinutes', 'prayerMinutes'] as const) {
    const n = Number(req.body[key]);
    if (Number.isInteger(n) && n >= 0 && n <= 120) p[key] = n;
  }
  state.notifyPrefs = p;
  save();
  res.json(p);
});

notify.post('/notify/subscribe', (req, res) => {
  const s = req.body.subscription;
  if (typeof s?.endpoint !== 'string' || !s.endpoint.startsWith('https://') || typeof s?.keys?.p256dh !== 'string' || typeof s?.keys?.auth !== 'string') {
    throw new HttpError(400, 'Not a valid push subscription');
  }
  subscribe({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, lang(req.body.lang));
  audit('Notifications turned on for a device', 'User', 'done');
  res.status(204).end();
});

notify.post('/notify/unsubscribe', (req, res) => {
  unsubscribe(text(req.body.endpoint, 2000));
  res.status(204).end();
});

notify.post('/notify/test', wrap(async (_req, res) => {
  await sendTest();
  res.status(204).end();
}));

notify.get('/alerts', (req, res) => {
  const since = Date.parse(String(req.query.since ?? ''));
  res.json(Number.isNaN(since) ? [] : state.alerts.filter((a) => Date.parse(a.at) > since));
});
