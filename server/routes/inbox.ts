import { Router } from 'express';
import type { Tone } from '../../shared/types.js';
import { digestInbox, draftReply } from '../ai/mail.js';
import { digestWhatsApp } from '../ai/whatsapp.js';
import { ANSWER_WINDOW_MS, canAnswer, pruneWhatsApp, sendWhatsApp, whatsappConfigured } from '../whatsapp.js';
import { isEmail, sendMail } from '../mail.js';
import { fetchInbox, inboxConfigured } from '../gmail-inbox.js';
import { agentEnabled, audit, id, save, state } from '../store.js';
import { canSendByBot, pruneBotMessages, queueCommand } from '../bot.js';
import { inboxFeed } from '../inbox-feed.js';
import { HttpError, find, lang, text, wrap } from './http.js';

export const inbox = Router();

const TONES: Tone[] = ['short', 'friendly', 'formal', 'arabic'];

// ---------- Messages the user pasted in (WhatsApp or email) ----------

inbox.get('/inbox', (_req, res) => {
  pruneWhatsApp();
  pruneBotMessages();
  res.json([...state.inbox].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)));
});

inbox.post('/inbox', (req, res) => {
  const from = text(req.body.from, 100);
  const body = text(req.body.text, 4000);
  if (!from || !body) throw new HttpError(400, 'Who it is from and the message are both needed');
  const phone = text(req.body.phone, 20).replace(/\D/g, '') || undefined;
  const email = text(req.body.email, 320);
  if (email && !isEmail(email)) throw new HttpError(400, `"${email}" is not a valid email address`);
  const message = { id: id(), from, phone, email: email || undefined, channel: email && !phone ? ('email' as const) : ('whatsapp' as const), text: body, receivedAt: new Date().toISOString(), replied: false };
  state.inbox.push(message);
  // Pasted messages are kept like the WhatsApp ones: the newest 500.
  if (state.inbox.length > 500) state.inbox.splice(0, state.inbox.length - 500);
  save();
  res.status(201).json(message);
});

inbox.post('/inbox/:id/draft', wrap(async (req, res) => {
  const message = find(state.inbox, req.params.id);
  const tone = TONES.includes(req.body.tone) ? (req.body.tone as Tone) : 'friendly';
  res.json(await draftReply({ from: message.from, text: message.text, tone, lang: lang(req.body.lang) }));
}));

inbox.post('/inbox/:id/email', wrap(async (req, res) => {
  const message = find(state.inbox, req.params.id);
  if (!agentEnabled('messaging')) throw new HttpError(403, 'Messaging is switched off by the admin.');
  const to = text(req.body.to, 320) || message.email || '';
  const body = text(req.body.body, 20_000);
  if (!body) throw new HttpError(400, 'The reply is empty');
  await sendMail({ to, subject: text(req.body.subject, 300) || `Re: ${message.text.slice(0, 60)}`, body });
  message.replied = true;
  audit(`Emailed a reply to ${message.from} (${to})`, 'User', 'approved');
  res.json(message);
}));

// Sends the reply, only when the user taps Send: from the user's own number through the device bot for a
// message the bot delivered, else through the WhatsApp Business number while WhatsApp still allows a free
// answer (24 hours after the person's last message).
inbox.post('/inbox/:id/whatsapp', wrap(async (req, res) => {
  const message = find(state.inbox, req.params.id);
  if (!agentEnabled('messaging')) throw new HttpError(403, 'Messaging is switched off by the admin.');
  if (message.via === 'bot') {
    if (!canSendByBot(message)) throw new HttpError(400, message.group ? 'MAAI does not answer in groups. Open WhatsApp and write there yourself.' : 'The device bot is not connected, so MAAI cannot send this reply. Use "Open WhatsApp" instead.');
    const body = text(req.body.body, 1500);
    if (!body) throw new HttpError(400, 'The reply is empty');
    queueCommand({ kind: 'reply', phone: message.phone, toName: message.from, text: body });
    for (const m of state.inbox) if (m.phone === message.phone && m.receivedAt <= message.receivedAt) m.replied = true;
    audit(`Sent a WhatsApp reply to ${message.from} through the device bot`, 'User', 'approved');
    return res.json(message);
  }
  if (!whatsappConfigured) throw new HttpError(400, 'WhatsApp is not connected yet.');
  if (message.via !== 'twilio' || !message.phone) throw new HttpError(400, 'This message did not arrive on the WhatsApp Business number, so MAAI cannot send the reply. Use "Open WhatsApp" instead.');
  const body = text(req.body.body, 1500);
  if (!body) throw new HttpError(400, 'The reply is empty');
  if (!canAnswer(message.phone)) {
    throw new HttpError(409, `WhatsApp only allows a reply within ${ANSWER_WINDOW_MS / 3_600_000} hours of their last message. Open WhatsApp and write to them yourself.`);
  }
  await sendWhatsApp(message.phone, body);
  for (const m of state.inbox) if (m.phone === message.phone && m.receivedAt <= message.receivedAt) m.replied = true;
  audit(`Sent a WhatsApp reply to ${message.from}`, 'User', 'approved');
  res.json(message);
}));

inbox.post('/inbox/:id/replied', (req, res) => {
  const message = find(state.inbox, req.params.id);
  message.replied = true;
  audit(`Reply to ${message.from} handed to ${message.channel}`, 'User', 'done');
  res.json(message);
});

inbox.delete('/inbox/:id', (req, res) => {
  state.inbox = state.inbox.filter((m) => m.id !== req.params.id);
  save();
  res.status(204).end();
});

// ---------- Everything in one list ----------

inbox.get('/inbox/feed', wrap(async (req, res) => res.json(await inboxFeed(lang(req.query.lang), req.query.refresh === '1'))));

// ---------- Gmail inbox (read-only) ----------

// Unread count for badges: reads the inbox (cached 5 minutes) without calling Claude.
inbox.get('/mail/count', wrap(async (_req, res) => {
  if (!inboxConfigured) return res.json({ unread: null });
  const mails = await fetchInbox().catch(() => null);
  res.json(mails ? { unread: mails.filter((m) => m.unread).length, total: mails.length } : { unread: null });
}));

inbox.get('/mail/digest', wrap(async (req, res) => res.json(await digestInbox(lang(req.query.lang), req.query.refresh === '1'))));

// ---------- WhatsApp business number: summary and ranking ----------

inbox.get('/whatsapp/digest', wrap(async (req, res) => res.json(await digestWhatsApp(lang(req.query.lang)))));
