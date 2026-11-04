import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/trading-health', MAAI_TRADING_FILE: '/tmp/claude-0/trading-health/trading.json', MAAI_TRADING_QUOTES: 'sim' });
});
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: null }));

import { createBotKey, halt, setMode } from './executor';
import { tradingChecks, tradingSummary } from './health';
import { refreshQuotes, resetQuotes } from './market';
import { resetTrading, trading } from './store';

const OPEN = new Date('2026-11-01T08:00:00Z'); // Sunday 11:00 in Riyadh
const byId = (now: Date) => Object.fromEntries(tradingChecks(now).map((c) => [c.id, c]));

beforeEach(async () => {
  resetTrading();
  resetQuotes();
  await refreshQuotes(OPEN);
});

describe('StockSmart in the health checks', () => {
  it('reports the paper desk, fresh prices, the plain rule without Claude, and the bot as not needed yet', () => {
    const c = byId(OPEN);
    expect(c.stocksmart.status).toBe('ok');
    expect(c['stocksmart-prices'].status).toBe('ok');
    expect(c['stocksmart-agents']).toMatchObject({ status: 'warn', fix: expect.stringContaining('ANTHROPIC_API_KEY') });
    expect(c['snb-bot']).toMatchObject({ status: 'off', fix: expect.stringContaining('signing secret') });
    expect(tradingSummary(OPEN)).toMatchObject({ mode: 'paper', marketOpen: true, quotesFresh: true, bot: { connected: false } });
  });

  it('fails on old prices only while the market is open', () => {
    expect(byId(new Date(OPEN.getTime() + 60 * 60_000))['stocksmart-prices'].status).toBe('fail');
    expect(byId(new Date('2026-11-01T20:00:00Z'))['stocksmart-prices'].status).toBe('ok'); // 23:00, closed
  });

  it('warns when stopped, and fails on a missing or silent bot once trading is live', () => {
    halt('test', 'user', OPEN);
    expect(byId(OPEN).stocksmart.status).toBe('warn');
    createBotKey();
    trading.bot.lastSeen = OPEN.toISOString();
    trading.bot.brokerSession = true;
    trading.halted = false;
    setMode('live', 'user', 'live', OPEN);
    expect(byId(OPEN)['snb-bot'].status).toBe('ok');
    expect(byId(new Date(OPEN.getTime() + 10 * 60_000))['snb-bot'].status).toBe('fail');
  });
});
