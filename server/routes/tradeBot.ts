import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Position } from '../../shared/trading.js';
import { alertTrade } from '../notify.js';
import { ackCommand, botKeyMatches, commandProgress, commandResult, halt, reconcile, stillGo, takeCommands, type BotResult } from '../trading/executor.js';
import { noteBotQuote } from '../trading/market.js';
import { saveTrading, trading } from '../trading/store.js';

/**
 * The SNB desktop bot's own door, /trade/v1, apart from MAAI's device bot: its own key ("Authorization: Bearer stk_…"),
 * counted wrong tries, a request rate a bot needs and no more. It can only fetch commands and report what happened;
 * it cannot propose, approve or change anything. The protocol is written out in docs/stocksmart-bot.md.
 */
export const tradeBotApi = Router();

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;
const MAX_REQUESTS = 240;
const failures = new Map<string, { count: number; since: number }>();
let requests = { count: 0, since: 0 };

/** Forgets the counters (tests only). */
export function resetTradeBotLimits(): void {
  failures.clear();
  requests = { count: 0, since: 0 };
}

function botKey(req: Request, res: Response, next: NextFunction) {
  if (!trading.bot.keyHash) return res.status(404).json({ error: 'Not found' });
  const now = Date.now();
  const where = req.ip ?? 'unknown';
  const failed = failures.get(where);
  if (failed && now - failed.since < WINDOW_MS && failed.count >= MAX_FAILURES) return res.status(429).json({ error: 'Too many wrong keys. Try again later.' });
  const given = /^Bearer\s+(\S{1,200})$/i.exec(req.get('authorization') ?? '')?.[1] ?? '';
  if (!botKeyMatches(given)) {
    const fresh = !failed || now - failed.since >= WINDOW_MS;
    failures.set(where, { count: fresh ? 1 : failed.count + 1, since: fresh ? now : failed.since });
    return res.status(401).json({ error: 'The bot key is missing or wrong.' });
  }
  failures.delete(where);
  if (now - requests.since >= 60_000) requests = { count: 0, since: now };
  if (++requests.count > MAX_REQUESTS) return res.status(429).json({ error: 'Too many requests. Slow down.' });
  trading.bot.lastSeen = new Date(now).toISOString();
  next();
}

tradeBotApi.use(botKey);

const id = (value: unknown) => (typeof value === 'string' && /^ord_[0-9a-f]{16}$/.test(value) ? value : '');
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : NaN);

/** Waits up to `wait` seconds (at most 25) for commands, so they arrive within a second without polling hard. */
tradeBotApi.get('/commands', async (req, res) => {
  const wait = Math.min(25, Math.max(0, Number(req.query.wait) || 0));
  const until = Date.now() + wait * 1000;
  let closed = false;
  req.on('close', () => (closed = true));
  let commands = takeCommands();
  while (!commands.length && !closed && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1000));
    commands = takeCommands();
  }
  if (!closed) res.json({ commands, halted: trading.halted, mode: trading.mode, serverTime: new Date().toISOString() });
});

tradeBotApi.post('/ack', (req, res) => {
  const commandId = id(req.body?.commandId);
  res.status(commandId && ackCommand(commandId) ? 204 : 404).end();
});

/** Asked right before pressing "submit" at the broker. */
tradeBotApi.get('/go/:commandId', (req, res) => res.json(stillGo(id(req.params.commandId))));

tradeBotApi.post('/progress', (req, res) => {
  const commandId = id(req.body?.commandId);
  const stage = typeof req.body?.stage === 'string' ? req.body.stage.replace(/[\p{Cc}<>]/gu, ' ').trim() : '';
  if (!commandId || !stage) return res.status(400).json({ error: 'commandId and stage are needed' });
  commandProgress(commandId, stage);
  res.status(204).end();
});

const STATUSES = new Set(['filled', 'partial', 'rejected', 'failed']);

tradeBotApi.post('/result', (req, res) => {
  const b = req.body ?? {};
  const commandId = id(b.commandId);
  if (!commandId || !STATUSES.has(b.status)) return res.status(400).json({ error: 'commandId and a status (filled, partial, rejected, failed) are needed' });
  const result: BotResult = {
    commandId,
    status: b.status,
    filledQty: num(b.filledQty),
    avgPrice: num(b.avgPrice),
    brokerOrderId: typeof b.brokerOrderId === 'string' ? b.brokerOrderId.replace(/[^\w-]/g, '') : undefined,
    error: typeof b.error === 'string' ? b.error.replace(/[\p{Cc}<>]/gu, ' ') : undefined,
  };
  res.status(commandResult(result) ? 204 : 404).end();
});

/** The account as SNB Capital shows it: the truth the server's book is checked against. */
tradeBotApi.post('/positions', (req, res) => {
  const cash = num(req.body?.cash);
  const list: unknown = req.body?.positions;
  if (!(cash >= 0) || !Array.isArray(list) || list.length > 200) return res.status(400).json({ error: 'cash and positions are needed' });
  const positions: Position[] = [];
  for (const p of list as Record<string, unknown>[]) {
    const symbol = typeof p?.symbol === 'string' && /^\d{4}$/.test(p.symbol) ? p.symbol : '';
    const qty = num(p?.qty);
    if (!symbol || !Number.isInteger(qty) || qty < 0) return res.status(400).json({ error: 'Each position needs a 4-digit symbol and a whole quantity.' });
    positions.push({ symbol, qty, avgCost: num(p?.avgCost) > 0 ? num(p?.avgCost) : 0 });
  }
  res.json(reconcile({ cash, positions }));
});

/** Every minute or so: logged in at SNB or not, and the prices on the broker's screen (live, unlike the public feed). */
tradeBotApi.post('/heartbeat', (req, res) => {
  const was = trading.bot.brokerSession;
  trading.bot.brokerSession = req.body?.brokerSession === true;
  trading.bot.expiresInSec = num(req.body?.expiresInSec) >= 0 ? num(req.body.expiresInSec) : undefined;
  const quotes: unknown = req.body?.quotes;
  if (Array.isArray(quotes)) for (const q of quotes.slice(0, 50) as Record<string, unknown>[]) noteBotQuote(typeof q?.symbol === 'string' ? q.symbol : '', num(q?.price), num(q?.prevClose));
  // Logged out while trading real money: stop, and ask the user to log in again (the OTP is theirs).
  if (was && !trading.bot.brokerSession && trading.mode === 'live') {
    halt('بوت SNB خرج من حسابه في SNB Capital', 'system');
    void alertTrade(`trade:login:${Date.now()}`, 'بوت SNB يحتاج تسجيل دخول جديد (رمز التحقق على جوالك).').catch(() => {});
  }
  saveTrading();
  res.json({ halted: trading.halted, mode: trading.mode, serverTime: new Date().toISOString() });
});
