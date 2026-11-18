import { Router } from 'express';
import type { TodayData } from '../../shared/types.js';
import { nextPrayer, prayersFor } from '../../shared/prayer.js';
import { eventEnd } from '../../shared/schedule.js';
import { briefing } from '../ai/briefing.js';
import { briefingFacts } from '../ai/facts.js';
import { refreshCalendar, sane } from '../gcal.js';
import { config, setPlace } from '../config.js';
import { monitoring } from '../monitor.js';
import { allEvents, audit, id, save, state } from '../store.js';
import { mirrorToGoogle, removeFromGoogle } from '../gwrite.js';
import { lastSyncAt } from '../sync.js';
import { HttpError, find, lang, text, wrap } from './http.js';

export const today = Router();

const validZone = (zone: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** Where the user is now (a city picked in Settings, or the phone's own position): prayer times and the clock follow. */
today.put('/location', (req, res) => {
  const body = (req.body ?? {}) as { latitude?: unknown; longitude?: unknown; timezone?: unknown; name?: unknown };
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const timezone = text(body.timezone, 64);
  if (typeof body.latitude !== 'number' || typeof body.longitude !== 'number' || !(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) throw new HttpError(400, 'Send a latitude (-90 to 90) and a longitude (-180 to 180).');
  if (!timezone || !validZone(timezone)) throw new HttpError(400, 'Send a time zone such as Asia/Riyadh.');
  // Four decimals is about ten metres: plenty for prayer times, and no more precise than needed.
  const round = (n: number) => Math.round(n * 10_000) / 10_000;
  state.location = { latitude: round(latitude), longitude: round(longitude), timezone, name: text(body.name, 60).replace(/\p{Cc}/gu, '') || 'My location' };
  setPlace(state.location);
  save();
  audit(`Location set to ${state.location.name} (${timezone})`, 'User', 'done');
  res.json(state.location);
});

/** The monitoring page of the user's other site (see server/monitor.ts). */
today.get('/monitoring', wrap(async (req, res) => {
  res.json(await monitoring(Number(req.query.days) || 30, req.query.fresh === '1'));
}));

today.get('/today', wrap(async (_req, res) => {
  await refreshCalendar();
  const now = new Date();
  const from = now.getTime() - 12 * 3_600_000;
  const to = now.getTime() + 7 * 86_400_000;
  const slot = ({ name, time }: { name: TodayData['nextPrayer']['name']; time: Date }) => ({ name, time: time.toISOString() });
  const data: TodayData = {
    // An event saved with an impossible date is left out instead of breaking this page.
    events: allEvents().filter((e) => sane(new Date(e.start)) && eventEnd(e) > from && Date.parse(e.start) < to),
    reminders: state.reminders,
    prayers: prayersFor(now, config.latitude, config.longitude).map(slot),
    nextPrayer: slot(nextPrayer(now, config.latitude, config.longitude)),
    syncedAt: lastSyncAt(),
  };
  res.json(data);
}));

today.get('/briefing', wrap(async (req, res) => res.json(await briefing(lang(req.query.lang)))));

// The numbers on the briefing card; no AI, so the app can ask often.
today.get('/briefing/facts', (req, res) => res.json(briefingFacts(lang(req.query.lang))));

today.post('/events', wrap(async (req, res) => {
  const title = text(req.body.title, 200);
  const start = text(req.body.start, 40);
  const minutes = Number(req.body.minutes);
  if (!title || Number.isNaN(Date.parse(start)) || !(minutes > 0 && minutes <= 24 * 60)) {
    throw new HttpError(400, 'title, start and minutes are required');
  }
  // A date far outside any real calendar would break the calendar feed for good.
  const at = Date.parse(start);
  if (at < Date.now() - 366 * 86_400_000 || at > Date.now() + 5 * 366 * 86_400_000) throw new HttpError(400, 'start must be within the last year and the next five years');
  const event = { id: id(), title, start: new Date(start).toISOString(), minutes, place: text(req.body.place, 200) || undefined };
  state.events.push(event);
  audit(`Added "${title}" to the calendar`, 'User', 'done');
  await mirrorToGoogle(event);
  res.status(201).json(event);
}));

today.delete('/events/:id', wrap(async (req, res) => {
  const event = find(state.events, req.params.id);
  state.events = state.events.filter((e) => e !== event);
  audit(`Removed "${event.title}"`, 'User', 'done');
  await removeFromGoogle(event);
  res.status(204).end();
}));

today.post('/reminders/:id/done', (req, res) => {
  const reminder = find(state.reminders, req.params.id);
  reminder.done = req.body.done !== false;
  save();
  res.json(reminder);
});
