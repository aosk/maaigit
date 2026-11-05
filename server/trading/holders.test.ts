import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/trading-holders', MAAI_TRADING_FILE: '/tmp/claude-0/trading-holders/trading.json', MAAI_TRADING_QUOTES: 'sim' });
});

const create = vi.hoisted(() => vi.fn());
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: {}, create }));

import { applyHolders, checkListing, diffListings, holdersForDecision, holdersRound, holdersView, nameKey } from './holders';
import { resetTrading, trading } from './store';

const DAY1 = new Date('2026-11-01T08:00:00Z'); // Sunday, Tadawul open
const DAY2 = new Date('2026-11-02T08:00:00Z');
const PIF = 'صندوق الاستثمارات العامة';
const listing = (symbol: string, holders: [string, number][], asOf = '2026-10-31') => ({ symbol, holders: holders.map(([name, pct]) => ({ name, pct })), asOf, source: 'Argaam' });
const answer = (listings: unknown[], announcements: unknown[] = []) => ({ content: [{ type: 'text', text: JSON.stringify({ listings, announcements }) }] });

beforeEach(() => {
  resetTrading();
  create.mockReset();
});

describe('reading a listing', () => {
  it('matches names however they are written', () => {
    expect(nameKey('صندوق الاستثمارات العامّة')).toBe(nameKey(PIF));
    expect(nameKey('المؤسسة العامة للتأمينات الاجتماعية')).toBe(nameKey('مؤسسة العامه للتأمينات الاجتماعيه'));
  });

  it('keeps only a followed stock with stakes that add up', () => {
    expect(checkListing(listing('9999', [[PIF, 50]]))).toBeUndefined();
    expect(checkListing(listing('7010', [[PIF, 64], ['شركة أخرى', 40]]))).toBeUndefined(); // 104%
    expect(checkListing(listing('7010', [[PIF, 64], ['<script>x</script>', 0], [PIF, 64]]))!.holders).toEqual([{ name: PIF, pct: 64 }]);
  });
});

describe('what changed between two listings', () => {
  it('finds a new holder, an added and a trimmed stake, and an exit', () => {
    const changes = diffListings('1120', [{ name: 'أ', pct: 10 }, { name: 'ب', pct: 8 }, { name: 'ج', pct: 6 }], [{ name: 'أ', pct: 12 }, { name: 'ب', pct: 7.2 }, { name: 'د', pct: 5.1 }], '2026-11-02', 'Argaam');
    expect(changes.map((c) => [c.holder, c.kind, c.fromPct, c.toPct])).toEqual([
      ['أ', 'added', 10, 12],
      ['ب', 'trimmed', 8, 7.2],
      ['د', 'new', undefined, 5.1],
      ['ج', 'exited', 6, undefined],
    ]);
    // A move under half a point is noise.
    expect(diffListings('1120', [{ name: 'أ', pct: 10 }], [{ name: 'أ', pct: 10.3 }], '2026-11-02', 'x')).toEqual([]);
  });
});

describe('the daily run', () => {
  it('reads a few stocks once a trading day, records changes once, and makes an announcement official', async () => {
    create.mockResolvedValueOnce(answer([listing('7010', [[PIF, 64]]), listing('2222', [['الحكومة السعودية', 81.48], [PIF, 16]])]));
    await holdersRound(DAY1);
    await holdersRound(new Date(DAY1.getTime() + 3_600_000)); // same day: not again
    expect(create).toHaveBeenCalledTimes(1);
    const req = create.mock.calls[0][0] as { system: string; tools: { name: string; allowed_domains?: string[] }[] };
    expect(req.system).toMatch(/never guess or recall numbers/);
    expect(req.tools[1].allowed_domains).toEqual(['argaam.com', 'www.argaam.com', 'saudiexchange.sa', 'www.saudiexchange.sa']);
    expect(holdersView(DAY1)).toMatchObject({ covered: 2, total: 15, changes: [] }); // a first listing is not a change

    create.mockResolvedValueOnce(answer([listing('7010', [[PIF, 62], ['المؤسسة العامة للتأمينات الاجتماعية', 5.2]], '2026-11-02')], [
      { symbol: '7010', holder: 'المؤسسة العامة للتأمينات الاجتماعية', fromPct: 4.9, toPct: 5.2, date: '2026-11-02', source: 'Saudi Exchange', official: true },
      { symbol: '7010', holder: 'مجهول', fromPct: 6, toPct: null, date: '2026-11-02', source: 'x', official: false }, // no stake after: left out
    ]));
    await holdersRound(DAY2);
    const v = holdersView(DAY2);
    expect(v.changes.map((c) => [c.holder, c.kind, c.toPct, c.official])).toEqual(
      expect.arrayContaining([[PIF, 'trimmed', 62, false], ['المؤسسة العامة للتأمينات الاجتماعية', 'new', 5.2, true]]),
    );
    expect(v.changes).toHaveLength(2); // the listing and the announcement of the same change count once, as official
    expect(trading.events.filter((e) => e.text.startsWith('كبار الملاك')).length).toBe(2);
    expect(trading.events.find((e) => e.text.includes('تأمينات'))!.text).toMatch(/📢 إفصاح/);
  });

  it('groups each big investor’s stakes across the followed stocks', () => {
    applyHolders({ listings: [listing('7010', [[PIF, 64]]), listing('2222', [[PIF, 16]]), listing('1211', [[PIF, 67.2]])] }, DAY1);
    const pif = holdersView(DAY1).investors[0];
    expect(pif).toMatchObject({ name: PIF });
    expect(pif.stakes.map((s) => s.symbol)).toEqual(['1211', '7010', '2222']);
    expect(holdersForDecision(['2222'], DAY1).heldStocks).toEqual([{ symbol: '2222', holders: [{ name: PIF, pct: 16 }] }]);
  });

  it('never throws when the answer cannot be read', async () => {
    create.mockResolvedValueOnce({ content: [{ type: 'text', text: 'not json' }] });
    await expect(holdersRound(DAY1)).resolves.toBeUndefined();
    expect(holdersView(DAY1).covered).toBe(0);
  });
});
