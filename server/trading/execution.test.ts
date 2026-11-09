import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-exec',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-exec/trading.json',
    MAAI_ROUNDS_DIR: '/tmp/claude-0/trading-exec/rounds',
    MAAI_TRADING_QUOTES: 'sim',
  });
});
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: null }));

import type { Quote } from '../../shared/trading';
import { decisionRound } from './agents';
import { roundsOf } from './archive';
import { gate, round } from './engine';
import { ackCommand, commandResult, createBotKey, halt, processOrders, resolveUnknown, resume, setMode, submit, takeCancels, takeCommands } from './executor';
import { applyFill } from './portfolio';
import { currentQuotes, injectQuote, noteBotQuote, refreshQuotes, resetQuotes } from './market';
import { resetTrading, trading } from './store';

/**
 * Step 1 of the review: paper fills that could really have happened, the trading rules enforced in code, an explicit
 * decider, an "unknown" state for an order the broker may have, Stop cancelling orders at SNB, and a record of every round.
 */

const OPEN = new Date('2026-11-01T08:00:00Z'); // Sunday 11:00 in Riyadh
const at = (min: number) => new Date(OPEN.getTime() + min * 60_000);
const iso = (min: number) => at(min).toISOString();

beforeEach(async () => {
  resetTrading();
  resetQuotes();
  await refreshQuotes(OPEN);
  fs.rmSync('/tmp/claude-0/trading-exec/rounds', { recursive: true, force: true });
});

/** A price that was true at the exchange at `asOfMin` and reached StockSmart at `receivedMin` (minutes after 11:00). */
const tick = (symbol: string, price: number, asOfMin: number, receivedMin: number) =>
  injectQuote({ ...(currentQuotes().get(symbol) as Quote), price, asOf: iso(asOfMin), receivedAt: iso(receivedMin) });

describe('paper fills, judged by when the price happened at the exchange', () => {
  it('never fills on a price from before the order, even when it arrives after it', () => {
    const order = submit('d1', '2222', 'buy', 10, 27.4, OPEN); // 11:00, expires 11:10
    tick('2222', 26.0, -5, 5); // true at 10:55, received at 11:05: far below the limit
    processOrders(at(5));
    expect(order).toMatchObject({ status: 'sent', filledQty: 0 });
    tick('2222', 27.6, 12, 27); // a price from after the window, delayed 15 minutes: now the order can be judged
    processOrders(at(27));
    expect(order).toMatchObject({ status: 'expired', filledQty: 0, error: 'never traded through its limit while it was open' });
    expect(trading.books.paper.positions).toEqual([]);
  });

  it('fills only when a price inside the window trades through the limit, and then at the limit', () => {
    const touch = submit('d2', '2222', 'buy', 10, 27.4, OPEN);
    tick('2222', 27.4, 3, 18); // exactly at the limit: a touch is not a fill
    tick('2222', 27.5, 11, 26);
    processOrders(at(26));
    expect(touch.status).toBe('expired');

    const through = submit('d3', '1120', 'buy', 10, 88, at(30));
    tick('1120', 87.8, 34, 49); // through the limit, 4 minutes into the window, arriving 15 minutes late
    processOrders(at(49));
    expect(through).toMatchObject({ status: 'filled', filledQty: 10, avgFillPrice: 88, fillPriceAsOf: iso(34) });
    expect(trading.events.find((e) => e.type === 'order.filled')?.data).toMatchObject({ quoteAsOf: iso(34), quoteReceivedAt: iso(49), quotePrice: 87.8 });
  });

  it('after Stop counts only what traded before it', () => {
    const before = submit('d4', '2222', 'buy', 10, 27.4, OPEN);
    const after = submit('d5', '1120', 'buy', 10, 88, OPEN);
    halt('test', 'user', at(4));
    tick('2222', 27.2, 3, 18); // traded through at 11:03, before the Stop
    tick('1120', 87.5, 6, 21); // traded through at 11:06, after the Stop
    processOrders(at(21));
    expect(before.status).toBe('filled');
    expect(after).toMatchObject({ status: 'cancelled', filledQty: 0 });
  });
});

describe('the trading rules, in the risk gate', () => {
  it('refuses a new position in the last 20 minutes, but still lets a holding be sold', async () => {
    applyFill(trading.books.paper, 'buy', '2222', 100, 27);
    const late = at(225); // 14:45 Riyadh
    await refreshQuotes(late);
    const price = currentQuotes().get('2222')!.price;
    expect(gate({ id: 'b', symbol: '1120', side: 'buy', qty: 1, limitPrice: currentQuotes().get('1120')!.price, confidence: 0.8, rationale: 't' }, late)).toMatchObject({ verdict: 'veto', reasons: [expect.stringMatching(/last 20 minutes/)] });
    expect(gate({ id: 's', symbol: '2222', side: 'sell', qty: 100, limitPrice: price, confidence: 0.8, rationale: 't' }, late).verdict).not.toBe('veto');
  });

  it('prices real money only from a fresh SNB quote, never from the delayed feed', () => {
    createBotKey();
    trading.bot.lastSeen = OPEN.toISOString();
    trading.bot.brokerSession = true;
    setMode('live', 'user', 'live', OPEN);
    trading.books.live.cash = 50_000;
    const buy = { id: 'l1', symbol: '2222', side: 'buy' as const, qty: 10, limitPrice: currentQuotes().get('2222')!.price, confidence: 0.8, rationale: 't' };
    expect(gate(buy, OPEN)).toMatchObject({ verdict: 'veto', reasons: [expect.stringMatching(/live Broker price/)] });
    noteBotQuote('2222', buy.limitPrice, undefined, OPEN);
    expect(gate({ ...buy, id: 'l2' }, at(1)).verdict).toBe('pass');
    noteBotQuote('1120', 88, undefined, OPEN);
    expect(gate({ ...buy, id: 'l3', symbol: '1120', limitPrice: 88 }, at(3))).toMatchObject({ verdict: 'veto' }); // 3 minutes old
  });
});

describe('who decides', () => {
  const reads = () => [{ symbol: '2222', price: 27.4, changePct: 1, trend: 'up' as const, score: 0.6, signal: 'buy' as const }];

  it('with Claude chosen and no key, decides nothing and says so (no silent switch to the rule)', async () => {
    expect(trading.decider).toBe('claude');
    expect(await decisionRound(reads(), [], 200, OPEN)).toEqual([]);
    expect(trading.events.at(-1)).toMatchObject({ type: 'agent.error', actor: 'decision' });
  });

  it('uses the plain rule only when it is chosen', async () => {
    trading.decider = 'rules';
    expect((await decisionRound(reads(), [], 200, OPEN)).map((d) => [d.symbol, d.side])).toEqual([['2222', 'buy']]);
  });
});

describe('an order SNB may or may not have', () => {
  function liveOrder() {
    createBotKey();
    trading.bot.lastSeen = OPEN.toISOString();
    setMode('live', 'user', 'live', OPEN);
    const order = submit('d9', '2222', 'buy', 10, 27.4, OPEN);
    takeCommands(OPEN);
    ackCommand(order.id, OPEN);
    return order;
  }

  it('is held as unknown, blocks its stock, and trading cannot resume until it is resolved', () => {
    const order = liveOrder();
    commandResult({ commandId: order.id, status: 'unknown', error: 'cut off after Submit' }, at(1));
    expect(order.status).toBe('unknown');
    expect(trading.halted).toBe(true);
    expect(resume(at(2))).toBe(false);
    expect(trading.halted).toBe(true);
    trading.halted = false; // even if trading ran, the stock stays blocked
    noteBotQuote('2222', 27.4, undefined, at(2));
    expect(gate({ id: 'x', symbol: '2222', side: 'buy', qty: 1, limitPrice: 27.4, confidence: 0.9, rationale: 't' }, at(2))).toMatchObject({ verdict: 'veto', reasons: [expect.stringMatching(/still open/)] });
    trading.halted = true;
    expect(resolveUnknown(order.id, false, at(3))).toBe(true);
    expect(order.status).toBe('cancelled');
    expect(resume(at(4))).toBe(true);
  });

  it('is resolved by the bot when it learns the outcome from SNB', () => {
    const order = liveOrder();
    commandResult({ commandId: order.id, status: 'unknown' }, at(1));
    commandResult({ commandId: order.id, status: 'filled', filledQty: 10, avgPrice: 27.4, brokerOrderId: 'SNB7' }, at(5));
    expect(order).toMatchObject({ status: 'filled', filledQty: 10 });
    expect(trading.books.live.positions[0]).toMatchObject({ symbol: '2222', qty: 10 });
  });
});

describe('Stop while an order rests at SNB', () => {
  it('sends a signed cancel to the bot until it confirms, and keeps what filled before', () => {
    createBotKey();
    trading.bot.lastSeen = OPEN.toISOString();
    setMode('live', 'user', 'live', OPEN);
    const order = submit('d10', '2222', 'buy', 10, 27.4, OPEN);
    takeCommands(OPEN);
    ackCommand(order.id, OPEN);
    commandResult({ commandId: order.id, status: 'accepted', brokerOrderId: 'SNB9' }, at(1));
    commandResult({ commandId: order.id, status: 'partial', filledQty: 4, avgPrice: 27.4 }, at(2));
    halt('stop', 'user', at(3));
    const [cancel] = takeCancels(at(3));
    expect(cancel.commandId).toBe(order.id);
    expect(cancel.sig).toBe(createHmac('sha256', trading.bot.signSecret!).update(['cancel', order.id, cancel.issuedAt].join('|')).digest('hex'));
    expect(takeCancels(at(3.5))).toEqual([]); // just sent
    expect(takeCancels(at(4.5)).map((c) => c.commandId)).toEqual([order.id]); // not confirmed: again
    ackCommand(order.id, at(5), 'cancel');
    expect(takeCancels(at(7))).toEqual([]);
    commandResult({ commandId: order.id, status: 'cancelled' }, at(6));
    expect(order).toMatchObject({ status: 'cancelled', filledQty: 4 });
    expect(trading.books.live.positions[0]).toMatchObject({ symbol: '2222', qty: 4 });
  });
});

describe('the record of every round', () => {
  it('keeps what the desk knew and did, holds included, to reconstruct it later', async () => {
    trading.decider = 'rules';
    await round(OPEN);
    const [r] = roundsOf('2026-11-01') as unknown as { quotes: unknown[]; technical: unknown[]; decision: unknown; verdicts: Record<string, unknown>[] }[];
    expect(r).toMatchObject({ day: '2026-11-01', mode: 'paper', decider: 'rules', limits: { capital: 100_000 }, book: { cash: 100_000 } });
    expect(r.quotes).toHaveLength(18);
    expect(r.quotes[0]).toEqual(expect.objectContaining({ asOf: expect.any(String), receivedAt: expect.any(String), source: 'sim' }));
    expect(r.technical).toHaveLength(18);
    expect(r.decision).toMatchObject({ source: 'rules', promptVersion: expect.stringMatching(/^momentum-/) });
    expect(Array.isArray(r.verdicts)).toBe(true);
    for (const v of r.verdicts) expect(v).toEqual(expect.objectContaining({ decisionId: expect.any(String), verdict: expect.any(String) }));
  });
});
