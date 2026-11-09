import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-crypto',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-crypto/trading.json',
    MAAI_ROUNDS_DIR: '/tmp/claude-0/trading-crypto/rounds',
    MAAI_TRADING_QUOTES: 'sim',
  });
});

/** Claude, replaced: each call is recorded so the prompts can be checked. */
const create = vi.hoisted(() => vi.fn());
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: {}, create }));

import { decisionRound, newsRound } from './agents';
import { inDesk } from './desk';
import { gate, round, tradingView } from './engine';
import { processOrders } from './executor';
import { currentQuotes, injectQuote, refreshQuotes, resetQuotes } from './market';
import { flushTrading, resetTrading, trading } from './store';
import { marketClock, UNIVERSE } from './tadawul';

const crypto = <T>(fn: () => T) => inDesk('crypto', fn);
/** A Saturday night: Tadawul and New York are closed, crypto is not. */
const SAT_NIGHT = new Date('2026-11-07T21:00:00Z');

beforeEach(async () => {
  create.mockReset();
  await crypto(async () => {
    resetTrading();
    resetQuotes();
    await refreshQuotes(SAT_NIGHT);
  });
});

describe('the crypto desk', () => {
  it('is open around the clock, in dollars, on paper, with the plain rule deciding by default', () => {
    crypto(() => {
      expect(marketClock(SAT_NIGHT)).toMatchObject({ open: true });
      expect(UNIVERSE.map((i) => i.symbol)).toEqual(['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'AVAX', 'LINK', 'LTC']);
      expect(currentQuotes().get('BTC')!.price).toBeGreaterThan(10_000);
      expect(tradingView(SAT_NIGHT)).toMatchObject({ market: 'crypto', currency: 'USD', fractional: true, liveAllowed: false, decider: 'rules', limits: { capital: 1000, maxOrder: 200, cycleMinutes: 30 } });
    });
    expect(marketClock(SAT_NIGHT).open).toBe(false); // Tadawul, untouched
  });

  it('buys a fraction of a coin within the dollar limit, and fills it on paper', () => {
    crypto(() => {
      const btc = currentQuotes().get('BTC')!;
      gate({ id: 'c1', symbol: 'BTC', side: 'buy', qty: 0.01, limitPrice: btc.price, confidence: 0.7, rationale: 'test' }, SAT_NIGHT);
      const order = trading.orders[0];
      // 0.01 BTC is ~$1,000: cut to the $200 order limit, in millionths of a coin.
      expect(order.qty).toBeGreaterThan(0.0015);
      expect(order.qty * order.limitPrice).toBeLessThanOrEqual(200);
      expect(Number(order.qty.toFixed(6))).toBe(order.qty); // millionths of a coin at most
      const later = new Date(SAT_NIGHT.getTime() + 60_000).toISOString();
      injectQuote({ ...btc, price: order.limitPrice - 1, asOf: later, receivedAt: later });
      processOrders(new Date(SAT_NIGHT.getTime() + 60_000));
      expect(trading.books.paper.positions[0]).toMatchObject({ symbol: 'BTC', qty: order.qty });
    });
  });

  it('refuses dust (under a dollar)', () => {
    crypto(() => {
      const ada = currentQuotes().get('ADA')!;
      gate({ id: 'c2', symbol: 'ADA', side: 'buy', qty: 1, limitPrice: ada.price, confidence: 0.7, rationale: 'test' }, SAT_NIGHT);
      expect(trading.orders).toHaveLength(0);
    });
  });

  it('runs a round on a Saturday night with the rule, archived in its own folder and saved in its own file', async () => {
    await crypto(async () => {
      await round(SAT_NIGHT);
      flushTrading();
    });
    // Claude only for the news (once, then every three hours): the plain rule decided.
    expect(create).toHaveBeenCalledTimes(1);
    expect((create.mock.calls[0][0] as { system: string }).system).toMatch(/news analyst on a cryptocurrency desk/);
    expect(fs.existsSync('/tmp/claude-0/trading-crypto/trading-crypto.json')).toBe(true);
    expect(fs.readdirSync('/tmp/claude-0/trading-crypto/rounds-crypto').length).toBeGreaterThan(0);
  });

  it('asks Claude, when chosen, with crypto rules: no leverage, fractions, wider stops', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ summary: 'لا شيء', decisions: [] }) }], model: 'm' });
    await crypto(async () => {
      trading.decider = 'claude';
      await decisionRound([{ symbol: 'BTC', price: 100_000, changePct: 1, trend: 'up', score: 0.5, signal: 'buy' }], [], 1440, SAT_NIGHT);
    });
    const system = (create.mock.calls[0][0] as { system: string }).system;
    expect(system).toMatch(/cryptocurrency trading desk/);
    expect(system).toMatch(/No leverage, margin, futures, lending or staking/);
    expect(system).toMatch(/fractions allowed/);
    expect(system).toMatch(/-8%/);
    expect(system).not.toMatch(/Tadawul/);
  });

  it('reads the news every three hours, about coins', async () => {
    create.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ items: [], market: [] }) }] });
    await crypto(async () => {
      await newsRound(SAT_NIGHT);
      await newsRound(new Date(SAT_NIGHT.getTime() + 2 * 3_600_000));
      await newsRound(new Date(SAT_NIGHT.getTime() + 3 * 3_600_000));
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect((create.mock.calls[0][0] as { system: string }).system).toMatch(/cryptocurrency desk/);
  });
});
