import type { Quote } from '../../shared/trading.js';
import { UNIVERSE } from './tadawul.js';
import { deskConfig, deskId, perDesk } from './desk.js';
import { US_SIM_BASE } from './nyse.js';
import { CRYPTO_SIM_BASE } from './crypto.js';

/**
 * Prices. Tadawul has no free real-time feed, so StockSmart reads Yahoo Finance's public chart data (about 15 minutes
 * behind) by default online, a simulation for development and tests, and, once it runs, prices the desktop bot reads
 * from the SNB Capital screen (which are live, and win while fresh). Every price says when it was true and where from.
 */

export interface History {
  closes: number[];
  volumes: number[];
}

type Source = 'yahoo' | 'sim';
const SOURCE: Source = process.env.MAAI_TRADING_QUOTES === 'yahoo' || (process.env.MAAI_TRADING_QUOTES !== 'sim' && (process.env.RENDER === 'true' || process.env.NODE_ENV === 'production')) ? 'yahoo' : 'sim';

/** Each desk's prices: current quotes, daily histories, and every distinct price seen (what paper orders are judged against). */
const prices = perDesk(() => ({
  quotes: new Map<string, Quote>(),
  histories: new Map<string, { day: string; history: History }>(),
  observed: new Map<string, Quote[]>(),
  index: undefined as IndexQuote | undefined,
}));
const KEEP_OBSERVED = 200;

export const currentQuotes = () => prices().quotes;

/** The Tadawul All Share Index (TASI): the market as a whole, read with the stocks. */
export interface IndexQuote {
  value: number;
  prevClose: number;
  /** Daily closes before today, oldest first (about three months), for its trend. */
  closes: number[];
  asOf: string;
  source: 'yahoo' | 'sim';
}
export const currentIndex = () => prices().index;

/** Sets a stock's current price and records it as an observation (once per exchange time). */
function setQuote(q: Quote): void {
  const { quotes, observed } = prices();
  quotes.set(q.symbol, q);
  const list = observed.get(q.symbol) ?? [];
  if (list.at(-1)?.asOf !== q.asOf) {
    list.push(q);
    if (list.length > KEEP_OBSERVED) list.splice(0, list.length - KEEP_OBSERVED);
    observed.set(q.symbol, list);
  }
}

/** The prices seen for a stock that were true at the exchange after `from` and up to `to` (ISO times). */
export function observedBetween(symbol: string, from: string, to: string): Quote[] {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return (prices().observed.get(symbol) ?? []).filter((q) => Date.parse(q.asOf) > a && Date.parse(q.asOf) <= b);
}

/** The latest exchange time seen for a stock, if any. */
export const latestObserved = (symbol: string): string | undefined => prices().observed.get(symbol)?.at(-1)?.asOf;

/** A price the desktop bot read at the broker: live, so it wins over the delayed feed. */
export function noteBotQuote(symbol: string, price: number, prevClose: number | undefined, now = new Date()): void {
  if (!/^\d{4}$/.test(symbol) || !(price > 0)) return;
  const known = prices().quotes.get(symbol);
  setQuote({ symbol, price, prevClose: prevClose && prevClose > 0 ? prevClose : known?.prevClose ?? price, asOf: now.toISOString(), receivedAt: now.toISOString(), source: 'bot' });
}

/** Reads today's prices for every stock (and, once a day, their daily history). Failures keep the last price, which then ages. */
export async function refreshQuotes(now = new Date(), fetcher: typeof fetch = fetch): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const { quotes, histories } = prices();
  const index = refreshIndex(now, day, fetcher);
  await Promise.all(
    UNIVERSE.map(async ({ symbol }) => {
      const known = quotes.get(symbol);
      // A live price from the bot in the last few minutes is better than a delayed one.
      if (known?.source === 'bot' && now.getTime() - Date.parse(known.asOf) < 5 * 60_000) return;
      try {
        if (SOURCE === 'sim') {
          simulate(symbol, now, day);
          return;
        }
        const chart = await yahoo(symbol, '1d', '3mo', fetcher);
        const meta = chart.meta;
        const price = Number(meta?.regularMarketPrice);
        if (!(price > 0)) throw new Error('no price');
        // Closes and volumes kept in step: a bar missing either is dropped from both.
        const bars = chart.indicators?.quote?.[0];
        const days = (bars?.close ?? []).map((c, i) => [c, bars?.volume?.[i]] as const).filter((d): d is readonly [number, number] => typeof d[0] === 'number' && typeof d[1] === 'number');
        const closes = days.map((d) => d[0]);
        const volumes = days.map((d) => d[1]);
        // The last daily bar is today's: the history is the days before it.
        const prevClose = Number(meta?.chartPreviousClose ?? meta?.previousClose) || closes[closes.length - 2] || price;
        histories.set(symbol, { day, history: { closes: closes.slice(0, -1), volumes: volumes.slice(0, -1) } });
        const at = Number(meta?.regularMarketTime) * 1000;
        // A feed time in the future would let a price count before it happened: never later than when it arrived.
        const asOf = new Date(at > 0 ? Math.min(at, now.getTime()) : now.getTime()).toISOString();
        setQuote({ symbol, price, prevClose: closes.length > 1 ? closes[closes.length - 2] : prevClose, asOf, receivedAt: now.toISOString(), source: 'yahoo' });
        // Coins trade around the clock on exchanges: a live price from one beats Yahoo's delayed one (which stays as the fallback).
        if (deskId() === 'crypto') await liveCoin(symbol, now, fetcher);
      } catch (error) {
        console.error(`StockSmart: no price for ${symbol} (${(error as Error).message})`);
      }
    }),
  );
  await index;
}

/** Reads TASI the same way as a stock. A failure keeps the last value, which then ages (the pulse says how old). */
async function refreshIndex(now: Date, day: string, fetcher: typeof fetch): Promise<void> {
  try {
    if (SOURCE === 'sim') {
      prices().index = simulateIndex(now, day);
      return;
    }
    const chart = await yahooChart(deskConfig().indexTicker, '1d', '3mo', fetcher);
    const value = Number(chart.meta?.regularMarketPrice);
    if (!(value > 0)) throw new Error('no value');
    const closes = (chart.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => typeof c === 'number');
    const prevClose = Number(chart.meta?.chartPreviousClose ?? chart.meta?.previousClose) || closes[closes.length - 2] || value;
    const at = Number(chart.meta?.regularMarketTime) * 1000;
    prices().index = { value, prevClose: closes.length > 1 ? closes[closes.length - 2] : prevClose, closes: closes.slice(0, -1), asOf: new Date(at > 0 ? Math.min(at, now.getTime()) : now.getTime()).toISOString(), source: 'yahoo' };
  } catch (error) {
    console.error(`StockSmart: no ${deskConfig().indexEn} value (${(error as Error).message})`);
  }
}

/** A believable TASI for development and tests, moving with the simulated stocks' time of day. */
function simulateIndex(now: Date, day: string): IndexQuote {
  let seed = [...`${deskId()}INDEX${day}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32);
  const closes: number[] = [];
  let v = deskId() === 'us' ? 6_500 : deskId() === 'crypto' ? 100_000 : 11_200;
  for (let i = 0; i < 60; i++) closes.push(Math.round((v *= 1 + (rand() - 0.49) * 0.012) * 100) / 100);
  const prevClose = closes[closes.length - 1];
  const minute = Math.floor(now.getTime() / 60_000) % 1440;
  return { value: Math.round(prevClose * (1 + Math.sin(minute / 37 + seed) * 0.006) * 100) / 100, prevClose, closes, asOf: now.toISOString(), source: 'sim' };
}

export const historyOf = (symbol: string): History | undefined => prices().histories.get(symbol)?.history;

interface Chart {
  timestamp?: number[];
  meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number };
  indicators?: { quote?: { close?: (number | null)[]; volume?: (number | null)[] }[] };
}

const yahoo = (symbol: string, interval: string, range: string, fetcher: typeof fetch) => yahooChart(deskConfig().yahoo(symbol), interval, range, fetcher);

async function yahooChart(ticker: string, interval: string, range: string, fetcher: typeof fetch): Promise<Chart> {
  const res = await fetcher(`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (StockSmart)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { chart?: { result?: Chart[] } };
  const chart = body.chart?.result?.[0];
  if (!chart) throw new Error('empty chart');
  return chart;
}

/** Whether the exchange feed answered last time, so a change is logged once, not every minute. */
let exchangeUp: boolean | undefined;

/** A coin's last trade on Coinbase's public market feed (no key). A failure leaves the Yahoo price in place. */
async function liveCoin(symbol: string, now: Date, fetcher: typeof fetch): Promise<void> {
  try {
    const res = await fetcher(`https://api.exchange.coinbase.com/products/${symbol}-USD/ticker`, { headers: { 'User-Agent': 'MAAI', Accept: 'application/json' }, signal: AbortSignal.timeout(6_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const t = (await res.json()) as { price?: string; time?: string };
    const price = Number(t.price);
    const at = Date.parse(t.time ?? '');
    if (!(price > 0) || !(at > 0)) throw new Error('no price');
    const known = prices().quotes.get(symbol);
    setQuote({ symbol, price, prevClose: known?.prevClose ?? price, asOf: new Date(Math.min(at, now.getTime())).toISOString(), receivedAt: now.toISOString(), source: 'exchange' });
    if (exchangeUp !== true) console.log('StockSmart: live coin prices from Coinbase.');
    exchangeUp = true;
  } catch (error) {
    if (exchangeUp !== false) console.error(`StockSmart: no live price from Coinbase for ${symbol} (${(error as Error).message}); using Yahoo's delayed price.`);
    exchangeUp = false;
  }
}

/** Daily bars, oldest first: each trading day's date, close and volume. */
export interface DailyBars {
  days: string[];
  closes: number[];
  volumes: number[];
}

/** A stock's (or, with `index`, the desk's index's) daily bars over `range` ("2y"), for replaying a rule over history. */
export async function dailyBars(symbol: string | { index: true }, range: string, fetcher: typeof fetch = fetch): Promise<DailyBars> {
  const isIndex = typeof symbol !== 'string';
  if (SOURCE === 'sim') return simulateBars(isIndex ? deskConfig().indexTicker : symbol);
  const chart = isIndex ? await yahooChart(deskConfig().indexTicker, '1d', range, fetcher) : await yahoo(symbol, '1d', range, fetcher);
  const bars = chart.indicators?.quote?.[0];
  const out: DailyBars = { days: [], closes: [], volumes: [] };
  (chart.timestamp ?? []).forEach((t, i) => {
    const close = bars?.close?.[i];
    if (typeof close !== 'number' || !(close > 0)) return;
    out.days.push(new Date(t * 1000).toISOString().slice(0, 10));
    out.closes.push(close);
    const volume = bars?.volume?.[i];
    out.volumes.push(typeof volume === 'number' ? volume : 0);
  });
  return out;
}

/** Two years of believable daily bars, the same every run (for development and tests). */
function simulateBars(key: string): DailyBars {
  let seed = [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 11);
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32);
  const out: DailyBars = { days: [], closes: [], volumes: [] };
  let p = 50 + rand() * 100;
  const start = Date.UTC(2024, 10, 1);
  for (let i = 0; i < 520; i++) {
    const d = new Date(start + i * 86_400_000);
    if (d.getUTCDay() === 5 || d.getUTCDay() === 6) continue;
    // A slow tide with noise on top, so trends and breakouts both occur.
    p *= 1 + Math.sin(i / 40 + seed % 7) * 0.002 + (rand() - 0.5) * 0.03;
    out.days.push(d.toISOString().slice(0, 10));
    out.closes.push(Math.round(p * 100) / 100);
    out.volumes.push(Math.round(1e6 * (0.6 + rand())));
  }
  return out;
}

/** A believable random walk per stock, the same every run for the same day (for development and tests). */
const BASE: Record<string, number> = { '2222': 27.4, '1120': 88, '1180': 36, '1150': 27, '1010': 28.5, '2010': 62, '1211': 51, '7010': 41, '7020': 53, '2082': 280, '5110': 17, '2280': 52, '2050': 24, '4190': 13, '4013': 270, '4002': 75, '4200': 125, '1212': 160 };

function simulate(symbol: string, now: Date, day: string) {
  let seed = [...`${symbol}${day}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) >>> 0) / 2 ** 32);
  const base = (deskId() === 'us' ? US_SIM_BASE[symbol] : deskId() === 'crypto' ? CRYPTO_SIM_BASE[symbol] : BASE[symbol]) ?? 30;
  const histories = prices().histories;
  if (!histories.has(symbol) || histories.get(symbol)!.day !== day) {
    const closes: number[] = [];
    const volumes: number[] = [];
    let p = base;
    for (let i = 0; i < 60; i++) {
      p *= 1 + (rand() - 0.49) * 0.03;
      closes.push(Math.round(p * 100) / 100);
      volumes.push(Math.round(1e6 * (0.6 + rand())));
    }
    histories.set(symbol, { day, history: { closes, volumes } });
  }
  const closes = histories.get(symbol)!.history.closes;
  const prevClose = closes[closes.length - 1];
  // Today's move follows the minute of the day, so the price drifts through the session.
  const minute = Math.floor(now.getTime() / 60_000) % 1440;
  const drift = Math.sin(minute / 37 + seed) * 0.012 + Math.sin(minute / 7) * 0.003;
  setQuote({ symbol, price: Math.round(prevClose * (1 + drift) * 100) / 100, prevClose, asOf: now.toISOString(), receivedAt: now.toISOString(), source: 'sim' });
}

/** Forgets every price (tests only). */
export function resetQuotes(): void {
  const p = prices();
  p.index = undefined;
  p.quotes.clear();
  p.histories.clear();
  p.observed.clear();
}

/** Records a price as if it had arrived from the feed (tests and the scenario runner: a price true at `asOf`, received at `receivedAt`). */
export function injectQuote(q: Quote): void {
  setQuote(q);
}
