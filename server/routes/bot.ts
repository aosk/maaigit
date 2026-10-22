import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { BotInputError, MAX_BATCH, botStatus, finishCommand, keyMatches, receiveContacts, receiveFromBot, receiveLink, seen, takeCommands, waitForCommands } from '../bot.js';
import { alertLink } from '../notify.js';
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
  const delivered = receiveFromBot(req.body);
  res.json({ ...delivered, commands: takeCommands() });
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
  if (!res.headersSent && !res.writableEnded) res.json({ commands });
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
