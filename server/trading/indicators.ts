/** Plain technical measures over closing prices, oldest first. No AI: the same numbers every time. */

const sma = (values: number[], n: number): number | undefined => (values.length >= n ? values.slice(-n).reduce((a, b) => a + b, 0) / n : undefined);

/** Wilder's RSI over `n` periods (0–100), undefined until there is enough history. */
function rsi(closes: number[], n = 14): number | undefined {
  if (closes.length <= n) return undefined;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

/** The latest volume against the average of the `n` before it (1 = usual). */
function volumeRatio(volumes: number[], n = 20): number | undefined {
  if (volumes.length <= n) return undefined;
  const avg = volumes.slice(-n - 1, -1).reduce((a, b) => a + b, 0) / n;
  return avg > 0 ? volumes[volumes.length - 1] / avg : undefined;
}

/** How much a stock moves in a usual day: the average size of its daily change over `n` days, in %. */
export function dailyVolatility(closes: number[], n = 14): number | undefined {
  if (closes.length <= n) return undefined;
  const last = closes.slice(-n - 1);
  let sum = 0;
  for (let i = 1; i < last.length; i++) sum += Math.abs(last[i] / last[i - 1] - 1);
  return (sum / n) * 100;
}

/** The change over the last `n` days, in %. */
const changeOver = (closes: number[], n: number): number | undefined => (closes.length > n && closes[closes.length - 1 - n] > 0 ? (closes[closes.length - 1] / closes[closes.length - 1 - n] - 1) * 100 : undefined);

export interface TechRead {
  symbol: string;
  price: number;
  changePct: number;
  trend: 'up' | 'down' | 'flat';
  rsi?: number;
  volumeRatio?: number;
  /** The short trend (5-day average against the 20-day), beside `trend` (20-day against 50-day). */
  trendShort?: 'up' | 'down' | 'flat';
  /** The usual size of a day's move, in % (see dailyVolatility). */
  volatilityPct?: number;
  /** 20-day change minus the index's: above 0 the stock is stronger than the market. */
  relStrength?: number;
  /** Closed above the highest close of the previous 20 days, or below the lowest. */
  breakout?: 'up' | 'down';
  signal: 'buy' | 'sell' | 'hold';
  /** -1 (strong sell) to 1 (strong buy). */
  score: number;
}

/** One stock's read from its daily closes and volumes, plus today's price. */
export function readStock(symbol: string, closes: number[], volumes: number[], price: number, prevClose: number, indexCloses?: number[]): TechRead {
  const all = [...closes, price];
  const quick = sma(all, 5);
  const own20 = changeOver(all, 20);
  const index20 = indexCloses ? changeOver(indexCloses, 20) : undefined;
  const fast = sma(all, 20);
  const slow = sma(all, 50);
  const r = rsi(all);
  const vr = volumeRatio(volumes);
  const prior = closes.slice(-20);
  const breakout = prior.length === 20 ? (price > Math.max(...prior) ? 'up' : price < Math.min(...prior) ? 'down' : undefined) : undefined;
  const trend: TechRead['trend'] = fast && slow ? (fast > slow * 1.005 ? 'up' : fast < slow * 0.995 ? 'down' : 'flat') : 'flat';
  let score = 0;
  if (trend === 'up') score += 0.3;
  if (trend === 'down') score -= 0.3;
  if (breakout === 'up') score += 0.3 * (vr && vr > 1.3 ? 1.5 : 1);
  if (breakout === 'down') score -= 0.3 * (vr && vr > 1.3 ? 1.5 : 1);
  if (r !== undefined) {
    if (r > 75) score -= 0.3;
    else if (r < 30) score += 0.2;
  }
  score = Math.max(-1, Math.min(1, score));
  return {
    symbol,
    price,
    changePct: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    trend,
    rsi: r,
    volumeRatio: vr,
    // Readings for the decision agent and the risk gate; the score (and so the plain rule) does not use them.
    trendShort: quick && fast ? (quick > fast * 1.003 ? 'up' : quick < fast * 0.997 ? 'down' : 'flat') : undefined,
    volatilityPct: dailyVolatility(all),
    relStrength: own20 !== undefined && index20 !== undefined ? own20 - index20 : undefined,
    breakout,
    signal: score >= 0.5 ? 'buy' : score <= -0.5 ? 'sell' : 'hold',
    score,
  };
}
