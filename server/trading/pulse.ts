import type { MarketPulse, Quote } from '../../shared/trading.js';
import type { IndexQuote } from './market.js';

/**
 * The general market indicator: one number from -100 to +100 and a word for it, worked out in code from three things.
 *
 * - TASI, the whole market: today's move (the most weight) and whether it trades above its 20-day average.
 * - Breadth: of the stocks StockSmart follows, how many rise against how many fall (a rise led by one heavy stock is
 *   weaker than one shared by most).
 * - Risk: the most serious market-wide development the news agent reported (a confirmed high one, or caution mode,
 *   pulls the score down: the market may not have priced it in yet).
 *
 * It describes; it decides nothing. The decision agent sees it as background, and the risk gate's rules are unchanged.
 */

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** A stock within ±0.1% of yesterday's close is flat. */
const FLAT_PCT = 0.1;

export interface PulseInput {
  index?: IndexQuote;
  quotes: Quote[];
  /** The most serious market item from the news agent, if any. */
  market?: { severity: 'low' | 'medium' | 'high'; headline: string; confirmed: boolean }[];
  caution: boolean;
}

export const MOOD_AR: Record<MarketPulse['mood'], string> = { strong_up: 'صاعد بقوة', up: 'إيجابي', mixed: 'متذبذب', down: 'سلبي', strong_down: 'هابط بقوة' };

export function marketPulse({ index, quotes, market = [], caution }: PulseInput): MarketPulse {
  const reasons: { weight: number; text: string }[] = [];
  let score = 0;

  let idx: MarketPulse['index'];
  if (index && index.prevClose > 0) {
    const changePct = ((index.value - index.prevClose) / index.prevClose) * 100;
    const last20 = index.closes.slice(-20);
    const avg20 = last20.length >= 10 ? last20.reduce((a, v) => a + v, 0) / last20.length : undefined;
    const vsAvg20Pct = avg20 ? ((index.value - avg20) / avg20) * 100 : undefined;
    const fiveAgo = index.closes.length >= 5 ? index.closes[index.closes.length - 5] : undefined;
    const change5dPct = fiveAgo ? ((index.value - fiveAgo) / fiveAgo) * 100 : undefined;
    idx = { value: round(index.value), changePct: round(changePct), vsAvg20Pct: vsAvg20Pct === undefined ? undefined : round(vsAvg20Pct), change5dPct: change5dPct === undefined ? undefined : round(change5dPct), asOf: index.asOf, source: index.source };
    // ±1.5% in a day is a big day for TASI: that alone is ±50.
    const today = clamp((changePct / 1.5) * 50, -50, 50);
    score += today;
    reasons.push({ weight: Math.abs(today), text: `تاسي ${changePct >= 0 ? 'مرتفع' : 'منخفض'} ${Math.abs(round(changePct))}٪ اليوم` });
    if (vsAvg20Pct !== undefined) {
      const trend = clamp(vsAvg20Pct * 5, -15, 15);
      score += trend;
      reasons.push({ weight: Math.abs(trend), text: vsAvg20Pct >= 0 ? 'فوق متوسط ٢٠ يوم (اتجاه صاعد)' : 'تحت متوسط ٢٠ يوم (اتجاه هابط)' });
    }
  }

  const moves = quotes.filter((q) => q.prevClose > 0).map((q) => ((q.price - q.prevClose) / q.prevClose) * 100);
  const up = moves.filter((m) => m > FLAT_PCT).length;
  const down = moves.filter((m) => m < -FLAT_PCT).length;
  const flat = moves.length - up - down;
  const avgChangePct = moves.length ? moves.reduce((a, m) => a + m, 0) / moves.length : 0;
  if (moves.length) {
    // Without TASI the followed stocks carry the whole read.
    const share = (up - down) / moves.length;
    const breadth = share * (idx ? 30 : 60) + (idx ? 0 : clamp((avgChangePct / 1.5) * 20, -20, 20));
    score += breadth;
    reasons.push({ weight: Math.abs(breadth), text: `${up} من ${moves.length} أسهم مرتفعة و${down} منخفضة` });
  }

  const worst = [...market].sort((a, b) => rank(b.severity) - rank(a.severity))[0];
  const risk: MarketPulse['risk'] = caution || (worst?.severity === 'high' && worst.confirmed) ? 'high' : worst && worst.severity !== 'low' ? 'medium' : 'low';
  if (risk === 'high') {
    score -= 20;
    reasons.push({ weight: 20, text: caution ? 'وضع الحذر مفعّل' : `خبر عالي الخطورة: ${worst.headline}` });
  } else if (risk === 'medium') {
    score -= 8;
    reasons.push({ weight: 8, text: `تطور يستحق المتابعة: ${worst.headline}` });
  }

  score = Math.round(clamp(score, -100, 100));
  const mood: MarketPulse['mood'] = score >= 40 ? 'strong_up' : score >= 12 ? 'up' : score <= -40 ? 'strong_down' : score <= -12 ? 'down' : 'mixed';
  const asOf = [idx?.asOf, ...quotes.map((q) => q.asOf)].filter((x): x is string => Boolean(x)).sort().pop();
  return {
    score,
    mood,
    index: idx,
    breadth: { up, down, flat, avgChangePct: round(avgChangePct) },
    risk,
    riskHeadline: risk !== 'low' ? (caution && !worst ? undefined : worst?.headline) : undefined,
    caution,
    reasons: reasons.filter((r) => r.weight >= 1).sort((a, b) => b.weight - a.weight).map((r) => r.text).slice(0, 4),
    asOf,
  };
}

const rank = (s: 'low' | 'medium' | 'high') => (s === 'high' ? 2 : s === 'medium' ? 1 : 0);
