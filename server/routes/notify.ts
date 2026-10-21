import { Router } from 'express';
import { DEFAULT_PREFS, audit, save, state } from '../store.js';
import { isPushServiceUrl, publicKey, sendBriefingNow, sendTest, subscribe, unsubscribe } from '../notify.js';
import { HttpError, lang, text, wrap } from './http.js';

export const notify = Router();

notify.get('/notify', (_req, res) => {
  res.json({ publicKey, devices: state.subscriptions.length, prefs: state.notifyPrefs });
});

notify.patch('/notify/prefs', (req, res) => {
  const p = { ...DEFAULT_PREFS, ...state.notifyPrefs };
  for (const key of ['reminders', 'leave', 'events', 'prayers', 'briefing', 'messages'] as const) {
    if (typeof req.body[key] === 'boolean') p[key] = req.body[key];
  }
  for (const key of ['eventMinutes', 'prayerMinutes'] as const) {
    const n = Number(req.body[key]);
    if (Number.isInteger(n) && n >= 0 && n <= 120) p[key] = n;
  }
  if (typeof req.body.briefingTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body.briefingTime)) p.briefingTime = req.body.briefingTime;
  state.notifyPrefs = p;
  save();
  res.json(p);
});

notify.post('/notify/subscribe', (req, res) => {
  const s = req.body.subscription;
  if (typeof s?.endpoint !== 'string' || !isPushServiceUrl(s.endpoint) || typeof s?.keys?.p256dh !== 'string' || typeof s?.keys?.auth !== 'string') {
    throw new HttpError(400, 'Not a valid push subscription');
  }
  // Real push subscriptions are a few hundred characters; a device list is a handful.
  if (s.endpoint.length > 1000 || s.keys.p256dh.length > 200 || s.keys.auth.length > 100) throw new HttpError(400, 'Not a valid push subscription');
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

notify.post('/notify/briefing', wrap(async (_req, res) => {
  await sendBriefingNow().catch(() => {
    throw new HttpError(503, 'The briefing is not ready yet. Try again in a moment.');
  });
  res.status(204).end();
}));

notify.get('/alerts', (req, res) => {
  const since = Date.parse(typeof req.query.since === 'string' ? req.query.since : '');
  res.json(Number.isNaN(since) ? [] : state.alerts.filter((a) => Date.parse(a.at) > since));
});
