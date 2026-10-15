import { Router } from 'express';
import { feedPath } from '../feed.js';

export const calendar = Router();

/** Where to subscribe the phone and Google Calendar to MAAI's own calendar. Signed-in only: the link is the key. */
calendar.get('/calendar/feed', (req, res) => {
  // Built from the configured public address when there is one (Render sets RENDER_EXTERNAL_URL), never from a header
  // a visitor can write: otherwise a forged Host could make MAAI hand out a link that points at someone else's server.
  const configured = (process.env.MAAI_PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL)?.trim();
  const base = configured ? new URL(configured) : new URL(`${req.protocol}://${req.get('host') ?? 'localhost'}`);
  res.json({ https: `${base.origin}${feedPath}`, webcal: `webcal://${base.host}${feedPath}` });
});
