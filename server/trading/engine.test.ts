import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/trading-engine', MAAI_TRADING_FILE: '/tmp/claude-0/trading-engine/trading.json', MAAI_TRADING_QUOTES: 'sim' });
});

// No Claude: the decision agent falls back to its plain rule, and nothing is sent anywhere.
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: null }));

import { checkDailyLoss, gate, round, tradingView } from './engine';
import { ackCommand, botKeyMatches, commandResult, createBotKey, halt, processOrders, reconcile, resume, setMode, stillGo, submit, takeCommands } from './executor';
import { currentQuotes, refreshQuotes, resetQuotes } from './market';
import { applyFill } from './portfolio';
import { resetTrading, trading } from './store';

const OPEN = new Date('2026-11-01T08:00:00Z'); // Sunday 11:00 in Riyadh
const later = (ms: number) => new Date(OPEN.getTime() + ms);

beforeEach(async () => {
  resetTrading();
  resetQuotes();
  await refreshQuotes(OPEN);
});

const price = (symbol: string) => currentQuotes().get(symbol)!.price;

describe('a decision on its way to the market (paper)', () => {
  it('is checked by the risk gate, then filled at the market price, with every step on the log', () => {
    gate({ id: 'd1', symbol: '2222', side: 'buy', qty: 100, limitPrice: price('2222') * 1.005, confidence: 0.7, rationale: 'test' }, OPEN);
    const order = trading.orders[0];
    expect(order).toMatchObject({ status: 'filled', qty: 100, filledQty: 100, mode: 'paper' });
    expect(trading.books.paper.positions[0]).toMatchObject({ symbol: '2222', qty: 100 });
    expect(trading.events.map((e) => e.type)).toEqual(['risk.verdict', 'order.queued', 'order.filled']);
    expect(trading.events.every((e) => e.correlationId === 'd1')).toBe(true);
  });

  it('stops a decision the gate refuses, and nothing reaches the book', () => {
    gate({ id: 'd2', symbol: '2222', side: 'sell', qty: 10, limitPrice: price('2222'), confidence: 0.7, rationale: 'nothing held' }, OPEN);
    expect(trading.orders).toEqual([]);
    expect(trading.events[0]).toMatchObject({ type: 'risk.verdict', text: expect.stringMatching(/رفضت/) });
  });

  it('runs a whole round without Claude (the plain rule), only while the market is open', async () => {
    await round(OPEN);
    expect(trading.events.some((e) => e.actor === 'technical')).toBe(true);
    expect(tradingView(OPEN).agentsCanDecide).toBe(false);
  });
});

describe('the daily loss limit', () => {
  it('halts trading and cancels what is waiting once the day’s loss reaches the limit', () => {
    const book = trading.books.paper;
    applyFill(book, 'buy', '2222', 3000, price('2222'));
    // The price collapses 30%: well past 2% of 100,000.
    currentQuotes().set('2222', { ...currentQuotes().get('2222')!, price: price('2222') * 0.7 });
    checkDailyLoss(OPEN);
    expect(trading.halted).toBe(true);
    expect(trading.events.at(-1)?.type).toBe('system.halted');
  });

  it('fills nothing that was waiting while trading is stopped', () => {
    const order = submit('d3', '2222', 'buy', 10, price('2222') * 0.9, OPEN); // below the price: waits
    halt('test', 'user', OPEN);
    currentQuotes().set('2222', { ...currentQuotes().get('2222')!, price: price('2222') * 0.85 });
    processOrders(later(60_000));
    expect(order.status).toBe('sent');
    expect(trading.books.paper.positions).toEqual([]);
  });

  it('can be started again only by the user', () => {
    halt('test', 'risk', OPEN);
    expect(trading.halted).toBe(true);
    resume(OPEN);
    expect(trading.halted).toBe(false);
    expect(trading.events.at(-1)).toMatchObject({ type: 'system.resumed', actor: 'user' });
  });
});

describe('the SNB desktop bot', () => {
  function liveOrder() {
    createBotKey();
    trading.bot.lastSeen = OPEN.toISOString();
    setMode('live', 'user', 'live', OPEN);
    return submit('d9', '2222', 'buy', 10, 27.4, OPEN);
  }

  it('has its own key, shown once and kept only as a hash', () => {
    const { key, signSecret } = createBotKey();
    expect(key).toMatch(/^stk_/);
    expect(botKeyMatches(key)).toBe(true);
    expect(botKeyMatches(key + 'x')).toBe(false);
    expect(JSON.stringify(trading.bot)).not.toContain(key);
    expect(signSecret).toHaveLength(64);
  });

  it('gets each live order as a signed command, sent again until acknowledged, then not again', () => {
    const order = liveOrder();
    const [cmd] = takeCommands(OPEN);
    expect(cmd.commandId).toBe(order.id);
    const expected = createHmac('sha256', trading.bot.signSecret!).update([cmd.commandId, cmd.symbol, cmd.side, cmd.qty, cmd.limitPrice.toFixed(2), cmd.issuedAt, cmd.expiresAt].join('|')).digest('hex');
    expect(cmd.sig).toBe(expected);
    expect(takeCommands(later(10_000))).toEqual([]); // just sent
    expect(takeCommands(later(70_000)).map((c) => c.commandId)).toEqual([order.id]); // not acknowledged: again, same id
    ackCommand(order.id, later(71_000));
    expect(takeCommands(later(200_000))).toEqual([]);
  });

  it('gets nothing while halted or in paper mode, and is told not to go if that changed after the command came', () => {
    const order = liveOrder();
    expect(stillGo(order.id, OPEN)).toEqual({ go: true });
    halt('stop', 'user', OPEN);
    expect(takeCommands(OPEN)).toEqual([]);
    expect(stillGo(order.id, OPEN)).toEqual({ go: false, reason: 'halted' });
  });

  it('books a reported fill in the live book, and halts on a fill without a price', () => {
    const order = liveOrder();
    commandResult({ commandId: order.id, status: 'filled', filledQty: 10, avgPrice: 27.4, brokerOrderId: 'SNB1' }, OPEN);
    expect(order).toMatchObject({ status: 'filled', filledQty: 10, brokerOrderId: 'SNB1' });
    expect(trading.books.live.positions[0]).toMatchObject({ symbol: '2222', qty: 10 });
    const second = submit('d10', '1120', 'buy', 5, 88, OPEN);
    commandResult({ commandId: second.id, status: 'filled', filledQty: 5 }, OPEN);
    expect(trading.halted).toBe(true);
  });

  it('takes the broker’s account as the truth, and halts when it differs from what was expected', () => {
    const order = liveOrder();
    commandResult({ commandId: order.id, status: 'filled', filledQty: 10, avgPrice: 27.4 }, OPEN);
    expect(reconcile({ cash: 5000, positions: [{ symbol: '2222', qty: 10, avgCost: 27.4 }] }, OPEN).drift).toBe(false);
    // A double fill: the broker holds 20.
    expect(reconcile({ cash: 4726, positions: [{ symbol: '2222', qty: 20, avgCost: 27.4 }] }, OPEN).drift).toBe(true);
    expect(trading.halted).toBe(true);
    expect(trading.books.live.positions[0].qty).toBe(20);
  });

  it('starts the live day from the broker’s first report, not from an empty book', () => {
    reconcile({ cash: 25_000, positions: [{ symbol: '2222', qty: 100, avgCost: 27 }] }, OPEN);
    expect(trading.books.live.dayStart.value).toBe(27_700);
    expect(trading.halted).toBe(false);
  });

  it('lets go of an order the bot took but never finished, and stops trading until the user checks SNB', () => {
    const order = liveOrder();
    takeCommands(OPEN);
    ackCommand(order.id, OPEN);
    processOrders(new Date(Date.parse(order.expiresAt) + 5 * 60_000));
    expect(order.status).toBe('sent'); // still the bot's
    processOrders(new Date(Date.parse(order.expiresAt) + 31 * 60_000));
    expect(order.status).toBe('failed');
    expect(trading.halted).toBe(true);
  });

  it('ignores a repeated or late fill report instead of booking it again', () => {
    const order = liveOrder();
    commandResult({ commandId: order.id, status: 'partial', filledQty: 6, avgPrice: 27.4 }, OPEN);
    commandResult({ commandId: order.id, status: 'partial', filledQty: 4, avgPrice: 27.4 }, OPEN);
    commandResult({ commandId: order.id, status: 'partial', filledQty: 6, avgPrice: 27.4 }, OPEN);
    expect(order.filledQty).toBe(6);
    expect(trading.books.live.positions[0].qty).toBe(6);
  });

  it('never carries paper orders into live, or the other way', () => {
    const paper = submit('d11', '1120', 'buy', 1, 1, OPEN); // a limit far below the price: stays open
    expect(paper.status).toBe('sent');
    createBotKey();
    setMode('live', 'user', 'live', OPEN);
    expect(paper.status).toBe('cancelled');
  });
});
