import { describe, expect, it } from 'vitest';
import type { Quote } from '../../shared/trading';
import { marketPulse } from './pulse';

const AT = '2026-11-05T08:00:00.000Z';
const q = (symbol: string, changePct: number): Quote => ({ symbol, price: 100 * (1 + changePct / 100), prevClose: 100, asOf: AT, receivedAt: AT, source: 'yahoo' });
const index = (value: number, prevClose: number, avg = prevClose) => ({ value, prevClose, closes: Array.from({ length: 30 }, () => avg), asOf: AT, source: 'yahoo' as const });
const stocks = (moves: number[]) => moves.map((m, i) => q(String(1000 + i), m));

describe('the general market indicator', () => {
  it('reads a broad rise above the trend as rising strongly', () => {
    const p = marketPulse({ index: index(11_330, 11_200, 11_000), quotes: stocks([1.2, 0.8, 1.5, 0.6, 2, -0.3, 0.9, 1.1, 0.4, 0.7]), caution: false });
    expect(p.mood).toBe('strong_up');
    expect(p.score).toBeGreaterThanOrEqual(40);
    expect(p.index).toMatchObject({ changePct: 1.16, vsAvg20Pct: 3 });
    expect(p.breadth).toMatchObject({ up: 9, down: 1, flat: 0 });
    expect(p.risk).toBe('low');
    expect(p.reasons[0]).toMatch(/تاسي مرتفع/);
  });

  it('reads a broad fall as falling hard, and a quiet day as mixed', () => {
    expect(marketPulse({ index: index(11_000, 11_200, 11_300), quotes: stocks([-1, -2, -0.5, -1.5, 0.2]), caution: false }).mood).toBe('strong_down');
    expect(marketPulse({ index: index(11_205, 11_200), quotes: stocks([0.05, -0.05, 0.3, -0.2]), caution: false }).mood).toBe('mixed');
  });

  it('pulls the score down for a confirmed serious development or caution mode, not for a rumour', () => {
    const base = { index: index(11_250, 11_200), quotes: stocks([0.5, 0.4, -0.2]) };
    const calm = marketPulse({ ...base, caution: false });
    const rumour = marketPulse({ ...base, caution: false, market: [{ severity: 'high', headline: 'شائعة', confirmed: false }] });
    const serious = marketPulse({ ...base, caution: false, market: [{ severity: 'high', headline: 'هجوم مؤكد', confirmed: true }] });
    const cautious = marketPulse({ ...base, caution: true });
    expect(rumour.risk).toBe('medium');
    expect(serious).toMatchObject({ risk: 'high', riskHeadline: 'هجوم مؤكد' });
    expect(serious.score).toBe(calm.score - 20);
    expect(cautious.risk).toBe('high');
    expect(cautious.reasons).toContain('وضع الحذر مفعّل');
  });

  it('works from the followed stocks alone when TASI could not be read', () => {
    const p = marketPulse({ quotes: stocks([1, 1, 1, 1, -1]), caution: false });
    expect(p.index).toBeUndefined();
    expect(p.score).toBeGreaterThan(30);
    expect(marketPulse({ quotes: [], caution: false })).toMatchObject({ score: 0, mood: 'mixed', breadth: { up: 0, down: 0, flat: 0 } });
  });

  it('stays within -100 and +100', () => {
    expect(marketPulse({ index: index(13_000, 11_000, 10_000), quotes: stocks([9, 9, 9]), caution: false }).score).toBe(95); // today 50 + trend 15 + breadth 30
    expect(marketPulse({ index: index(9_000, 11_000, 12_000), quotes: stocks([-9, -9]), caution: true }).score).toBe(-100);
  });
});
