import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/snb-bot-test',
    MAAI_DATA_FILE: '/tmp/claude-0/snb-bot-test/store.json',
    MAAI_TRADING_FILE: '/tmp/claude-0/snb-bot-test/trading.json',
    MAAI_TRADING_QUOTES: 'sim',
    ASANA_TOKEN: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    GOOGLE_CALENDAR_ICS_URL: '',
  });
});
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: null }));

import { createBot, type Broker, type Command, type Result } from '../../snb-bot/core.mjs';
import { openLedger } from '../../snb-bot/ledger.mjs';
import { practiceBroker } from '../../snb-bot/brokers/practice.mjs';
import { createInnerApp, createOnlineSite } from '../site';
import { listen } from '../security/helpers';
import { resetTradeBotLimits } from '../routes/tradeBot';
import { createBotKey, halt, revokeBotKey, setMode, submit } from './executor';
import { refreshQuotes, resetQuotes } from './market';
import { tradingSummary } from './health';
import { resetTrading, trading } from './store';

/**
 * The SNB bot's StockSmart side (snb-bot/core.mjs), run against the real server: every safety rule in
 * docs/stocksmart-bot.md, with a broker that records what it was asked to do instead of touching SNB.
 */

let site: Awaited<ReturnType<typeof listen>>;
let url = '';
beforeAll(async () => {
  site = await listen(createOnlineSite(createInnerApp(), { password: 'correct-horse-battery', secret: 'test-secret' }));
  url = `http://127.0.0.1:${site.port}`;
});
afterAll(() => site.close());

let dir = '';
beforeEach(async () => {
  resetTrading();
  resetTradeBotLimits();
  resetQuotes();
  await refreshQuotes();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snb-bot-'));
});

/** A broker that would press Submit (and say it filled) only when StockSmart's last check says go. */
function recordingBroker(opts: { before?: () => void; shown?: Partial<Command>; throws?: boolean } = {}) {
  const submitted: Command[] = [];
  const broker: Broker = {
    name: 'test',
    session: () => Promise.resolve({ loggedIn: true }),
    quotes: () => Promise.resolve([]),
    account: () => Promise.resolve({ cash: 99_000, positions: [{ symbol: '2222', qty: 10, avgCost: 27.4 }] }),
    async place(cmd, { beforeSubmit, sameOrder }): Promise<Result> {
      opts.before?.();
      if (opts.throws) throw new Error('a screen the bot does not know');
      if (!sameOrder({ symbol: cmd.symbol, side: cmd.side, qty: cmd.qty, limitPrice: cmd.limitPrice, ...opts.shown })) return { status: 'failed', error: 'confirmation differs' };
      if (!(await beforeSubmit())) return { status: 'failed', error: 'told not to go' };
      submitted.push(cmd);
      return { status: 'filled', filledQty: cmd.qty, avgPrice: cmd.limitPrice, brokerOrderId: 'SNB42' };
    },
  };
  return { broker, submitted };
}

function setup(broker: Broker, now?: () => number) {
  const { key, signSecret } = createBotKey();
  const ledger = openLedger(dir);
  const log: string[] = [];
  const bot = createBot({ url, key, secret: signSecret, broker, ledger, log: (s) => log.push(s), now });
  return { bot, ledger, log, key, secret: signSecret };
}

/** Puts StockSmart in live mode with one order waiting, and fetches the commands as the bot would. */
async function liveOrder(key: string, qty = 10) {
  setMode('live', 'user', 'live');
  const order = submit('d1', '2222', 'buy', qty, 27.4);
  const res = await fetch(`${url}/trade/v1/commands`, { headers: { authorization: `Bearer ${key}` } });
  const { commands } = (await res.json()) as { commands: Command[] };
  return { order, commands };
}

describe('the SNB bot against StockSmart', () => {
  it('places a signed order once StockSmart says go, and the fill is booked in the live book', async () => {
    const { broker, submitted } = recordingBroker();
    const { bot, key, ledger } = setup(broker);
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    await bot.handle(commands[0]);
    expect(submitted).toHaveLength(1);
    expect(order).toMatchObject({ status: 'filled', filledQty: 10, brokerOrderId: 'SNB42' });
    expect(trading.books.live.positions[0]).toMatchObject({ symbol: '2222', qty: 10 });
    expect(ledger.get(order.id)).toMatchObject({ state: 'reported' });
  });

  it('never places the same command twice, even after a restart (rule 1)', async () => {
    const { broker, submitted } = recordingBroker();
    const { bot, key, secret } = setup(broker);
    await bot.heartbeat();
    const { commands } = await liveOrder(key);
    await bot.handle(commands[0]);
    await bot.handle(commands[0]);
    // A new bot process, same ledger on disk.
    const again = createBot({ url, key, secret, broker, ledger: openLedger(dir), log: () => {} });
    await again.heartbeat();
    await again.handle(commands[0]);
    expect(submitted).toHaveLength(1);
  });

  it('refuses a command whose signature or fields were changed, without opening the order form (rule 2)', async () => {
    let opened = false;
    const { broker } = recordingBroker({ before: () => (opened = true) });
    const { bot, key } = setup(broker);
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    await bot.handle({ ...commands[0], qty: 1000 });
    expect(opened).toBe(false);
    expect(order).toMatchObject({ status: 'failed', error: expect.stringMatching(/signature/) });
  });

  it('refuses a command that has expired by StockSmart’s clock (rule 2)', async () => {
    let opened = false;
    const { broker } = recordingBroker({ before: () => (opened = true) });
    const { bot, key } = setup(broker, () => Date.now());
    await bot.heartbeat();
    const { commands } = await liveOrder(key);
    const late = createBot({ url, key, secret: trading.bot.signSecret!, broker, ledger: openLedger(fs.mkdtempSync(path.join(os.tmpdir(), 'snb-late-'))), log: () => {}, now: () => Date.now() + 60 * 60_000 });
    await late.handle(commands[0]);
    expect(opened).toBe(false);
  });

  it('does not press Submit when the user pressed Stop while the form was being filled (rule 3)', async () => {
    const { broker, submitted } = recordingBroker({ before: () => halt('stop', 'user') });
    const { bot, key } = setup(broker);
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    await bot.handle(commands[0]);
    expect(submitted).toEqual([]);
    expect(order.status).toBe('failed');
  });

  it('stops when the confirmation screen differs from the command (rule 4)', async () => {
    const { broker, submitted } = recordingBroker({ shown: { qty: 100 } });
    const { bot, key } = setup(broker);
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    await bot.handle(commands[0]);
    expect(submitted).toEqual([]);
    expect(order).toMatchObject({ status: 'failed', error: 'confirmation differs' });
  });

  it('reports an unknown screen as failed and never retries it (rule 5)', async () => {
    const { broker } = recordingBroker({ throws: true });
    const { bot, key } = setup(broker);
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    await bot.handle(commands[0]);
    expect(order).toMatchObject({ status: 'failed', error: expect.stringMatching(/does not know/) });
  });

  it('after a crash mid-submission, does not try again and tells StockSmart to check SNB (rule 5)', async () => {
    const { broker } = recordingBroker();
    const { bot, key, ledger, secret } = setup(broker);
    await bot.heartbeat();
    const { order } = await liveOrder(key);
    ledger.write(order.id, { state: 'submitting' }); // the process died right after "go"
    const restarted = createBot({ url, key, secret, broker, ledger: openLedger(dir), log: () => {} });
    await restarted.recover();
    expect(order).toMatchObject({ status: 'unknown', error: expect.stringMatching(/may be at SNB/) });
    expect(trading.halted).toBe(true);
  });

  it('submits nothing when StockSmart has not answered for 3 minutes, and keeps the result to send later (rule 7)', async () => {
    const { broker, submitted } = recordingBroker();
    let skew = 0;
    let offline = false;
    const net = ((input: string | URL | Request, init?: RequestInit) => (offline ? Promise.reject(new Error('offline')) : fetch(input, init))) as typeof fetch;
    const { key, signSecret } = createBotKey();
    const ledger = openLedger(dir);
    const bot = createBot({ url, key, secret: signSecret, broker, ledger, log: () => {}, fetchImpl: net, now: () => Date.now() + skew });
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    offline = true;
    skew = 4 * 60_000;
    await bot.handle(commands[0]);
    expect(submitted).toEqual([]);
    expect(ledger.get(order.id)).toMatchObject({ state: 'done' }); // not reported yet
    // Back online: the result goes out on the next start.
    offline = false;
    await bot.recover();
    expect(ledger.get(order.id)).toMatchObject({ state: 'reported' });
    expect(order.status).toBe('failed');
  });

  it('heartbeats its SNB login and practice mode, and reports the account (rules 8 and 9)', async () => {
    const { bot } = setup(practiceBroker({ log: () => {} }));
    await bot.heartbeat();
    expect(tradingSummary().bot).toMatchObject({ connected: true, stale: false, brokerSession: true, practice: true });
    const real = setup(recordingBroker().broker);
    await real.bot.heartbeat();
    await real.bot.positions();
    expect(trading.books.live.positions[0]).toMatchObject({ symbol: '2222', qty: 10 });
    expect(tradingSummary().bot.practice).toBe(false);
  });

  it('in practice mode goes through every step and places nothing', async () => {
    const { bot, key } = setup(practiceBroker({ log: () => {} }));
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    await bot.handle(commands[0]);
    expect(order).toMatchObject({ status: 'failed', error: expect.stringMatching(/Practice mode: not placed/) });
    expect(trading.books.live.positions).toEqual([]);
  });

  it('runs on its own: picks up a new order within seconds and reports it, until stopped', async () => {
    const { broker, submitted } = recordingBroker();
    const { bot } = setup(broker);
    const running = bot.run();
    await vi.waitFor(() => expect(tradingSummary().bot.brokerSession).toBe(true));
    setMode('live', 'user', 'live');
    const order = submit('d2', '2222', 'buy', 5, 27.4);
    await vi.waitFor(() => expect(order.status).toBe('filled'), { timeout: 5000 });
    expect(submitted).toHaveLength(1);
    bot.stop('test over');
    await expect(running).resolves.toBe('test over');
  });

  /** A broker where the order rests at SNB after Submit (accepted, not filled), and can be cancelled or looked up. */
  function restingBroker(next: { status?: Result } = {}) {
    const calls: string[] = [];
    const broker: Broker = {
      name: 'resting',
      session: () => Promise.resolve({ loggedIn: true }),
      quotes: () => Promise.resolve([]),
      account: () => Promise.resolve(null),
      async place(_cmd, { beforeSubmit }) {
        if (!(await beforeSubmit())) return { status: 'failed', error: 'told not to go' };
        calls.push('submit');
        return { status: 'accepted', brokerOrderId: 'SNB5' };
      },
      async cancel(cmd, last) {
        calls.push(`cancel ${cmd.commandId} ${last.brokerOrderId}`);
        return { status: 'cancelled' };
      },
      orderStatus: () => Promise.resolve(next.status ?? null),
    };
    return { broker, calls };
  }

  it('cancels an order resting at SNB when the user presses Stop (signed cancel, confirmed, reported)', async () => {
    const { broker, calls } = restingBroker();
    const { bot, key } = setup(broker);
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    await bot.handle(commands[0]);
    expect(order).toMatchObject({ status: 'sent', brokerOrderId: 'SNB5', stage: expect.stringMatching(/accepted at SNB/) });
    halt('stop', 'user');
    const res = await fetch(`${url}/trade/v1/commands`, { headers: { authorization: `Bearer ${key}` } });
    const { cancels } = (await res.json()) as { cancels: unknown[] };
    expect(cancels).toHaveLength(1);
    await bot.handleCancel(cancels[0]);
    expect(calls).toEqual(['submit', `cancel ${order.id} SNB5`]);
    expect(order).toMatchObject({ status: 'cancelled', cancelAckedAt: expect.any(String) });
  });

  it('ignores a cancel whose signature does not match', async () => {
    const { broker, calls } = restingBroker();
    const { bot, key } = setup(broker);
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    await bot.handle(commands[0]);
    await bot.handleCancel({ commandId: order.id, issuedAt: new Date().toISOString(), sig: '00'.repeat(32) });
    expect(calls).toEqual(['submit']);
    expect(order.status).toBe('sent');
  });

  it('follows an order resting at SNB until it fills', async () => {
    const next: { status?: Result } = {};
    const { broker } = restingBroker(next);
    const { bot, key } = setup(broker);
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    await bot.handle(commands[0]);
    next.status = { status: 'filled', filledQty: 10, avgPrice: 27.4, brokerOrderId: 'SNB5' };
    await bot.follow();
    expect(order).toMatchObject({ status: 'filled', filledQty: 10 });
  });

  it('treats a crash after Submit as unknown, never as failed', async () => {
    const broker: Broker = { ...recordingBroker().broker, async place(_c, { beforeSubmit }) { await beforeSubmit(); throw new Error('the page went blank'); } };
    const { bot, key } = setup(broker);
    await bot.heartbeat();
    const { order, commands } = await liveOrder(key);
    await bot.handle(commands[0]);
    expect(order).toMatchObject({ status: 'unknown', error: expect.stringMatching(/after Submit/) });
    expect(trading.halted).toBe(true);
  });

  it('stops for good when its key is revoked', async () => {
    const { bot } = setup(recordingBroker().broker);
    await bot.heartbeat();
    revokeBotKey();
    await expect(bot.heartbeat()).rejects.toMatchObject({ fatal: true });
  });
});
