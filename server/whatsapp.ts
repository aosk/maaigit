import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import type { InboxMessage, WhatsAppStatus } from '../shared/types.js';
import { config } from './config.js';
import { agentEnabled, audit, id, save, state } from './store.js';

/**
 * WhatsApp through Twilio, on a separate business number. Messages people send to that number
 * arrive at /webhook/whatsapp (Twilio signs each request), are kept for a few days, and are
 * summarised by MAAI. A reply goes out only when the user taps Send, and only inside WhatsApp's
 * 24-hour answer window. Nothing here reads the user's personal WhatsApp chats.
 */

const account = process.env.TWILIO_ACCOUNT_SID?.trim() ?? '';
const secret = process.env.TWILIO_AUTH_TOKEN?.trim() ?? '';
const sender = (process.env.TWILIO_WHATSAPP_FROM ?? '').trim().replace(/^whatsapp:/i, '');

export const whatsappConfigured = Boolean(account && secret && sender);

export function whatsappStatus(): WhatsAppStatus {
  return { configured: whatsappConfigured, number: whatsappConfigured ? sender : undefined, keepDays: config.whatsappDays };
}

/** WhatsApp lets a business answer freely only within this long of the person's last message. */
export const ANSWER_WINDOW_MS = 24 * 3_600_000;
const MAX_STORED = 500;

// ---------- Twilio's signature ----------

/** What Twilio signs: the full URL, then every form field as name+value in alphabetical order. */
export function signatureFor(url: string, params: Record<string, string>, token: string): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return createHmac('sha1', token).update(data).digest('base64');
}

export function validSignature(url: string, params: Record<string, string>, given: string, token: string): boolean {
  const expected = Buffer.from(signatureFor(url, params, token));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------- Receiving ----------

const digits = (value: string) => value.replace(/\D/g, '');

/** Keeps a message only for as long as the user chose; pasted-in messages are never deleted here. */
export function pruneWhatsApp(now = Date.now()): void {
  const oldest = now - config.whatsappDays * 86_400_000;
  const kept = state.inbox.filter((m) => m.via !== 'twilio' || Date.parse(m.receivedAt) >= oldest);
  if (kept.length !== state.inbox.length) {
    state.inbox = kept;
    save();
  }
}

// ---------- The automatic "received" note ----------

/** Set MAAI_WHATSAPP_ACK=off to stop it. */
const ackEnabled = (process.env.MAAI_WHATSAPP_ACK ?? 'on').trim().toLowerCase() !== 'off';
/** Someone who keeps writing gets the note once, not after every message (and two auto-replying bots cannot loop). */
export const ACK_EVERY_MS = 6 * 3_600_000;

const ACK = {
  en: 'Hello! This is MAAI, the AI assistant of Abdulrahman. Your message was received and he will get back to you as soon as possible.',
  ar: 'مرحباً! أنا MAAI، المساعد الذكي لعبدالرحمن. وصلتني رسالتك وسيتواصل معك في أقرب وقت ممكن.',
};

/** The note for this person, in the language they wrote in, or null if they already got one lately. Fixed text: nothing a sender writes can change it. */
function acknowledgement(message: InboxMessage, now = Date.now()): string | null {
  if (!ackEnabled || !message.phone || !agentEnabled('messaging')) return null;
  const last = Date.parse(state.whatsappAcks[message.phone] ?? '');
  if (Number.isFinite(last) && now - last < ACK_EVERY_MS) return null;
  state.whatsappAcks[message.phone] = new Date(now).toISOString();
  for (const [phone, at] of Object.entries(state.whatsappAcks)) if (now - Date.parse(at) > 2 * ACK_EVERY_MS) delete state.whatsappAcks[phone];
  audit(`Sent the automatic "received" note to ${message.from}`, 'MAAI', 'done');
  return /[\u0600-\u06FF]/.test(message.text) ? ACK.ar : ACK.en;
}

const xml = (text: string) => text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Stores one message Twilio delivered. Returns null for something that is not a WhatsApp text; `fresh` is false for a repeat delivery. */
export function receive(params: Record<string, string>): { message: InboxMessage; fresh: boolean } | null {
  const from = params.From ?? '';
  if (!/^whatsapp:\+?\d{5,20}$/i.test(from)) return null;
  const externalId = (params.MessageSid ?? '').slice(0, 64);
  const repeat = externalId ? state.inbox.find((m) => m.externalId === externalId) : undefined;
  if (repeat) return { message: repeat, fresh: false };

  const phone = digits(from);
  const body = (params.Body ?? '').trim().slice(0, 4000);
  const hasMedia = Number(params.NumMedia ?? 0) > 0;
  const message: InboxMessage = {
    id: id(),
    from: (params.ProfileName ?? '').trim().slice(0, 100) || `+${phone}`,
    phone,
    channel: 'whatsapp',
    text: body || (hasMedia ? '[A photo, voice note or file: MAAI cannot read these]' : ''),
    receivedAt: new Date().toISOString(),
    replied: false,
    via: 'twilio',
    externalId: externalId || undefined,
  };
  if (!message.text) return null;
  state.inbox.push(message);
  // A flood of messages must not grow the saved data without limit: the oldest delivered ones go first.
  const delivered = state.inbox.filter((m) => m.via === 'twilio');
  if (delivered.length > MAX_STORED) {
    const drop = new Set(delivered.slice(0, delivered.length - MAX_STORED).map((m) => m.id));
    state.inbox = state.inbox.filter((m) => !drop.has(m.id));
  }
  pruneWhatsApp();
  save();
  return { message, fresh: true };
}

/** The person's last message to the business number, if any. */
export function lastFrom(phone: string): InboxMessage | undefined {
  return state.inbox.filter((m) => m.via === 'twilio' && m.phone === phone).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
}

export function canAnswer(phone: string | undefined, now = Date.now()): boolean {
  if (!whatsappConfigured || !phone) return false;
  const last = lastFrom(phone);
  return Boolean(last) && now - Date.parse(last!.receivedAt) < ANSWER_WINDOW_MS;
}

// ---------- Sending ----------

export class WhatsAppError extends Error {}

export async function sendWhatsApp(phone: string, body: string): Promise<void> {
  if (!whatsappConfigured) throw new WhatsAppError('WhatsApp is not connected.');
  let response: Response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${account}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: `whatsapp:${sender.startsWith('+') ? sender : `+${sender}`}`, To: `whatsapp:+${digits(phone)}`, Body: body }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new WhatsAppError('Could not reach Twilio. Try again in a moment.');
  }
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { message?: string; code?: number };
    console.error('Twilio refused a message', response.status, detail.code, detail.message);
    if (response.status === 401) throw new WhatsAppError('Twilio did not accept the account details. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.');
    // Twilio's own words say what to fix (a number not in the sandbox, a wrong sender…); they hold no secrets.
    const why = typeof detail.message === 'string' ? ` ${detail.message.replace(/\s+/g, ' ').trim().slice(0, 240)}` : '';
    throw new WhatsAppError(`Twilio could not send the message${detail.code ? ` (error ${detail.code})` : ''}.${why}`);
  }
}

// ---------- The webhook ----------

/** Served before the sign-in check: Twilio cannot sign in, so every request proves itself with its signature. */
export const whatsappWebhook = Router();

whatsappWebhook.post('/webhook/whatsapp', express.urlencoded({ extended: false, limit: '100kb', parameterLimit: 100 }), (req, res) => {
  if (!whatsappConfigured) return res.status(404).end();
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries((req.body ?? {}) as Record<string, unknown>)) if (typeof value === 'string') params[key] = value;
  const url = process.env.WHATSAPP_WEBHOOK_URL?.trim() || `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  if (!validSignature(url, params, req.get('x-twilio-signature') ?? '', secret)) return res.status(403).end();

  const got = receive(params);
  // The only thing MAAI says by itself is the fixed "received" note; everything else waits for the user.
  const note = got?.fresh ? acknowledgement(got.message) : null;
  res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?><Response>${note ? `<Message>${xml(note)}</Message>` : ''}</Response>`);
});
