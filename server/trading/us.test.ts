import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-us',
    MAAI_DATA_FILE: '/tmp/claude-0/trading-us/store.json',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-us/trading.json',
    MAAI_ROUNDS_DIR: '/tmp/claude-0/trading-us/rounds',
    MAAI_TRADING_QUOTES: 'sim',
    ASANA_TOKEN: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    GOOGLE_CALENDAR_ICS_URL: '',
  });
});

// No Claude: the US desk decides with the plain rule.
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: null }));

import { inDesk } from './desk';
import { gate, round, tradingView } from './engine';
import { setMode } from './executor';
import { currentIndex, currentQuotes, refreshQuotes, resetQuotes } from './market';
import { nyseClock } from './nyse';
import { flushTrading, resetTrading, trading } from './store';
import { marketClock, UNIVERSE } from './tadawul';
import { createInnerApp, createOnlineSite } from '../site';
import { listen, raw } from '../security/helpers';

const us = <T>(fn: () => T) => inDesk('us', fn);
/** Monday 9 November 2026, 15:00 UTC: 10:00 in New York (open), 18:00 in Riyadh (Tadawul closed). */
const NY_OPEN = new Date('2026-11-09T15:00:00Z');

beforeEach(async () => {
  resetTrading();
  resetQuotes();
  await us(async () => {
    resetTrading();
    resetQuotes();
    await refreshQuotes(NY_OPEN);
  });
});

describe('the US market clock', () => {
  it('opens 9:30 to 16:00 New York time, through daylight saving, and closes on weekends and holidays', () => {
    expect(nyseClock(new Date('2026-11-09T14:29:00Z'))).toMatchObject({ open: false, minutesToChange: 1 }); // 9:29 EST
    expect(nyseClock(new Date('2026-11-09T14:30:00Z'))).toMatchObject({ open: true, minutesToChange: 390 });
    expect(nyseClock(new Date('2026-07-06T13:30:00Z')).open).toBe(true); // 9:30 EDT in summer
    expect(nyseClock(new Date('2026-11-07T16:00:00Z')).label).toBe('weekend'); // a Saturday
    expect(nyseClock(new Date('2026-11-26T16:00:00Z')).label).toBe('holiday'); // Thanksgiving
    expect(nyseClock(new Date('2026-11-27T18:30:00Z'))).toMatchObject({ open: false }); // early close at 13:00
  });
});

describe('two desks that never touch', () => {
  it('has its own list, prices, index, clock and book in dollars', () => {
    us(() => {
      expect(UNIVERSE.map((i) => i.symbol)).toContain('SPUS');
      expect(UNIVERSE).toHaveLength(19);
      expect(currentQuotes().size).toBe(19);
      expect(currentIndex()).toBeDefined();
      expect(marketClock(NY_OPEN).open).toBe(true);
      expect(tradingView(NY_OPEN)).toMatchObject({ market: 'us', currency: 'USD', halalList: true, liveAllowed: false, limits: { capital: 1000, maxOrder: 300 }, portfolioValue: 1000 });
    });
    // Tadawul is untouched: its own list, no US prices, closed at this hour, its own capital.
    expect(UNIVERSE.map((i) => i.symbol)).toContain('2222');
    expect(currentQuotes().size).toBe(0);
    expect(marketClock(NY_OPEN).open).toBe(false);
    expect(tradingView(NY_OPEN)).toMatchObject({ market: 'sa', currency: 'SAR', limits: { capital: 100_000 } });
  });

  it('trades on paper in its own book, and a US stop leaves Tadawul running', async () => {
    await us(async () => {
      const spus = currentQuotes().get('SPUS')!;
      gate({ id: 'u1', symbol: 'SPUS', side: 'buy', qty: 3, limitPrice: spus.price * 1.002, confidence: 0.7, rationale: 'test' }, NY_OPEN);
      expect(trading.orders[0]).toMatchObject({ symbol: 'SPUS', qty: 3, mode: 'paper' });
      // An order over the $300 limit is cut to whole shares within it.
      const msft = currentQuotes().get('MSFT')!;
      gate({ id: 'u2', symbol: 'MSFT', side: 'buy', qty: 2, limitPrice: msft.price, confidence: 0.7, rationale: 'test' }, NY_OPEN);
      expect(trading.events.find((e) => e.correlationId === 'u2' && e.type === 'risk.verdict')!.text).toBeTruthy();
      trading.halted = true;
      await round(NY_OPEN);
    });
    expect(trading.orders).toHaveLength(0);
    expect(trading.halted).toBe(false);
  });

  it('never goes live, and saves to its own file', () => {
    us(() => {
      setMode('live', 'user', 'test');
      expect(trading.mode).toBe('paper');
      trading.directives.push({ id: 'x', text: 'US only', at: NY_OPEN.toISOString() });
      flushTrading();
    });
    expect(JSON.parse(fs.readFileSync('/tmp/claude-0/trading-us/trading-us.json', 'utf8')).directives[0].text).toBe('US only');
    expect(trading.directives).toEqual([]);
  });

  it('runs a whole round with the plain rule on the US desk, archived in its own folder', async () => {
    expect(trading.events).toHaveLength(0);
    await us(async () => {
      trading.decider = 'rules';
      await round(NY_OPEN);
      // Decision, risk verdict and the paper order, on the US desk's own log.
      expect(trading.events.map((e) => e.actor)).toEqual(expect.arrayContaining(['decision', 'risk', 'executor']));
      expect(trading.orders[0]).toMatchObject({ mode: 'paper' });
      expect(UNIVERSE.some((i) => i.symbol === trading.orders[0].symbol)).toBe(true);
    });
    expect(fs.readdirSync('/tmp/claude-0/trading-us/rounds-us').length).toBeGreaterThan(0);
  });
});

describe('the API, ?market=us', () => {
  let site: Awaited<ReturnType<typeof listen>>;
  let cookie = '';
  beforeAll(async () => {
    site = await listen(createOnlineSite(createInnerApp(), { password: 'correct-horse-battery', secret: 'test-secret' }));
    const res = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: 'correct-horse-battery' }) });
    cookie = String(res.headers['set-cookie']).split(';')[0];
  });
  afterAll(() => site.close());

  it('serves and stops the US desk on its own, and refuses real money there', async () => {
    const headers = { cookie, 'content-type': 'application/json' };
    const view = JSON.parse((await raw(site.port, 'GET', '/api/trading?market=us', { headers })).body) as { market: string; universe: unknown[] };
    expect(view).toMatchObject({ market: 'us' });
    expect(view.universe).toHaveLength(19);
    await raw(site.port, 'POST', '/api/trading/halt?market=us', { headers, body: '{}' });
    expect(us(() => trading.halted)).toBe(true);
    expect(trading.halted).toBe(false);
    const live = await raw(site.port, 'POST', '/api/trading/mode?market=us', { headers, body: JSON.stringify({ mode: 'live', confirm: 'LIVE' }) });
    expect(live.status).toBe(409);
    expect(JSON.parse((await raw(site.port, 'GET', '/api/trading', { headers })).body)).toMatchObject({ market: 'sa' });
  });
});
