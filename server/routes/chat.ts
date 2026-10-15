import { Router } from 'express';
import type { Proposal, StreamEvent } from '../../shared/types.js';
import { chat } from '../ai/chat.js';
import { addFact } from '../profile.js';
import { config } from '../config.js';
import { firstPrayerTime } from '../notify.js';
import { releaseUploads, takeUploads } from '../uploads.js';
import { sendMail } from '../mail.js';
import { createTask, updateTask, validateNewTask } from '../asana.js';
import { mirrorToGoogle } from '../gwrite.js';
import { canAnswer, sendWhatsApp, whatsappConfigured } from '../whatsapp.js';
import { markHandled, markReplyTo } from '../mail-handled.js';
import { agentEnabled, audit, id, save, state, type Conversation } from '../store.js';
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
/** Conversations Claude is answering in right now. */
const answering = new Set<string>();

assistant.post('/chat/stream', async (req, res) => {
  let files: ReturnType<typeof takeUploads>;
  try {
    files = takeUploads(req.body.attachments);
  } catch (error) {
    const { status, error: why } = explain(error);
    return res.status(status).json({ error: why });
  }
  const message = text(req.body.text, 4000) || (files.length ? 'Please summarise this for me.' : '');
  if (!message) return res.status(400).json({ error: 'Say or type something first' });
  // Two answers at once would interleave in one conversation and break the history for every later message.
  const current = conversation();
  if (answering.has(current.id)) return res.status(409).json({ error: 'MAAI is still answering your last message. Wait for it, then try again.' });
  answering.add(current.id);
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
    const reply = await chat(current, message, lang(req.body.lang), send, files);
    releaseUploads(files);
    send({ type: 'done', reply: reply.text, proposals: reply.proposals });
  } catch (error) {
    send({ type: 'error', error: explain(error).error });
  } finally {
    answering.delete(current.id);
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
      if (!agentEnabled('messaging')) throw new HttpError(403, 'Messaging is switched off by the admin.');
      const mail = { to: text(body.to, 320) || p.to, subject: text(body.subject, 300) || p.subject, body: text(body.body, 20_000) || p.body };
      await sendMail(mail);
      Object.assign(p, mail, { title: mail.subject });
      if (p.replyToUid) markHandled(p.replyToUid, 'replied');
      else markReplyTo(mail.to, 'replied');
      return `Emailed ${mail.to}: ${mail.subject}`;
    }
    case 'whatsapp': {
      if (!agentEnabled('messaging')) throw new HttpError(403, 'Messaging is switched off by the admin.');
      const reply = text(body.body, 1500) || p.body;
      if (!reply) throw new HttpError(400, 'The reply is empty');
      if (!whatsappConfigured) throw new HttpError(400, 'WhatsApp is not connected yet.');
      if (!canAnswer(p.phone)) throw new HttpError(409, 'WhatsApp only allows a reply within 24 hours of their last message. Open WhatsApp and write to them yourself.');
      await sendWhatsApp(p.phone, reply);
      for (const m of state.inbox) if (m.phone === p.phone) m.replied = true;
      Object.assign(p, { body: reply });
      return `Sent a WhatsApp reply to ${p.toName}`;
    }
    case 'meeting': {
      const option = p.options.find((o) => o.start === text(body.start, 40)) ?? p.options[0];
      if (!option) throw new HttpError(400, 'This card has no time to book.');
      p.chosen = option.start;
      const event = { id: id(), title: p.title, start: option.start, minutes: p.minutes, place: p.attendeeEmail, bookedByMaai: true };
      state.events.push(event);
      markHandled(p.emailUid, 'meeting');
      const google = await mirrorToGoogle(event);
      if (google) Object.assign(p, { google: google.status, googleError: google.status === 'failed' ? google.error : undefined });
      return `Booked: ${p.title}${google?.status === 'added' ? ' (also in Google Calendar)' : ''}`;
    }
    case 'asana': {
      // The card is editable: apply exactly what the user approved.
      const change = { comment: text(body.comment, 5000), complete: body.complete === true, dueOn: text(body.dueOn, 10) };
      if (change.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(change.dueOn)) throw new HttpError(400, 'The due date must look like 2026-10-20.');
      if (!change.comment && !change.complete && !change.dueOn) throw new HttpError(400, 'Nothing to change: add a comment, mark it done, or set a date.');
      await updateTask(p.taskGid, change);
      Object.assign(p, change);
      return `Updated Asana task: ${p.taskName}`;
    }
    case 'asana_new': {
      // The card is editable: create exactly what the user approved.
      const task = validateNewTask({ name: body.name ?? p.title, notes: body.notes ?? p.notes, dueOn: body.dueOn ?? p.dueOn, projectGid: body.projectGid ?? p.projectGid });
      const created = await createTask(task);
      Object.assign(p, { title: task.name, notes: task.notes, dueOn: task.dueOn, projectGid: task.projectGid, taskUrl: created.url });
      return `Created Asana task: ${task.name}`;
    }
    case 'remember': {
      // The card is editable: keep exactly what the user approved.
      const fact = addFact({ text: body.text ?? p.title, category: body.category ?? p.category, source: 'assistant' });
      Object.assign(p, { title: fact.text, category: fact.category });
      return `Remembered: ${fact.text}`;
    }
    case 'reminder': {
      // A prayer reminder has no clock time of its own: record the first day, so a "once" or weekly one is not repeated every day.
      const at = p.at ?? (p.prayer ? firstPrayerTime(p.prayer, p.offsetMinutes ?? 0, new Date(), config.latitude, config.longitude).toISOString() : undefined);
      state.reminders.push({ id: id(), title: p.title, when: p.when, at, prayer: p.prayer, offsetMinutes: p.offsetMinutes, repeat: p.repeat, done: false });
      return `Saved reminder: ${p.title}`;
    }
  }
}

/** Cards being carried out right now: a second tap or a network retry must not send, book or create the same thing twice. */
const approving = new Set<string>();

assistant.post('/proposals/:id/approve', wrap(async (req, res) => {
  const p = find(state.proposals, req.params.id);
  if (p.status !== 'pending') throw new HttpError(409, `Already ${p.status}`);
  if (approving.has(p.id)) throw new HttpError(409, 'Already being done: one moment.');
  approving.add(p.id);
  try {
    const done = await carryOut(p, req.body ?? {});
    p.status = 'approved';
    audit(done, 'User', 'approved');
  } finally {
    approving.delete(p.id);
  }
  res.json(p);
}));

assistant.post('/proposals/:id/cancel', (req, res) => {
  const p = find(state.proposals, req.params.id);
  if (p.status === 'pending' && !approving.has(p.id)) {
    p.status = 'cancelled';
    audit(`Cancelled ${p.kind}: ${p.title}`, 'User', 'cancelled');
  }
  res.json(p);
});
