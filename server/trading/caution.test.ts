import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/trading-caution', MAAI_TRADING_FILE: '/tmp/claude-0/trading-caution/trading.json', MAAI_ROUNDS_DIR: '/tmp/claude-0/trading-caution/rounds', MAAI_TRADING_QUOTES: 'sim' });
});
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: null }));

import type { MarketItem } from './agents';
import { cautionNow, endCaution, gate, noteMarket } from './engine';
import { applyFill } from './portfolio';
import { currentQuotes, refreshQuotes, resetQuotes } from './market';
import { resetTrading, trading } from './store';

const OPEN = new Date('2026-11-01T08:00:00Z'); // Sunday 11:00 in Riyadh
const later = (h: number) => new Date(OPEN.getTime() + h * 3_600_000);
const attack: MarketItem = { headline: 'هجمات على منشآت نفطية في المنطقة الشرقية', severity: 'high', sectors: ['energy'], source: 'Reuters', confirmed: true };
const price = (s: string) => currentQuotes().get(s)!.price;
const buy = (id: string, symbol: string, qty = 300) => ({ id, symbol, side: 'buy' as const, qty, limitPrice: price(symbol), confidence: 0.8, rationale: 't' });

beforeEach(async () => {
  resetTrading();
  resetQuotes();
  await refreshQuotes(OPEN);
});

describe('caution mode', () => {
  it('turns on only for a confirmed, high-severity development, and tells the phone', () => {
    noteMarket([{ ...attack, severity: 'medium' }], OPEN);
    noteMarket([{ ...attack, confirmed: false }], OPEN);
    expect(cautionNow(OPEN)).toBeUndefined();
    noteMarket([attack], OPEN);
    expect(cautionNow(OPEN)).toEqual({ sectors: ['energy'] });
    expect(trading.events.at(-1)).toMatchObject({ type: 'system.caution', actor: 'risk', data: { on: true } });
  });

  it('refuses new buys in the sectors named, halves the others, and still lets holdings be sold', () => {
    applyFill(trading.books.paper, 'buy', '2222', 100, 27);
    noteMarket([attack], OPEN);
    expect(gate(buy('a', '2222'), OPEN)).toMatchObject({ verdict: 'veto', reasons: [expect.stringMatching(/no new buys in the energy sector/)] });
    const bank = gate(buy('b', '1120', 1000), OPEN);
    expect(bank.verdict).toBe('resize');
    expect(bank.qty * bank.limitPrice).toBeLessThanOrEqual(trading.limits.maxOrder / 2);
    expect(bank.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/half the per-order limit/)]));
    expect(gate({ ...buy('c', '2222', 100), side: 'sell' }, OPEN).verdict).not.toBe('veto');
  });

  it('lasts 24 hours after the last serious development, is extended by a new one, and the user can end it', () => {
    noteMarket([attack], OPEN);
    expect(cautionNow(later(23))).toBeDefined();
    expect(cautionNow(later(25))).toBeUndefined();
    noteMarket([{ ...attack, sectors: ['utilities'] }], later(20));
    expect(cautionNow(later(43))).toEqual({ sectors: ['energy', 'utilities'] });
    endCaution('user', later(21));
    expect(cautionNow(later(21))).toBeUndefined();
    expect(trading.events.at(-1)).toMatchObject({ type: 'system.caution', actor: 'user', data: { on: false } });
  });

  it('stays off when the user turned automatic caution off', () => {
    trading.cautionAuto = false;
    noteMarket([attack], OPEN);
    expect(cautionNow(OPEN)).toBeUndefined();
  });
});
