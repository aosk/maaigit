import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-fundamentals',
    MAAI_DATA_FILE: '/tmp/claude-0/trading-fundamentals/store.json',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-fundamentals/trading.json',
    MAAI_TRADING_QUOTES: 'sim',
  });
});

const create = vi.hoisted(() => vi.fn());
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: {}, create }));

import { inDesk } from './desk';
import { applyFundamentals, fundamentalsForDecision, fundamentalsRound, fundamentalsView } from './fundamentals';
import { resetTrading } from './store';

const reply = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const SUN = new Date('2026-11-01T08:00:00Z');
const row = (symbol: string, over: Record<string, unknown> = {}) => ({ symbol, pe: 16.2, epsGrowthPct: 8, revenueGrowthPct: 5, dividendYieldPct: 4.1, period: 'Q3 2026', note: 'نمو في الأرباح', source: 'Argaam', ...over });

beforeEach(() => {
  create.mockReset();
  resetTrading();
});

describe('the fundamentals agent', () => {
  it('keeps only numbers it can trust, for companies it asked about', () => {
    const stored = applyFundamentals(
      { companies: [row('2222'), row('1120', { pe: -5, epsGrowthPct: 5000 }), row('9999'), row('4002'), row('1180', { source: '' }), row('2010', { pe: null, epsGrowthPct: null, revenueGrowthPct: null, dividendYieldPct: null })] },
      ['2222', '1120', '9999', '1180', '2010'],
      SUN,
    );
    expect(stored).toBe(2);
    const v = fundamentalsView()!;
    expect(v.companies.map((c) => c.symbol)).toEqual(['2222', '1120']);
    expect(v.companies[0]).toMatchObject({ pe: 16.2, dividendYieldPct: 4.1, period: 'Q3 2026' });
    // A negative P/E and an impossible growth figure are dropped; what was believable stays.
    expect(v.companies[1]).toMatchObject({ revenueGrowthPct: 5 });
    expect(v.companies[1].pe).toBeUndefined();
    expect(v.companies[1].epsGrowthPct).toBeUndefined();
    expect(fundamentalsForDecision()[0]).toEqual({ symbol: '2222', pe: 16.2, epsGrowthPct: 8, revenueGrowthPct: 5, dividendYieldPct: 4.1, period: 'Q3 2026' });
  });

  it('reads six companies once a trading day, the unread first, and each again only after 90 days', async () => {
    create.mockImplementation(async (req: { system: string }) => reply({ companies: [...req.system.matchAll(/(\d{4}) [A-Z]/g)].map((m) => row(m[1])) }));
    await fundamentalsRound(SUN);
    await fundamentalsRound(new Date(SUN.getTime() + 3_600_000));
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ purpose: 'trading-fundamentals' });
    expect(fundamentalsView()).toMatchObject({ covered: 6, total: 18 });
    await fundamentalsRound(new Date(SUN.getTime() + 86_400_000));
    await fundamentalsRound(new Date(SUN.getTime() + 2 * 86_400_000));
    expect(fundamentalsView()).toMatchObject({ covered: 18 });
    // All read: nothing more is asked until the 90 days pass.
    await fundamentalsRound(new Date(SUN.getTime() + 3 * 86_400_000));
    expect(create).toHaveBeenCalledTimes(3);
    await fundamentalsRound(new Date(SUN.getTime() + 91 * 86_400_000));
    expect(create).toHaveBeenCalledTimes(4);
  });

  it('skips the funds on the US desk, and coins altogether', async () => {
    create.mockResolvedValue(reply({ companies: [] }));
    await inDesk('us', async () => {
      resetTrading();
      await fundamentalsRound(SUN);
      const system = (create.mock.calls[0][0] as { system: string }).system;
      expect(system).toMatch(/NVDA/);
      expect(system).not.toMatch(/SPUS|HLAL|SPSK/);
      expect(fundamentalsView()).toMatchObject({ total: 11 });
    });
    await inDesk('crypto', async () => {
      resetTrading();
      await fundamentalsRound(SUN);
      expect(fundamentalsView()).toBeNull();
    });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
