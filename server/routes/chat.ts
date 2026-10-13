import { Router } from 'express';
import type { Proposal, StreamEvent } from '../../shared/types.js';
import { chat } from '../ai/chat.js';
import { sendMail } from '../mail.js';
import { audit, id, save, state, type Conversation } from '../store.js';
import { HttpError, explain, find, lang, text, wrap } from './http.js';

export const assistant = Router();

function conversation(): Conversation {
  if (!state.conversations[0]) state.conversations.unshift({ id: id(), apiMessages: [], turns: [] });
  return state.conversations[0];
}

assistant.get('/chat', (_req, res) => {
  const c = conversation();
  const ids = new Set(c.turns.flatMap((t) => t.proposalIds ?? []));
  res.json({ turns: c.turns, proposals: state.proposals.filter((p) => ids.has(p.id)) });
});

/**
 * Sends a message and streams the answer as server-sent events, so the app can
 * show what MAAI is doing: its thinking, each step, and the reply as it is written.
 */
assistant.post('/chat/stream', async (req, res) => {
  const message = text(req.body.text, 4000);
  if (!message) return res.status(400).json({ error: 'Say or type something first' });
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event: StreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  // A comment line every 15 s keeps proxies from closing a long, quiet connection.
  const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
  try {
    const reply = await chat(conversation(), message, lang(req.body.lang), send);
    send({ type: 'done', reply: reply.text, proposals: reply.proposals });
  } catch (error) {
    send({ type: 'error', error: explain(error).error });
  } finally {
    clearInterval(keepAlive);
    res.end();
  }
});

assistant.post('/chat/reset', (_req, res) => {
  state.conversations.unshift({ id: id(), apiMessages: [], turns: [] });
  state.conversations.length = Math.min(state.conversations.length, 20);
  save();
  res.status(204).end();
});

/** Does what an approved card asks for. The cards are editable, so it uses what the user approved. */
async function carryOut(p: Proposal, body: Record<string, unknown>): Promise<string> {
  switch (p.kind) {
    case 'email': {
      const mail = { to: text(body.to, 320) || p.to, subject: text(body.subject, 300) || p.subject, body: text(body.body, 20_000) || p.body };
      await sendMail(mail);
      Object.assign(p, mail, { title: mail.subject });
      return `Emailed ${mail.to}: ${mail.subject}`;
    }
    case 'meeting': {
      const option = p.options.find((o) => o.start === text(body.start, 40)) ?? p.options[0];
      p.chosen = option.start;
      state.events.push({ id: id(), title: p.title, start: option.start, minutes: p.minutes, place: p.attendeeEmail, bookedByMaai: true });
      return `Booked: ${p.title}`;
    }
    case 'reminder':
      state.reminders.push({ id: id(), title: p.title, when: p.when, at: p.at, prayer: p.prayer, offsetMinutes: p.offsetMinutes, repeat: p.repeat, done: false });
      return `Saved reminder: ${p.title}`;
  }
}

assistant.post('/proposals/:id/approve', wrap(async (req, res) => {
  const p = find(state.proposals, req.params.id);
  if (p.status !== 'pending') throw new HttpError(409, `Already ${p.status}`);
  const done = await carryOut(p, req.body);
  p.status = 'approved';
  audit(done, 'User', 'approved');
  res.json(p);
}));

assistant.post('/proposals/:id/cancel', (req, res) => {
  const p = find(state.proposals, req.params.id);
  if (p.status === 'pending') {
    p.status = 'cancelled';
    audit(`Cancelled ${p.kind}: ${p.title}`, 'User', 'cancelled');
  }
  res.json(p);
});
