import { Router } from 'express';
import type { AgentId, TradeLimits } from '../../shared/trading.js';
import { askAgents } from '../trading/agents.js';
import { endCaution, round, tradingView } from '../trading/engine.js';
import { roundsOf } from '../trading/archive.js';
import { botStale, createBotKey, halt, resolveUnknown, resume, revokeBotKey, setMode } from '../trading/executor.js';
import { emit, eventsSince, onTradeEvent, saveTrading, trading } from '../trading/store.js';
import { marketClock, UNIVERSE } from '../trading/tadawul.js';
import { HttpError, lang, text, wrap } from './http.js';
import { deskConfig, inDesk } from '../trading/desk.js';

/**
 * StockSmart for the signed-in user: the state for the first paint, the live stream of the log, and the controls.
 * Stopping is one tap; starting again, going live and changing the limits are the user's alone and always logged.
 */
export const tradingRoutes = Router();

/** `?market=us` works on the US desk; anything else on Tadawul (see trading/desk.ts). */
tradingRoutes.use('/trading', (req, _res, next) => inDesk(req.query.market === 'us' ? 'us' : req.query.market === 'crypto' ? 'crypto' : 'sa', next));

tradingRoutes.get('/trading', (_req, res) => res.json(tradingView()));

/** The log as it happens (Server-Sent Events). Resumes from the last event the browser saw, so a dropped line loses nothing. */
tradingRoutes.get('/trading/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const since = Number(req.get('last-event-id') ?? req.query.since ?? 0);
  const send = (e: { id: number }) => res.write(`id: ${e.id}\nevent: trade\ndata: ${JSON.stringify(e)}\n\n`);
  res.write('retry: 5000\n\n');
  for (const e of Number.isFinite(since) && since > 0 ? eventsSince(since).slice(-200) : []) send(e);
  const off = onTradeEvent(send);
  const keepAlive = setInterval(() => res.write(': ok\n\n'), 25_000);
  req.on('close', () => {
    off();
    clearInterval(keepAlive);
  });
});

tradingRoutes.post('/trading/halt', (req, res) => {
  halt(text(req.body?.reason, 200) || 'أوقفته أنت', 'user');
  saveTrading();
  res.json(tradingView());
});

tradingRoutes.post('/trading/resume', (_req, res) => {
  if (!resume()) throw new HttpError(409, 'An order\'s status at SNB is unknown: check it in the SNB app and say whether it was executed first.');
  saveTrading();
  res.json(tradingView());
});

/** Real money needs the desktop bot connected and logged in at SNB, and the word LIVE typed to confirm. */
tradingRoutes.post('/trading/mode', (req, res) => {
  const mode = req.body?.mode;
  if (mode === 'paper') setMode('paper', 'user', 'رجعت للوضع التجريبي');
  else if (mode === 'live') {
    if (!deskConfig().liveAllowed) throw new HttpError(409, 'This market is paper only: no broker is connected for it yet.');
    if (req.body?.confirm !== 'LIVE') throw new HttpError(400, 'Type LIVE to confirm trading with real money.');
    if (!trading.bot.keyHash) throw new HttpError(409, 'Connect the SNB desktop bot first.');
    if (botStale()) throw new HttpError(409, 'The SNB desktop bot is not running.');
    if (!trading.bot.brokerSession) throw new HttpError(409, 'The SNB desktop bot is not logged in at SNB Capital.');
    setMode('live', 'user', 'بدأ التداول الحقيقي عبر بوت SNB');
  } else throw new HttpError(400, 'mode is paper or live');
  saveTrading();
  res.json(tradingView());
});

/** Each limit within a sensible range; every change is logged with what it was. */
const RANGES: Record<keyof TradeLimits, [number, number]> = {
  capital: [1_000, 10_000_000],
  maxOrder: [100, 1_000_000],
  maxPerSymbolPct: [1, 100],
  maxPerSectorPct: [1, 100],
  maxOrdersPerDay: [1, 100],
  dailyLossPct: [0.1, 20],
  cycleMinutes: [5, 120],
};

tradingRoutes.put('/trading/limits', (req, res) => {
  const changes: string[] = [];
  for (const [key, [min, max]] of Object.entries(RANGES) as [keyof TradeLimits, [number, number]][]) {
    const value = req.body?.[key];
    if (value === undefined) continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${key} must be between ${min} and ${max}.`);
    if (trading.limits[key] !== n) {
      changes.push(`${key}: ${trading.limits[key]} → ${n}`);
      trading.limits[key] = n;
    }
  }
  if (changes.length) emit('system.limits', 'user', `غيّرت الحدود: ${changes.join(' · ')}`);
  // Paper money follows the capital while nothing is invested (only when the capital itself changed).
  const paper = trading.books.paper;
  if (changes.some((c) => c.startsWith('capital:')) && paper.positions.length === 0 && trading.orders.every((o) => o.mode !== 'paper' || !['queued', 'sent', 'partial'].includes(o.status))) {
    paper.cash = trading.limits.capital;
    paper.dayStart.value = paper.cash;
  }
  saveTrading();
  res.json(tradingView());
});

/** A standing instruction to the agents ("no banks today"). */
tradingRoutes.post('/trading/directives', (req, res) => {
  const said = text(req.body?.text, 300);
  if (!said) throw new HttpError(400, 'Write the instruction.');
  if (trading.directives.length >= 20) throw new HttpError(400, 'At most 20 instructions. Remove one first.');
  trading.directives.push({ id: `dir_${Date.now().toString(36)}`, text: said, at: new Date().toISOString() });
  emit('user.directive', 'user', `توجيه جديد: ${said}`);
  saveTrading();
  res.json(tradingView());
});

tradingRoutes.delete('/trading/directives/:id', (req, res) => {
  const gone = trading.directives.find((d) => d.id === req.params.id);
  if (!gone) throw new HttpError(404, 'Not found');
  trading.directives = trading.directives.filter((d) => d !== gone);
  emit('user.directive', 'user', `ألغيت التوجيه: ${gone.text}`);
  saveTrading();
  res.json(tradingView());
});

/** Stocks or sectors the agents must leave alone (the risk gate refuses them). */
tradingRoutes.put('/trading/excluded', (req, res) => {
  const list: unknown = req.body?.excluded;
  if (!Array.isArray(list)) throw new HttpError(400, 'excluded is a list');
  const allowed = new Set([...UNIVERSE.map((i) => i.symbol), ...UNIVERSE.map((i) => i.sector)]);
  trading.excluded = [...new Set(list.filter((x): x is string => typeof x === 'string' && allowed.has(x)))];
  emit('user.directive', 'user', trading.excluded.length ? `استبعدت: ${trading.excluded.join('، ')}` : 'ما فيه استبعاد');
  saveTrading();
  res.json(tradingView());
});

const AGENTS: AgentId[] = ['technical', 'news', 'decision'];

tradingRoutes.post('/trading/agents/:id', (req, res) => {
  const id = req.params.id as AgentId;
  if (!AGENTS.includes(id)) throw new HttpError(404, 'Not found');
  const enabled = req.body?.enabled === true;
  trading.agents[id] = { ...trading.agents[id], enabled };
  emit('system.limits', 'user', `${enabled ? 'شغّلت' : 'أوقفت'} وكيل ${id === 'technical' ? 'التحليل الفني' : id === 'news' ? 'الأخبار' : 'القرار'}`);
  saveTrading();
  res.json(tradingView());
});

tradingRoutes.post('/trading/ask', wrap(async (req, res) => {
  const question = text(req.body?.question, 500);
  if (!question) throw new HttpError(400, 'Write your question.');
  res.json({ answer: await askAgents(question, lang(req.body?.lang)) });
}));

/** A round now, without waiting for the next one (only while the market is open and trading is on). */
tradingRoutes.post('/trading/round', wrap(async (_req, res) => {
  if (!marketClock(new Date()).open) throw new HttpError(409, 'The market is closed.');
  if (trading.halted) throw new HttpError(409, 'Trading is halted.');
  await round();
  res.json(tradingView());
}));

/** Who decides each round: Claude, or the plain rule. Chosen here only, never switched to on its own. */
tradingRoutes.put('/trading/decider', (req, res) => {
  const decider = req.body?.decider;
  if (decider !== 'claude' && decider !== 'rules') throw new HttpError(400, 'decider is claude or rules');
  if (trading.decider !== decider) {
    trading.decider = decider;
    emit('system.limits', 'user', decider === 'rules' ? 'القرار صار بالقاعدة البسيطة (بدون Claude)' : 'القرار صار بـ Claude');
    saveTrading();
  }
  res.json(tradingView());
});

/** Caution mode: ended now by the user, or whether it may turn on by itself. */
tradingRoutes.post('/trading/caution/end', (_req, res) => {
  endCaution('user');
  res.json(tradingView());
});
tradingRoutes.put('/trading/caution-auto', (req, res) => {
  if (typeof req.body?.on !== 'boolean') throw new HttpError(400, 'on is true or false');
  if (trading.cautionAuto !== req.body.on) {
    trading.cautionAuto = req.body.on;
    emit('system.limits', 'user', req.body.on ? 'وضع الحذر التلقائي: مفعّل' : 'وضع الحذر التلقائي: موقوف');
    saveTrading();
  }
  res.json(tradingView());
});

/** The user checked SNB about an order whose status was unknown: executed or not. */
tradingRoutes.post('/trading/orders/:id/resolve', (req, res) => {
  const executed = req.body?.executed;
  if (typeof executed !== 'boolean') throw new HttpError(400, 'executed is true or false');
  if (!resolveUnknown(String(req.params.id), executed)) throw new HttpError(404, 'No order with an unknown status by that id.');
  res.json(tradingView());
});

/** Every round of a day as archived (inputs, the decision step's exact input and output, verdicts), for review. */
tradingRoutes.get('/trading/rounds', (req, res) => {
  const day = typeof req.query.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  res.json({ day, rounds: roundsOf(day) });
});

/** The desktop bot's key and signing secret, shown once. A new one stops the old. */
tradingRoutes.post('/trading/bot/key', (_req, res) => {
  // The SNB desktop bot trades on Tadawul only.
  if (!deskConfig().saudi) throw new HttpError(409, 'The SNB bot is for Tadawul only.');
  res.json(createBotKey());
});
tradingRoutes.delete('/trading/bot/key', (_req, res) => {
  revokeBotKey();
  saveTrading();
  res.json(tradingView());
});
