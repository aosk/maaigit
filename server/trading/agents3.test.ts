import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-agents3',
    MAAI_DATA_FILE: '/tmp/claude-0/trading-agents3/store.json',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-agents3/trading.json',
    MAAI_TRADING_QUOTES: 'sim',
  });
});

const create = vi.hoisted(() => vi.fn());
vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: {}, create }));

import { blackoutNow, calendarRound, checkEvents, upcoming } from './calendar';
import { inDesk } from './desk';
import { gate } from './engine';
import { currentQuotes, refreshQuotes, resetQuotes } from './market';
import { weeklyReview, weekStats } from './review';
import { applyShariah, shariahRound } from './shariah';
import { emit, resetTrading, trading } from './store';

const reply = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
/** Sunday 1 November 2026, 11:00 Riyadh: Tadawul open. */
const SUN = new Date('2026-11-01T08:00:00Z');

beforeEach(async () => {
  create.mockReset();
  resetTrading();
  resetQuotes();
  await refreshQuotes(SUN);
});

describe('the calendar agent', () => {
  it('keeps only events it can trust: in the next two weeks, a known kind, followed stocks', () => {
    const events = checkEvents(
      [
        { date: '2026-11-02', timeRiyadh: '', kind: 'earnings', symbols: ['2222'], title: 'نتائج أرامكو', source: 'Saudi Exchange', confirmed: true },
        { date: '2026-11-02', timeRiyadh: '', kind: 'earnings', symbols: ['9999'], title: 'شركة غير متابعة', source: 'x', confirmed: true },
        { date: '2026-12-30', timeRiyadh: '', kind: 'rates', symbols: [], title: 'بعيد', source: 'x', confirmed: true },
        { date: '2026-10-30', timeRiyadh: '', kind: 'rates', symbols: [], title: 'مضى', source: 'x', confirmed: true },
        { date: '2026-11-05', timeRiyadh: '22:00', kind: 'rates', symbols: [], title: 'قرار الفيدرالي', source: 'federalreserve.gov', confirmed: true },
        { date: '2026-11-03', timeRiyadh: 'soon', kind: 'party', symbols: [], title: 'x', source: 'x', confirmed: true },
      ],
      '2026-11-01',
    );
    expect(events.map((e) => [e.date, e.kind, e.symbols])).toEqual([
      ['2026-11-02', 'earnings', ['2222']],
      ['2026-11-05', 'rates', []],
    ]);
  });

  it('reads once a trading day, and the risk gate holds back buys before confirmed results, not estimates', async () => {
    create.mockResolvedValue(
      reply({
        events: [
          { date: '2026-11-02', timeRiyadh: '', kind: 'earnings', symbols: ['2222'], title: 'نتائج أرامكو للربع الثالث', source: 'Saudi Exchange', confirmed: true },
          { date: '2026-11-02', timeRiyadh: '', kind: 'earnings', symbols: ['1120'], title: 'نتائج الراجحي (متوقعة)', source: 'blog', confirmed: false },
          { date: '2026-11-01', timeRiyadh: '15:00', kind: 'rates', symbols: [], title: 'قرار البنك المركزي', source: 'SAMA', confirmed: true },
        ],
      }),
    );
    await calendarRound(SUN);
    await calendarRound(new Date(SUN.getTime() + 3_600_000));
    expect(create).toHaveBeenCalledTimes(1);
    expect(upcoming(SUN)).toHaveLength(3);
    expect(blackoutNow(SUN)).toEqual({ symbols: { '2222': '2026-11-02' }, market: 'قرار البنك المركزي' });

    const aramco = currentQuotes().get('2222')!;
    gate({ id: 'b1', symbol: '2222', side: 'buy', qty: 10, limitPrice: aramco.price, confidence: 0.8, rationale: 't' }, SUN);
    expect(trading.events.at(-1)!.text).toMatch(/نتائج الشركة 2026-11-02/);
    expect(trading.orders).toHaveLength(0);
    // The estimate blocks nothing; the market event halves the order.
    const rajhi = currentQuotes().get('1120')!;
    gate({ id: 'b2', symbol: '1120', side: 'buy', qty: 1000, limitPrice: rajhi.price, confidence: 0.8, rationale: 't' }, SUN);
    expect(trading.orders[0].qty * trading.orders[0].limitPrice).toBeLessThanOrEqual(trading.limits.maxOrder / 2);
    expect(trading.events.find((e) => e.correlationId === 'b2' && e.type === 'risk.verdict')!.text).toMatch(/حدث كبير في السوق اليوم/);
  });

  it('lets a sale through before results', () => {
    trading.calendar = { events: [{ id: 'e', date: '2026-11-01', timeRiyadh: '', kind: 'earnings', symbols: ['2222'], title: 'نتائج', source: 'x', confirmed: true }] };
    trading.books.paper.positions = [{ symbol: '2222', qty: 10, avgCost: 20 }];
    gate({ id: 's1', symbol: '2222', side: 'sell', qty: 10, limitPrice: currentQuotes().get('2222')!.price, confidence: 0.8, rationale: 't' }, SUN);
    expect(trading.orders[0]).toMatchObject({ side: 'sell', qty: 10 });
  });
});

describe('the weekly review', () => {
  /** Friday 6 November 2026, 13:00 Riyadh. */
  const FRI = new Date('2026-11-06T10:00:00Z');

  it('counts the week from the log, and Claude adds lessons and suggestions to add with one tap', async () => {
    trading.orders.push({ id: 'o1', decisionId: 'd1', symbol: '2222', side: 'sell', qty: 10, limitPrice: 30, status: 'filled', mode: 'paper', createdAt: '', expiresAt: '', filledQty: 10 });
    emit('order.queued', 'executor', 'q', {}, new Date('2026-11-03T08:00:00Z'));
    emit('order.filled', 'executor', 'f', { data: { orderId: 'o1', profit: 42.5 } }, new Date('2026-11-03T08:05:00Z'));
    emit('risk.verdict', 'risk', 'v', { data: { verdict: 'veto' } }, new Date('2026-11-04T08:00:00Z'));
    expect(weekStats(FRI)).toMatchObject({ orders: 1, filled: 1, vetoed: 1, closed: 1, wins: 1, losses: 0, realized: 42.5, bestSymbol: '2222' });

    create.mockResolvedValue(reply({ summary: 'أسبوع هادئ وصفقة رابحة', lessons: ['البيع عند الهدف نفع'], suggestions: ['لا تشتري بعد ارتفاع ٥٪'] }));
    expect(await weeklyReview(new Date('2026-11-05T10:00:00Z'))).toBeUndefined(); // Thursday: not yet
    const review = await weeklyReview(FRI);
    expect(review).toMatchObject({ week: '2026-11-06', summary: 'أسبوع هادئ وصفقة رابحة', suggestions: ['لا تشتري بعد ارتفاع ٥٪'] });
    expect(await weeklyReview(new Date(FRI.getTime() + 3_600_000))).toBeUndefined(); // once a week
    expect(trading.events.at(-1)!.text).toMatch(/مراجعة الأسبوع: 1 أمر، 1 صفقة مغلقة/);
  });
});

describe('the Shariah check (US)', () => {
  it('runs on the US desk only, and stops buying a stock that left SPUS without selling it', async () => {
    await shariahRound(SUN, true); // Tadawul: nothing to check
    expect(create).not.toHaveBeenCalled();
    create.mockResolvedValue(reply({ asOf: '2026-11-01', source: 'SP Funds', results: [{ symbol: 'NVDA', held: true, note: 'ضمن المكونات' }, { symbol: 'TSLA', held: false, note: 'خرج' }, { symbol: 'XXXX', held: false, note: '' }] }));
    await inDesk('us', async () => {
      resetTrading();
      trading.books.paper.positions = [{ symbol: 'TSLA', qty: 1, avgCost: 300 }];
      const check = await shariahRound(SUN);
      expect(check!.removed).toEqual(['TSLA']);
      expect(check!.results.find((r) => r.symbol === 'AAPL')).toMatchObject({ held: null }); // not answered: unknown, not removed
      expect(trading.excluded).toEqual(['TSLA']);
      expect(trading.books.paper.positions).toHaveLength(1); // nothing sold
      expect(Date.parse(check!.nextDue!) - SUN.getTime()).toBe(90 * 86_400_000);
      expect(await shariahRound(new Date(SUN.getTime() + 86_400_000))).toBeUndefined(); // not due again
      // A second report of the same stock does not exclude it twice.
      applyShariah({ results: [{ symbol: 'TSLA', held: false, note: '' }] }, SUN);
      expect(trading.excluded).toEqual(['TSLA']);
    });
  });
});
