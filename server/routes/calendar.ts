import { Router } from 'express';
import { feedPath } from '../feed.js';

export const calendar = Router();

/** Where to subscribe the phone and Google Calendar to MAAI's own calendar. Signed-in only: the link is the key. */
calendar.get('/calendar/feed', (req, res) => {
  const host = req.get('x-forwarded-host') ?? req.get('host') ?? 'localhost';
  const proto = req.get('x-forwarded-proto')?.split(',')[0] ?? req.protocol;
  res.json({ https: `${proto}://${host}${feedPath}`, webcal: `webcal://${host}${feedPath}` });
});
