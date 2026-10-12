import { Router, type NextFunction, type Request, type Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import type { AdminOverview, Lang, StatusInfo, Tone } from '../shared/types.js';
import { nextPrayer, prayersFor } from '../shared/prayer.js';
import { MODEL, briefing, chat, client, draftReply } from './ai.js';
import { config } from './config.js';
import { audit, id, save, state, type Conversation } from './store.js';
import { DEFAULT_PREFS, publicKey, sendTest, subscribe, unsubscribe } from './notify.js';

export const api = Router();

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
/** Express 4 does not catch rejected promises, so every route goes through this. */
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

const lang = (value: unknown): Lang => (value === 'ar' ? 'ar' : 'en');
const text = (value: unknown, max = 4000) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function status(): StatusInfo {
  return {
    aiConfigured: Boolean(client),
    model: MODEL,
    location: { latitude: config.latitude, longitude: config.longitude, timezone: config.timezone },
  };
}

api.get('/status', (_req, res) => res.json(status()));

// ---------- Today ----------

api.get('/today', (_req, res) => {
  const now = new Date();
  const horizon = now.getTime() + 7 * 86_400_000;
  res.json({
    events: state.events
      .filter((e) => {
        const t = new Date(e.start).getTime();
        return t + e.minutes * 60_000 > now.getTime() - 12 * 3_600_000 && t < horizon;
      })
      .sort((a, b) => a.start.localeCompare(b.start)),
    reminders: state.reminders,
    prayers: prayersFor(now, config.latitude, config.longitude).map((p) => ({ name: p.name, time: p.time.toISOString() })),
    nextPrayer: (({ name, time }) => ({ name, time: time.toISOString() }))(nextPrayer(now, config.latitude, config.longitude)),
  });
});

api.get('/briefing', wrap(async (req, res) => res.json(await briefing(lang(req.query.lang)))));

api.post('/events', (req, res) => {
  const title = text(req.body.title, 200);
  const start = text(req.body.start, 40);
  const minutes = Number(req.body.minutes);
  if (!title || Number.isNaN(Date.parse(start)) || !(minutes > 0 && minutes <= 24 * 60)) {
    return res.status(400).json({ error: 'title, start and minutes are required' });
  }
  const event = { id: id(), title, start: new Date(start).toISOString(), minutes, place: text(req.body.place, 200) || undefined };
  state.events.push(event);
  audit(`Added "${title}" to the calendar`, 'User', 'done');
  res.status(201).json(event);
});

api.delete('/events/:id', (req, res) => {
  const event = state.events.find((e) => e.id === req.params.id);
  if (!event) return res.status(404).json({ error: 'Not found' });
  state.events = state.events.filter((e) => e !== event);
  audit(`Removed "${event.title}"`, 'User', 'done');
  res.status(204).end();
});

api.post('/reminders/:id/done', (req, res) => {
  const reminder = state.reminders.find((r) => r.id === req.params.id);
  if (!reminder) return res.status(404).json({ error: 'Not found' });
  reminder.done = req.body.done !== false;
  save();
  res.json(reminder);
});

// ---------- Assistant ----------

function conversation(): Conversation {
  if (!state.conversations[0]) state.conversations.unshift({ id: id(), apiMessages: [], turns: [] });
  return state.conversations[0];
}

api.get('/chat', (_req, res) => {
  const c = conversation();
  const ids = new Set(c.turns.flatMap((t) => t.proposalIds ?? []));
  res.json({ turns: c.turns, proposals: state.proposals.filter((p) => ids.has(p.id)) });
});

api.post('/chat', wrap(async (req, res) => {
  const message = text(req.body.text, 4000);
  if (!message) return res.status(400).json({ error: 'Say or type something first' });
  const c = conversation();
  const reply = await chat(c, message, lang(req.body.lang));
  c.turns.push({ role: 'user', text: message });
  c.turns.push({ role: 'assistant', text: reply.text, proposalIds: reply.proposals.map((p) => p.id) });
  save();
  res.json({ reply: reply.text, proposals: reply.proposals });
}));

api.post('/chat/reset', (_req, res) => {
  state.conversations.unshift({ id: id(), apiMessages: [], turns: [] });
  state.conversations.length = Math.min(state.conversations.length, 20);
  save();
  res.status(204).end();
});

api.post('/proposals/:id/approve', (req, res) => {
  const p = state.proposals.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status !== 'pending') return res.status(409).json({ error: `Already ${p.status}` });
  if (p.kind === 'meeting') {
    const start = text(req.body.start, 40);
    const option = p.options.find((o) => o.start === start) ?? p.options[0];
    p.chosen = option.start;
    state.events.push({ id: id(), title: p.title, start: option.start, minutes: p.minutes, place: p.attendeeEmail, bookedByMaai: true });
  } else {
    state.reminders.push({ id: id(), title: p.title, when: p.when, at: p.at, prayer: p.prayer, offsetMinutes: p.offsetMinutes, repeat: p.repeat, done: false });
  }
  p.status = 'approved';
  audit(`${p.kind === 'meeting' ? 'Booked' : 'Saved reminder'}: ${p.title}`, 'User', 'approved');
  res.json(p);
});

api.post('/proposals/:id/cancel', (req, res) => {
  const p = state.proposals.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.status === 'pending') {
    p.status = 'cancelled';
    audit(`Cancelled ${p.kind}: ${p.title}`, 'User', 'cancelled');
  }
  res.json(p);
});

// ---------- Inbox ----------

api.get('/inbox', (_req, res) => res.json([...state.inbox].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))));

api.post('/inbox', (req, res) => {
  const from = text(req.body.from, 100);
  const body = text(req.body.text, 4000);
  if (!from || !body) return res.status(400).json({ error: 'Who it is from and the message are both needed' });
  const phone = text(req.body.phone, 20).replace(/\D/g, '') || undefined;
  const message = { id: id(), from, phone, channel: 'whatsapp' as const, text: body, receivedAt: new Date().toISOString(), replied: false };
  state.inbox.push(message);
  save();
  res.status(201).json(message);
});

api.post('/inbox/:id/draft', wrap(async (req, res) => {
  const message = state.inbox.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'Not found' });
  const tone = (['short', 'friendly', 'formal', 'arabic'] as Tone[]).includes(req.body.tone) ? (req.body.tone as Tone) : 'friendly';
  res.json(await draftReply({ from: message.from, text: message.text, tone, lang: lang(req.body.lang) }));
}));

api.post('/inbox/:id/replied', (req, res) => {
  const message = state.inbox.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'Not found' });
  message.replied = true;
  audit(`Reply to ${message.from} handed to ${message.channel}`, 'User', 'done');
  res.json(message);
});

api.delete('/inbox/:id', (req, res) => {
  state.inbox = state.inbox.filter((m) => m.id !== req.params.id);
  save();
  res.status(204).end();
});

// ---------- Notifications ----------

api.get('/notify', (_req, res) => {
  res.json({ publicKey, devices: state.subscriptions.length, prefs: state.notifyPrefs });
});

api.patch('/notify/prefs', (req, res) => {
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

api.post('/notify/subscribe', (req, res) => {
  const s = req.body.subscription;
  if (typeof s?.endpoint !== 'string' || !s.endpoint.startsWith('https://') || typeof s?.keys?.p256dh !== 'string' || typeof s?.keys?.auth !== 'string') {
    return res.status(400).json({ error: 'Not a valid push subscription' });
  }
  subscribe({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } }, lang(req.body.lang));
  audit('Notifications turned on for a device', 'User', 'done');
  res.status(204).end();
});

api.post('/notify/unsubscribe', (req, res) => {
  unsubscribe(text(req.body.endpoint, 2000));
  res.status(204).end();
});

api.post('/notify/test', wrap(async (req, res) => {
  await sendTest(lang(req.body.lang));
  res.status(204).end();
}));

api.get('/alerts', (req, res) => {
  const since = Date.parse(String(req.query.since ?? ''));
  res.json(state.alerts.filter((a) => !Number.isNaN(since) && Date.parse(a.at) > since));
});

// ---------- Admin ----------

api.get('/admin', (_req, res) => {
  const approved = state.proposals.filter((p) => p.status === 'approved').length;
  const cancelled = state.proposals.filter((p) => p.status === 'cancelled').length;
  const overview: AdminOverview = {
    counts: {
      events: state.events.length,
      reminders: state.reminders.length,
      proposals: state.proposals.length,
      approved,
      cancelled,
      drafts: state.drafts,
      chats: state.conversations.reduce((n, c) => n + c.turns.filter((t) => t.role === 'user').length, 0),
    },
    approvalRate: approved + cancelled ? approved / (approved + cancelled) : null,
    agents: state.agents,
    audit: state.audit.slice(0, 50),
    status: status(),
    usage: state.usage,
  };
  res.json(overview);
});

api.patch('/admin/agents/:id', (req, res) => {
  const agent = state.agents.find((a) => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'Not found' });
  agent.enabled = Boolean(req.body.enabled);
  audit(`${agent.name} agent turned ${agent.enabled ? 'on' : 'off'}`, 'Admin', 'done');
  res.json(agent);
});

// ---------- Errors: plain words the app can show ----------

api.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof Anthropic.AuthenticationError) {
    return res.status(502).json({ error: 'The Claude API key in .env is not valid. Check it at console.anthropic.com.' });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return res.status(503).json({ error: 'Claude is busy right now. Try again in a moment.' });
  }
  if (error instanceof Anthropic.APIError) {
    console.error('Claude API error', error.status, error.message);
    return res.status(502).json({ error: `Claude could not answer (${error.status ?? 'network'}). Try again.` });
  }
  console.error(error);
  res.status(500).json({ error: error instanceof Error ? error.message : 'Something went wrong' });
});
