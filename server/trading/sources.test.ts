import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-sources',
    MAAI_DATA_FILE: '/tmp/claude-0/trading-sources/store.json',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-sources/trading.json',
    MAAI_TRADING_QUOTES: 'yahoo',
  });
});

import { inDesk } from './desk';
import { filingItems, filingsRound, resetFilings } from './edgar';
import { currentQuotes, refreshQuotes, resetQuotes } from './market';
import { resetTrading, trading } from './store';

const NOW = new Date('2026-11-10T15:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** A Yahoo chart reply: 60 daily bars ending at `price`. */
const yahoo = (price: number) => json({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: Math.floor(NOW.getTime() / 1000) - 900 }, timestamp: Array.from({ length: 60 }, (_, i) => 1_700_000_000 + i * 86_400), indicators: { quote: [{ close: Array.from({ length: 60 }, () => price), volume: Array.from({ length: 60 }, () => 1000) }] } }] } });

describe('live coin prices', () => {
  beforeEach(() => inDesk('crypto', () => { resetTrading(); resetQuotes(); }));

  it('takes the exchange price over Yahoo, and falls back to Yahoo when the exchange does not answer', async () => {
    let coinbase = true;
    const fetcher = (async (url: string) => {
      if (String(url).includes('coinbase.com')) return coinbase ? json({ price: '101234.5', bid: '101234', ask: '101235', time: new Date(NOW.getTime() - 2000).toISOString() }) : json({}, 503);
      return yahoo(100_000);
    }) as unknown as typeof fetch;
    await inDesk('crypto', async () => {
      await refreshQuotes(NOW, fetcher);
      expect(currentQuotes().get('BTC')).toMatchObject({ price: 101234.5, source: 'exchange', prevClose: 100_000 });
      coinbase = false;
      await refreshQuotes(new Date(NOW.getTime() + 60_000), fetcher);
      expect(currentQuotes().get('BTC')).toMatchObject({ price: 100_000, source: 'yahoo' });
    });
  });

  it('leaves the stock desks on their own feed', async () => {
    const urls: string[] = [];
    const fetcher = (async (url: string) => (urls.push(String(url)), yahoo(25))) as unknown as typeof fetch;
    resetTrading();
    resetQuotes();
    await refreshQuotes(NOW, fetcher);
    expect(urls.some((u) => u.includes('coinbase'))).toBe(false);
  });
});

describe('US filings from the SEC', () => {
  const recent = (rows: [string, string, string, string][]) => ({ filings: { recent: { accessionNumber: rows.map((r) => r[0]), form: rows.map((r) => r[1]), items: rows.map((r) => r[2]), acceptanceDateTime: rows.map((r) => r[3]) } } });
  const sec = (calls: string[]) =>
    (async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push(`${String(url)} | ${init?.headers?.['User-Agent'] ?? ''}`);
      if (String(url).endsWith('company_tickers.json')) return json({ 0: { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' }, 1: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 2: { cik_str: 1, ticker: 'ZZZZ', title: 'Not followed' } });
      if (String(url).includes('CIK0001045810')) return json(recent([['0001-26-000010', '8-K', '2.02,9.01', '2026-11-10T13:05:00.000Z'], ['0001-26-000009', '4', '', '2026-11-10T12:00:00.000Z'], ['0001-26-000001', '8-K', '5.02', '2026-10-01T12:00:00.000Z']]));
      return json(recent([['0002-26-000050', '10-Q', '', '2026-11-09T21:00:00.000Z']]));
    }) as unknown as typeof fetch;

  beforeEach(() => { resetFilings(); inDesk('us', () => resetTrading()); });

  it('turns new 8-K and 10-Q filings into official news, once, and only on the US desk', async () => {
    const calls: string[] = [];
    await filingsRound(NOW, sec(calls)); // Saudi desk: nothing
    expect(calls).toEqual([]);
    await inDesk('us', async () => {
      await filingsRound(NOW, sec(calls));
      expect(calls[0]).toMatch(/company_tickers\.json \| MAAI/);
      expect(calls.filter((c) => c.includes('data.sec.gov/submissions/CIK'))).toHaveLength(2); // the two followed stocks; funds are not on the list
      const items = filingItems(NOW);
      expect(items.map((i) => [i.symbol, i.official, i.source])).toEqual([['NVDA', true, 'SEC EDGAR'], ['AAPL', true, 'SEC EDGAR']]);
      expect(items[0].headline).toBe('إفصاح لدى هيئة الأوراق الأمريكية (8-K): إعلان نتائج مالية');
      expect(items[1].headline).toMatch(/التقرير الربعي \(10-Q\)/);
      expect(trading.events.filter((e) => e.text.includes('SEC EDGAR'))).toHaveLength(2);
      // Within the half hour nothing is read; after it, the same filings are not logged again.
      await filingsRound(new Date(NOW.getTime() + 60_000), sec(calls));
      await filingsRound(new Date(NOW.getTime() + 31 * 60_000), sec(calls));
      expect(trading.events.filter((e) => e.text.includes('SEC EDGAR'))).toHaveLength(2);
    });
  });

  it('carries on when the SEC refuses, and says why', async () => {
    await inDesk('us', async () => {
      await filingsRound(NOW, async () => json({}, 403));
      expect(filingItems(NOW)).toEqual([]);
      expect(trading.edgar?.lastError).toBe('HTTP 403');
    });
  });
});
