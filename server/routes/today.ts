import { Router } from 'express';
import type { TodayData } from '../../shared/types.js';
import { nextPrayer, prayersFor } from '../../shared/prayer.js';
import { eventEnd } from '../../shared/schedule.js';
import { briefing } from '../ai/briefing.js';
import { refreshCalendar } from '../gcal.js';
import { config } from '../config.js';
import { allEvents, audit, id, save, state } from '../store.js';
import { mirrorToGoogle, removeFromGoogle } from '../gwrite.js';
import { lastSyncAt } from '../sync.js';
import { HttpError, find, lang, text, wrap } from './http.js';

export const today = Router();

today.get('/today', wrap(async (_req, res) => {
  await refreshCalendar();
  const now = new Date();
  const from = now.getTime() - 12 * 3_600_000;
  const to = now.getTime() + 7 * 86_400_000;
  const slot = ({ name, time }: { name: TodayData['nextPrayer']['name']; time: Date }) => ({ name, time: time.toISOString() });
  const data: TodayData = {
    events: allEvents().filter((e) => eventEnd(e) > from && Date.parse(e.start) < to),
    reminders: state.reminders,
    prayers: prayersFor(now, config.latitude, config.longitude).map(slot),
    nextPrayer: slot(nextPrayer(now, config.latitude, config.longitude)),
    syncedAt: lastSyncAt(),
  };
  res.json(data);
}));

today.get('/briefing', wrap(async (req, res) => res.json(await briefing(lang(req.query.lang)))));

today.post('/events', wrap(async (req, res) => {
  const title = text(req.body.title, 200);
  const start = text(req.body.start, 40);
  const minutes = Number(req.body.minutes);
  if (!title || Number.isNaN(Date.parse(start)) || !(minutes > 0 && minutes <= 24 * 60)) {
    throw new HttpError(400, 'title, start and minutes are required');
  }
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
