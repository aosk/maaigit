import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { BotInputError, MAX_BATCH, botStatus, finishCommand, keyMatches, receiveContacts, receiveFromBot, receiveLink, seen, takeCommands, waitForCommands } from '../bot.js';
import { alertLink } from '../notify.js';
import { takeOrder, voiceFailed } from '../remote.js';
import { state } from '../store.js';

/**
 * The device bot's own door, /bot/v1, outside /api: the bot has no browser session, so instead of the
 * password it sends its device key as "Authorization: Bearer maai_...". Wrong keys are counted per address
 * and soon refused, and a working key is still held to a request rate a bot needs and no more.
 */
export const deviceApi = Router();

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;
const MAX_REQUESTS = 120;

const failures = new Map<string, { count: number; since: number }>();
let requests = { count: 0, since: 0 };

/** Forgets the counters (tests only). */
export function resetBotLimits(): void {
  failures.clear();
  requests = { count: 0, since: 0 };
}

function deviceKey(req: Request, res: Response, next: NextFunction) {
  // No key made yet: the door does not exist.
  if (!state.bot.keyHash) return res.status(404).json({ error: 'Not found' });
  const now = Date.now();
  const where = req.ip ?? 'unknown';
  const failed = failures.get(where);
  if (failed && now - failed.since < WINDOW_MS && failed.count >= MAX_FAILURES) {
    res.setHeader('Retry-After', String(Math.ceil((failed.since + WINDOW_MS - now) / 1000)));
    return res.status(429).json({ error: 'Too many wrong keys. Try again later.' });
  }
  const given = /^Bearer\s+(\S{1,200})$/i.exec(req.get('authorization') ?? '')?.[1] ?? '';
  if (!keyMatches(given)) {
    const fresh = !failed || now - failed.since >= WINDOW_MS;
    failures.set(where, { count: fresh ? 1 : failed.count + 1, since: fresh ? now : failed.since });
    return res.status(401).json({ error: 'The device key is missing or wrong.' });
  }
  failures.delete(where);
  if (now - requests.since >= 60_000) requests = { count: 0, since: now };
  if (++requests.count > MAX_REQUESTS) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests. Slow down.' });
  }
  next();
}

const deviceName = (value: unknown) => (typeof value === 'string' ? value.replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 60) : '');

deviceApi.use(deviceKey);

/** Delivers messages (hourly) and gets any waiting commands back in the same answer. */
deviceApi.post('/sync', (req, res) => {
  seen(deviceName(req.body?.device));
  const delivered = receiveFromBot(req.body, Date.now(), (order) => takeOrder(order));
  // The order number goes back to the bot, which then sends its voice notes as audio (to /voice).
  res.json({ ...delivered, commands: takeCommands(), orderPhone: state.bot.orderPhone ?? '', latest: latest() });
});

/**
 * A voice note from the user's order number, as raw audio (too big for the JSON door): written out and carried
 * out as an order. Anything not from exactly the order number is refused.
 */
deviceApi.post('/voice', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '4mb' }), (req, res) => {
  seen();
  const id = typeof req.query.id === 'string' ? req.query.id.slice(0, 128) : '';
  const phone = typeof req.query.phone === 'string' ? req.query.phone.replace(/\D/g, '') : '';
  const at = Date.parse(typeof req.query.at === 'string' ? req.query.at : '');
  if (!state.bot.orderPhone || phone !== state.bot.orderPhone) return res.status(403).json({ error: 'Voice orders come only from the order number.' });
  // The bot could not get the recording: logged here, and the user is told on WhatsApp (instead of silence).
  const failed = typeof req.query.failed === 'string' ? req.query.failed.slice(0, 20) : '';
  if (failed) {
    console.log(`Device bot could not pass on a voice order (${failed})`);
    voiceFailed(failed);
    return res.json({ ok: true });
  }
  if (!id || !Buffer.isBuffer(req.body) || !req.body.length) throw new BotInputError('Send the recording with ?id=…&at=…&phone=…');
  takeOrder({ externalId: `bot:${id}`, text: '', at: Number.isFinite(at) ? Math.min(at, Date.now()) : Date.now(), audio: req.body });
  res.json({ ok: true });
});

/** The phone's contacts (names and numbers), so the assistant can find someone by name. Replaces the last list. */
deviceApi.post('/contacts', (req, res) => {
  seen();
  res.json({ kept: receiveContacts(req.body) });
});

/** WhatsApp on the device needs linking (the code to show the user), or is linked again. */
deviceApi.post('/link', (req, res) => {
  seen();
  receiveLink(req.body, alertLink);
  res.json({ ok: true });
});

/** Waiting commands. Each command is handed over once. */
// With ?wait=25 the answer is held open (up to 25 s) until a command is ready: replies go out the moment MAAI writes them.
deviceApi.get('/commands', async (req, res) => {
  seen(deviceName(req.query.device));
  const wait = Math.min(Math.max(Number(req.query.wait) || 0, 0), 25) * 1000;
  // The response (not the request) closing early means the bot hung up.
  const commands = await waitForCommands(wait, (gone) => res.on('close', gone));
  if (!res.headersSent && !res.writableEnded) res.json({ commands, latest: latest() });
});

/** What happened with one command: {"ok": true|false, "output": "..."}. */
deviceApi.post('/commands/:id/result', (req, res) => {
  seen();
  const done = finishCommand(req.params.id, req.body);
  if (!done) return res.status(404).json({ error: 'No such command' });
  res.json({ id: done.id, status: done.status });
});

/** The newest bot, as deployed with MAAI, so the bot can update itself (it checks it before using it). */
const SCRIPT = fileURLToPath(new URL('../../device-bot/bot.mjs', import.meta.url));
/** Its version, read once: told to the bot with every answer, so it updates at once instead of at its 15-minute check. */
let newest: string | undefined;
const latest = (): string => {
  try {
    newest ??= /const VERSION = '([^']+)'/.exec(fs.readFileSync(SCRIPT, 'utf8'))?.[1] ?? '';
  } catch {
    newest = '';
  }
  return newest;
};
deviceApi.get('/script', (_req, res) => {
  seen();
  let code: string;
  try {
    code = fs.readFileSync(SCRIPT, 'utf8');
  } catch {
    return res.status(404).json({ error: 'No bot file on the server.' });
  }
  const version = /const VERSION = '([^']+)'/.exec(code)?.[1] ?? '';
  res.json({ version, code });
});

deviceApi.get('/status', (_req, res) => {
  seen();
  const { lastSync, waiting } = botStatus();
  res.json({ ok: true, lastSync, waiting, maxBatch: MAX_BATCH });
});

deviceApi.use((_req, res) => res.status(404).json({ error: 'Not found' }));

deviceApi.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof BotInputError) return res.status(400).json({ error: error.message });
  console.error(error);
  res.status(500).json({ error: 'Something went wrong.' });
});
