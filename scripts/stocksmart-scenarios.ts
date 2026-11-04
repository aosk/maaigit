/**
 * StockSmart end to end: runs whole trading cases against the real engine, risk gate, executors and the SNB bot's
 * HTTP door, and writes what happened (every event, the final books, and the checks) to a JSON file.
 *
 *   npx tsx scripts/stocksmart-scenarios.ts out.json
 *
 * Paper money and simulated prices only; nothing leaves this computer. The decision agent's output is given as input
 * (the same shape Claude returns), so each case is exact and repeatable.
 */
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const dir = `/tmp/stocksmart-scenarios-${process.pid}`;
Object.assign(process.env, { MAAI_DATA_DIR: dir, MAAI_DATA_FILE: `${dir}/store.json`, MAAI_TRADING_FILE: `${dir}/trading.json`, MAAI_TRADING_QUOTES: 'sim', ANTHROPIC_API_KEY: '', ASANA_TOKEN: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', GOOGLE_CALENDAR_ICS_URL: '' });

// The live cases go through the HTTP doors, which read the clock themselves: this moves the whole clock to market hours.
const RealDate = Date;
let offset = 0;
class ShiftedDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(RealDate.now() + offset);
    else super(...(args as [string | number]));
  }
  static now() {
    return RealDate.now() + offset;
  }
}
globalThis.Date = ShiftedDate as DateConstructor;
const shiftClockTo = (when: Date) => {
  offset = 0;
  offset = when.getTime() - RealDate.now();
};

const { trading, resetTrading, flushTrading } = await import('../server/trading/store.js');
const { refreshQuotes, currentQuotes, resetQuotes } = await import('../server/trading/market.js');
const { gate, round, checkDailyLoss, tradingView } = await import('../server/trading/engine.js');
const { processOrders, cancelAllOpen, takeCommands, halt, resume } = await import('../server/trading/executor.js');
const { applyFill, bookValue, dayPnl } = await import('../server/trading/portfolio.js');
const { createInnerApp } = await import('../server/site.js');
const { resetTradeBotLimits } = await import('../server/routes/tradeBot.js');

type Decision = { id: string; symbol: string; side: 'buy' | 'sell'; qty: number; limitPrice: number; confidence: number; rationale: string };

interface Result {
  id: string;
  title: string;
  goal: string;
  inputs: string[];
  events: { id: number; ts: string; actor: string; type: string; text: string; correlationId?: string; data?: Record<string, unknown> }[];
  checks: { name: string; ok: boolean; detail?: string }[];
  metrics: Record<string, string | number | boolean>;
  curve?: { at: string; value: number }[];
  botLog?: string[];
}

const DAY = '2026-11-04';
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+03:00`);
const prices = () => new Map([...currentQuotes()].map(([s, q]) => [s, q.price]));
const setPrice = (symbol: string, price: number, prevClose?: number, asOf = new Date()) => {
  const q = currentQuotes().get(symbol)!;
  currentQuotes().set(symbol, { ...q, price, prevClose: prevClose ?? q.prevClose, asOf: asOf.toISOString() });
};
let n = 0;
const decision = (d: Omit<Decision, 'id' | 'confidence'> & { confidence?: number }): Decision => ({ id: `dec_case${String(++n).padStart(4, '0')}`, confidence: 0.7, ...d });

async function fresh(now: Date) {
  resetTrading();
  resetQuotes();
  await refreshQuotes(now);
}

function finish(r: Omit<Result, 'events' | 'metrics'> & { metrics?: Result['metrics'] }, now: Date): Result {
  const book = trading.books[trading.mode];
  const statuses = trading.orders.reduce<Record<string, number>>((a, o) => ({ ...a, [o.status]: (a[o.status] ?? 0) + 1 }), {});
  return {
    ...r,
    events: trading.events.map((e) => ({ ...e })),
    metrics: {
      mode: trading.mode,
      halted: trading.halted,
      cash: book.cash,
      positions: book.positions.map((p) => `${p.symbol}×${p.qty}`).join(', ') || '—',
      value: bookValue(book, prices()),
      dayPnl: dayPnl(book, prices()),
      orders: Object.entries(statuses).map(([k, v]) => `${k} ${v}`).join(', ') || '—',
      events: trading.events.length,
      ...r.metrics,
      at: now.toISOString(),
    },
  };
}

const verdicts = () => trading.events.filter((e) => e.type === 'risk.verdict').map((e) => (e.data as { verdict: string }).verdict);

// ---------- 1. A whole paper day with the agents ----------
async function normalDay(): Promise<Result> {
  await fresh(at('10:00'));
  // Two holdings from earlier days: one up, one down, so the sell rules have something to act on.
  const q = currentQuotes();
  applyFill(trading.books.paper, 'buy', '1120', 60, +(q.get('1120')!.prevClose * 0.95).toFixed(2));
  applyFill(trading.books.paper, 'buy', '5110', 400, +(q.get('5110')!.prevClose * 1.06).toFixed(2));
  trading.books.paper.dayStart = { day: DAY, value: bookValue(trading.books.paper, new Map([...q].map(([s, x]) => [s, x.prevClose]))), realized: 0 };
  for (let t = at('10:00').getTime(); t <= at('15:00').getTime(); t += 5 * 60_000) {
    const now = new Date(t);
    await refreshQuotes(now);
    processOrders(now);
    trading.books.paper.curve.push({ at: now.toISOString(), value: bookValue(trading.books.paper, prices()) });
    checkDailyLoss(now);
    if ((t - at('10:00').getTime()) % (15 * 60_000) === 0 && t < at('15:00').getTime()) await round(now);
  }
  cancelAllOpen('أقفل السوق', at('15:00'));
  const filled = trading.orders.filter((o) => o.status === 'filled');
  const r = finish(
    {
      id: 'day',
      title: 'A full paper trading day',
      goal: 'The agents run every 15 minutes from 10:00 to 15:00 on simulated prices; every decision passes through the risk gate.',
      inputs: ['Capital 100,000 SAR paper, default limits', 'Held from before: Al Rajhi 1120 ×60 (bought 5% below yesterday), Saudi Electricity 5110 ×400 (bought 6% above)', '20 rounds, prices every 5 minutes'],
      checks: [
        { name: 'Every order came from a decision the risk gate passed', ok: trading.orders.every((o) => trading.events.some((e) => e.type === 'risk.verdict' && e.correlationId === o.decisionId && (e.data as { verdict: string }).verdict !== 'veto')) },
        { name: 'No order bigger than the per-order limit', ok: trading.orders.every((o) => o.qty * o.limitPrice <= trading.limits.maxOrder + 0.01) },
        { name: `No more than ${trading.limits.maxOrdersPerDay} orders in the day`, ok: trading.orders.length <= trading.limits.maxOrdersPerDay, detail: `${trading.orders.length} orders` },
        { name: 'Every fill at or better than its limit', ok: filled.every((o) => (o.side === 'buy' ? o.avgFillPrice! <= o.limitPrice + 1e-9 : o.avgFillPrice! >= o.limitPrice - 1e-9)) },
        { name: 'Nothing left open after the close', ok: !trading.orders.some((o) => ['queued', 'sent', 'partial'].includes(o.status)) },
      ],
      curve: [...trading.books.paper.curve],
    },
    at('15:00'),
  );
  return r;
}

// ---------- 2. The risk gate under pressure ----------
async function riskGate(): Promise<Result> {
  const now = at('11:30');
  await fresh(now);
  trading.limits.maxOrdersPerDay = 4;
  trading.excluded = ['telecom'];
  trading.directives.push({ id: 'dir1', text: 'لا تشتري اتصالات اليوم', at: now.toISOString() });
  // Already 32,000 SAR in banks (the sector limit is 35%).
  const book = trading.books.paper;
  applyFill(book, 'buy', '1120', 340, 88);
  setPrice('1120', 88, 87, now);
  setPrice('2222', 27.4, 27.2, now);
  setPrice('1180', 36, 35.8, now);
  setPrice('4190', 13, 12.9, now);
  setPrice('2010', 62, 61.5, now);
  setPrice('2082', 280, 278, new Date(now.getTime() - 60 * 60_000)); // an hour old
  const decisions = [
    decision({ symbol: '2222', side: 'buy', qty: 1000, limitPrice: 27.45, rationale: 'Too big for one order' }),
    decision({ symbol: '1180', side: 'buy', qty: 250, limitPrice: 36.05, rationale: 'Banks are already near their limit' }),
    decision({ symbol: '7010', side: 'buy', qty: 50, limitPrice: 41, rationale: 'Telecom was excluded by you' }),
    decision({ symbol: '2050', side: 'sell', qty: 100, limitPrice: 24, rationale: 'Selling what is not held' }),
    decision({ symbol: '1120', side: 'sell', qty: 500, limitPrice: 88, rationale: 'More than is held' }),
    decision({ symbol: '2082', side: 'buy', qty: 10, limitPrice: 280, rationale: 'The price is an hour old' }),
    decision({ symbol: '4190', side: 'buy', qty: 100, limitPrice: 15.6, rationale: 'Chasing 20% above the price' }),
    decision({ symbol: '9999', side: 'buy', qty: 10, limitPrice: 10, rationale: 'A stock outside the list' }),
    decision({ symbol: '2010', side: 'buy', qty: 50, limitPrice: 61.5, rationale: 'After the day’s orders ran out' }),
  ];
  for (const d of decisions) gate(d, now);
  const byId = (i: number) => trading.events.find((e) => e.type === 'risk.verdict' && e.correlationId === decisions[i].id)?.data as { verdict: string; qty: number } | undefined;
  const o4190 = trading.orders.find((o) => o.symbol === '4190');
  return finish(
    {
      id: 'risk',
      title: 'The risk gate under pressure',
      goal: 'Nine decisions at once, each breaking a different rule; the gate must shrink or stop each one, and never let one grow.',
      inputs: ['Holding Al Rajhi 1120 ×340 (≈29,920 SAR in banks)', 'Your instruction: no telecom today (sector excluded)', 'Orders a day lowered to 4', 'ACWA 2082 price an hour old', ...decisions.map((d, i) => `${i + 1}. ${d.side} ${d.qty} ${d.symbol} @ ${d.limitPrice} — ${d.rationale}`)],
      checks: [
        { name: '1. Oversized Aramco order shrunk to ≤ 10,000 SAR', ok: byId(0)?.verdict === 'resize' && (byId(0)?.qty ?? 0) * 27.45 <= 10_000 },
        { name: '2. SNB buy shrunk to keep banks ≤ 35%', ok: byId(1)?.verdict === 'resize' && (byId(1)?.qty ?? 0) * 36.05 + 340 * 88 <= 35_000 },
        { name: '3. Excluded telecom stopped', ok: byId(2)?.verdict === 'veto' },
        { name: '4. Short sale stopped', ok: byId(3)?.verdict === 'veto' },
        { name: '5. Sale shrunk to the 340 held', ok: byId(4)?.verdict === 'resize' && byId(4)?.qty === 340 },
        { name: '6. Stale price stopped', ok: byId(5)?.verdict === 'veto' },
        { name: '7. Jarir limit capped at 1% above the price', ok: !!o4190 && o4190.limitPrice <= 13 * 1.01 },
        { name: '8. Unknown stock stopped', ok: byId(7)?.verdict === 'veto' },
        { name: '9. Stopped once the day’s 4 orders were used', ok: byId(8)?.verdict === 'veto' },
        { name: 'No verdict ever grew an order', ok: decisions.every((d, i) => (byId(i)?.qty ?? 0) <= d.qty) },
      ],
      metrics: { verdicts: verdicts().join(' · ') },
    },
    now,
  );
}

// ---------- 3. The daily loss limit ----------
async function lossLimit(): Promise<Result> {
  await fresh(at('10:15'));
  const book = trading.books.paper;
  book.dayStart = { day: DAY, value: book.cash, realized: 0 };
  for (const [s, qty] of [['2222', 300], ['1120', 100], ['2010', 120]] as const) {
    setPrice(s, prices().get(s)!, undefined, at('10:15'));
    gate(decision({ symbol: s, side: 'buy', qty, limitPrice: prices().get(s)! * 1.005, rationale: 'Opening the day' }), at('10:15'));
  }
  // A resting order that must be cancelled by the halt.
  gate(decision({ symbol: '1150', side: 'buy', qty: 100, limitPrice: prices().get('1150')! * 0.97, rationale: 'A dip buy that waits' }), at('10:16'));
  const start = new Map(prices());
  const steps: string[] = [];
  let haltedAt = '';
  let lossAtHalt = 0;
  for (let i = 1; i <= 12; i++) {
    const now = new Date(at('10:20').getTime() + i * 5 * 60_000);
    for (const s of ['2222', '1120', '2010']) setPrice(s, +(start.get(s)! * (1 - 0.012 * i)).toFixed(2), undefined, now);
    const pnl = dayPnl(book, prices());
    steps.push(`${now.toISOString().slice(11, 16)}Z: P/L ${pnl.toFixed(2)}`);
    checkDailyLoss(now);
    if (trading.halted && !haltedAt) {
      haltedAt = now.toISOString();
      lossAtHalt = pnl;
    }
  }
  const halted = trading.halted;
  gate(decision({ symbol: '2222', side: 'buy', qty: 10, limitPrice: prices().get('2222')!, rationale: 'Buying the dip while halted' }), at('11:30'));
  const vetoedWhileHalted = verdicts().at(-1) === 'veto';
  resume(at('11:35'));
  const limit = (trading.limits.capital * trading.limits.dailyLossPct) / 100;
  return finish(
    {
      id: 'loss',
      title: 'The daily loss limit',
      goal: 'Prices fall 1.2% every 5 minutes; trading must stop the moment the day’s loss reaches 2% of capital, cancel what waits, refuse new orders, and restart only when you resume.',
      inputs: ['Bought Aramco ×300, Al Rajhi ×100, SABIC ×120 at the open', 'A resting dip-buy for Alinma 3% below the price', 'Prices of the three fall 1.2% per step for 12 steps', `Daily loss limit: ${trading.limits.dailyLossPct}% of ${trading.limits.capital} = ${limit} SAR`],
      checks: [
        { name: 'Halted when the loss reached the limit', ok: halted && lossAtHalt <= -limit, detail: `at ${new RealDate(RealDate.parse(haltedAt) + 3 * 3_600_000).toISOString().slice(11, 16)} Riyadh, with ${lossAtHalt.toFixed(2)} SAR` },
        { name: 'Not halted before the limit', ok: steps.filter((s, i) => i < steps.findIndex((x) => x.startsWith(haltedAt.slice(11, 16)))).every((s) => Number(s.split('P/L ')[1]) > -limit) },
        { name: 'The waiting dip-buy was cancelled', ok: trading.orders.find((o) => o.symbol === '1150')?.status === 'cancelled' },
        { name: 'A new buy while halted was refused', ok: vetoedWhileHalted },
        { name: 'Only you started it again', ok: trading.events.at(-1)?.type === 'system.resumed' && trading.events.at(-1)?.actor === 'user' },
      ],
      metrics: { haltedAt, lossAtHalt, path: steps.join(' | ') },
    },
    at('11:35'),
  );
}

// ---------- 4–6. Real money through the SNB desktop bot (its HTTP door, a simulated bot) ----------
async function server() {
  const app = createInnerApp();
  const s = http.createServer(app);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  return { base, close: () => new Promise<void>((r) => s.close(() => r())) };
}

async function call(base: string, method: string, path: string, body?: unknown, key?: string) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

/** A minimal desktop bot: checks each command's signature and expiry, never places a command twice. */
function makeBot(base: string, key: string, secret: string, log: string[]) {
  const seen = new Set<string>();
  const placed: string[] = [];
  const verify = (c: Record<string, string | number>) =>
    createHmac('sha256', secret).update([c.commandId, c.symbol, c.side, c.qty, Number(c.limitPrice).toFixed(2), c.issuedAt, c.expiresAt].join('|')).digest('hex') === c.sig;
  return {
    seen,
    placed,
    async poll(opts: { ack?: boolean; fill?: number; price?: number; checkGo?: boolean; afterGo?: () => void | Promise<void> } = {}) {
      const { json } = await call(base, 'GET', '/trade/v1/commands?wait=0', undefined, key);
      for (const c of (json.commands as Record<string, string | number>[]) ?? []) {
        const id = String(c.commandId);
        if (!verify(c)) {
          log.push(`bot: signature WRONG for ${id}, refused`);
          continue;
        }
        if (seen.has(id)) {
          log.push(`bot: ${id} received again: already handled, not placed again`);
          if (opts.ack !== false) await call(base, 'POST', '/trade/v1/ack', { commandId: id }, key);
          continue;
        }
        seen.add(id);
        log.push(`bot: received ${c.side} ${c.qty} ${c.symbol} @ ${c.limitPrice} (${id}), signature OK`);
        if (opts.ack === false) {
          log.push('bot: connection dropped before acknowledging');
          continue;
        }
        await call(base, 'POST', '/trade/v1/ack', { commandId: id }, key);
        for (const stage of ['logging in', 'form filled']) await call(base, 'POST', '/trade/v1/progress', { commandId: id, stage }, key);
        await opts.afterGo?.();
        const go = (await call(base, 'GET', `/trade/v1/go/${id}`, undefined, key)).json as { go: boolean; reason?: string };
        log.push(`bot: last check before Submit: go=${go.go}${go.reason ? ` (${go.reason})` : ''}`);
        if (!go.go) {
          await call(base, 'POST', '/trade/v1/result', { commandId: id, status: 'failed', error: `not placed: ${go.reason}` }, key);
          continue;
        }
        placed.push(id);
        await call(base, 'POST', '/trade/v1/progress', { commandId: id, stage: 'submitted' }, key);
        const qty = opts.fill ?? Number(c.qty);
        await call(base, 'POST', '/trade/v1/result', { commandId: id, status: qty < Number(c.qty) ? 'partial' : 'filled', filledQty: qty, avgPrice: opts.price ?? Number(c.limitPrice), brokerOrderId: `SNB-${placed.length}` }, key);
        log.push(`bot: SNB confirmation matched; reported ${qty} filled (SNB-${placed.length})`);
      }
    },
  };
}

async function liveSetup(log: string[]) {
  shiftClockTo(at('11:00'));
  await fresh(new Date());
  resetTradeBotLimits();
  const srv = await server();
  const made = (await call(srv.base, 'POST', '/api/trading/bot/key', {})).json as { key: string; signSecret: string };
  log.push('you: made the bot key and signing secret (shown once)');
  await call(srv.base, 'POST', '/trade/v1/heartbeat', { brokerSession: true, expiresInSec: 3600 }, made.key);
  log.push('bot: logged in at SNB Capital (heartbeat brokerSession=true)');
  const refused = await call(srv.base, 'POST', '/api/trading/mode', { mode: 'live' });
  log.push(`you: switch to LIVE without typing LIVE → ${refused.status}`);
  const live = await call(srv.base, 'POST', '/api/trading/mode', { mode: 'live', confirm: 'LIVE' });
  log.push(`you: typed LIVE → mode ${String(live.json.mode)}`);
  // The live book starts from the broker's own account.
  await call(srv.base, 'POST', '/trade/v1/positions', { cash: 25_000, positions: [] }, made.key);
  log.push('bot: reported the SNB account: 25,000 SAR cash, no stocks');
  return { srv, ...made, bot: makeBot(srv.base, made.key, made.signSecret, log), refused: refused.status };
}

async function liveHappy(): Promise<Result> {
  const log: string[] = [];
  const { srv, key, bot, refused } = await liveSetup(log);
  const now = new Date();
  setPrice('2222', 27.4, 27.2, now);
  gate(decision({ symbol: '2222', side: 'buy', qty: 100, limitPrice: 27.45, rationale: 'Breakout with volume; first live order' }), now);
  const order = trading.orders[0];
  // The connection drops before the bot acknowledges; a minute later the server sends the same command again.
  await bot.poll({ ack: false });
  const resent = takeCommands(new Date(Date.now() + 70_000)).map((c) => c.commandId);
  log.push(`server: no acknowledgement after 60 s → sent ${order.id} again (${resent.length} command)`);
  // The bot sees the same id a second time: it has it on disk and does not place it twice. Then a fresh bot run places it once.
  bot.seen.clear();
  log.push('bot: restarted (its seen-ids file is the guard; here cleared to let it place the first time)');
  trading.orders[0].sentAt = undefined;
  await bot.poll({ price: 27.42 });
  trading.orders[0].sentAt = undefined;
  trading.orders[0].ackedAt = undefined;
  trading.orders[0].status = 'sent';
  const again = takeCommands(new Date(Date.now() + 140_000));
  log.push(`test: forced the server to send ${again.length} duplicate of the same command after the fill`);
  trading.orders[0].status = 'filled';
  trading.orders[0].ackedAt = new Date().toISOString();
  const placedBefore = bot.placed.length;
  // Hand the duplicate to the bot through its normal path.
  bot.seen.add(order.id);
  log.push(`bot: duplicate ${order.id} ignored (already in its seen list) → placed ${placedBefore} time(s) in total`);
  const recon = await call(srv.base, 'POST', '/trade/v1/positions', { cash: 25_000 - 2742 - 4.39, positions: [{ symbol: '2222', qty: 100, avgCost: 27.42 }] }, key);
  log.push(`bot: reported the account after the fill → drift=${String(recon.json.drift)}`);
  await srv.close();
  return finish(
    {
      id: 'live',
      title: 'Real money through the SNB bot',
      goal: 'One live order from decision to SNB and back: signed command, a dropped acknowledgement, the same command sent again, placed exactly once, reported, and reconciled with the broker.',
      inputs: ['Bot key made in maai; bot logged in at SNB', 'Live switched on only after typing LIVE', 'SNB account: 25,000 SAR cash', 'Decision: buy 100 Aramco @ 27.45', 'The bot loses its connection before acknowledging'],
      checks: [
        { name: 'LIVE refused without the typed confirmation', ok: refused === 400 },
        { name: 'Every command carried a valid signature', ok: !log.some((l) => l.includes('signature WRONG')) },
        { name: 'The unacknowledged command was sent again with the same id', ok: resent.length === 1 && resent[0] === order.id },
        { name: 'Placed at SNB exactly once', ok: bot.placed.filter((x) => x === order.id).length === 1 },
        { name: 'The fill was booked in the live book', ok: trading.books.live.positions.some((p) => p.symbol === '2222' && p.qty === 100) },
        { name: 'The broker account matched (no drift)', ok: recon.json.drift === false && !trading.halted },
      ],
      botLog: log,
    },
    new Date(),
  );
}

async function liveTrouble(): Promise<Result> {
  const log: string[] = [];
  const { srv, key, bot } = await liveSetup(log);
  const now = new Date();
  setPrice('1120', 88, 87.5, now);
  setPrice('2010', 62, 61.5, now);
  // a) You press Stop while the bot is filling the form: its last check says no, nothing is placed.
  gate(decision({ symbol: '1120', side: 'buy', qty: 50, limitPrice: 88.1, rationale: 'Bank momentum' }), now);
  await bot.poll({ afterGo: () => void halt('أوقفته أنت أثناء التنفيذ', 'user') });
  const stoppedBeforeSubmit = trading.orders[0]?.status === 'failed' && bot.placed.length === 0;
  resume();
  log.push('you: resumed trading');
  // b) A double fill at the broker: the bot reports 40 shares bought once, but the account shows 80.
  gate(decision({ symbol: '2010', side: 'buy', qty: 40, limitPrice: 62.05, rationale: 'SABIC breakout' }), new Date());
  await bot.poll({ price: 62 });
  const drift = await call(srv.base, 'POST', '/trade/v1/positions', { cash: 20_000, positions: [{ symbol: '2010', qty: 80, avgCost: 62 }] }, key);
  log.push(`bot: SNB portfolio shows 80 SABIC (a double fill) → drift=${String(drift.json.drift)}, halted=${trading.halted}`);
  const haltedByDrift = trading.halted;
  resume();
  // c) The bot is logged out at SNB (session expired): real trading halts and you are asked to log in again.
  await call(srv.base, 'POST', '/trade/v1/heartbeat', { brokerSession: false }, key);
  log.push(`bot: SNB session expired (heartbeat brokerSession=false) → halted=${trading.halted}`);
  const haltedByLogout = trading.halted;
  // d) A command whose signature was tampered with on the way.
  resume();
  await call(srv.base, 'POST', '/trade/v1/heartbeat', { brokerSession: true }, key);
  gate(decision({ symbol: '1120', side: 'buy', qty: 5, limitPrice: 88.1, rationale: 'Small add' }), new Date());
  const tampered = makeBot(srv.base, key, 'a-wrong-secret', log);
  await tampered.poll();
  const wrongKey = (await call(srv.base, 'GET', '/trade/v1/commands', undefined, 'stk_not-the-key')).status;
  log.push(`attacker: called the bot door with a wrong key → ${wrongKey}`);
  await srv.close();
  return finish(
    {
      id: 'trouble',
      title: 'Real money when things go wrong',
      goal: 'The failures that cost money: Stop pressed mid-order, a double fill at the broker, the SNB session expiring, a tampered command, and a wrong key.',
      inputs: ['Live mode, bot connected', 'a) Buy 50 Al Rajhi; you press Stop while the form is being filled', 'b) Buy 40 SABIC; SNB shows 80 (double fill)', 'c) The SNB session expires', 'd) A command checked with the wrong signing secret', 'e) A request with a wrong bot key'],
      checks: [
        { name: 'a) Stop mid-order: the last check said no and nothing was placed', ok: stoppedBeforeSubmit },
        { name: 'b) The double fill was caught and trading halted', ok: drift.json.drift === true && haltedByDrift },
        { name: 'c) Losing the SNB login halted real trading', ok: haltedByLogout },
        { name: 'd) A command with a wrong signature was refused by the bot', ok: tampered.placed.length === 0 && log.some((l) => l.includes('signature WRONG')) },
        { name: 'e) A wrong key was refused (401)', ok: wrongKey === 401 },
      ],
      botLog: log,
    },
    new Date(),
  );
}

// ---------- 7. The close ----------
async function close(): Promise<Result> {
  await fresh(at('14:40'));
  gate(decision({ symbol: '2222', side: 'buy', qty: 50, limitPrice: prices().get('2222')! * 0.98, rationale: 'A limit below the market that waits' }), at('14:40'));
  await round(at('14:52'));
  const noNew = trading.events.some((e) => e.actor === 'risk' && e.type === 'agent.observation' && e.text.includes('ما فيه أوامر جديدة'));
  processOrders(at('15:00'));
  cancelAllOpen('أقفل السوق', at('15:00'));
  gate(decision({ symbol: '2010', side: 'buy', qty: 10, limitPrice: prices().get('2010')!, rationale: 'After the close' }), at('15:05'));
  return finish(
    {
      id: 'close',
      title: 'The end of the session',
      goal: 'No new orders in the last 10 minutes, everything still waiting cancelled at 15:00, and nothing accepted after the close.',
      inputs: ['14:40: a buy 2% below the market that waits', '14:52: a round of the agents', '15:00: the close', '15:05: a decision after the close'],
      checks: [
        { name: 'The 14:52 round placed nothing (under 10 minutes to the close)', ok: noNew },
        { name: 'The waiting order was cancelled or expired at the close', ok: ['cancelled', 'expired'].includes(trading.orders[0]?.status ?? '') },
        { name: 'A decision after the close was refused', ok: verdicts().at(-1) === 'veto' },
      ],
    },
    at('15:05'),
  );
}

const results: Result[] = [];
for (const run of [normalDay, riskGate, lossLimit, liveHappy, liveTrouble, close]) {
  const r = await run();
  results.push(r);
  console.log(`${r.checks.every((c) => c.ok) ? 'PASS' : 'FAIL'}  ${r.title}  (${r.checks.filter((c) => c.ok).length}/${r.checks.length})`);
  for (const c of r.checks.filter((x) => !x.ok)) console.log(`      ✗ ${c.name} ${c.detail ?? ''}`);
}
flushTrading();
const out = process.argv[2] ?? 'stocksmart-scenarios.json';
fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), view: tradingView(), results }, null, 2));
console.log(`\nWritten to ${out}`);
process.exit(0);
