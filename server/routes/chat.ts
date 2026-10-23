import { Router } from 'express';
import type { StreamEvent } from '../../shared/types.js';
import { answering, chat, currentConversation as conversation } from '../ai/chat.js';
import { approveCard, cancelCard } from '../approve.js';
import { releaseUploads, takeUploads } from '../uploads.js';
import { id, save, state } from '../store.js';
import { explain, find, lang, text, wrap } from './http.js';

export const assistant = Router();

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
    const reply = await chat(current, message, lang(req.body.lang), send, files, req.body.voice === 'ar' || req.body.voice === 'en' ? req.body.voice : undefined);
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

assistant.post('/proposals/:id/approve', wrap(async (req, res) => {
  const p = find(state.proposals, req.params.id);
  await approveCard(p, req.body ?? {}, 'User');
  res.json(p);
}));

assistant.post('/proposals/:id/cancel', (req, res) => {
  const p = find(state.proposals, req.params.id);
  cancelCard(p, 'User');
  res.json(p);
});
