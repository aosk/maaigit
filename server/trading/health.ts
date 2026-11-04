import type { HealthCheck } from '../../shared/types.js';
import type { TradingSummary } from '../../shared/trading.js';
import { client } from '../ai/claude.js';
import { botStale } from './executor.js';
import { currentQuotes } from './market.js';
import { STALE_QUOTE_MS } from './risk.js';
import { trading } from './store.js';
import { marketClock } from './tadawul.js';

/**
 * StockSmart's part in Settings → Connections and the server health checks: the desk (paper or live, stopped or not),
 * its prices, its agents, and the SNB desktop bot. It reads what the desk already knows, so checking costs nothing.
 */

export function tradingSummary(now = new Date()): TradingSummary {
  const newest = [...currentQuotes().values()].sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
  const clock = marketClock(now);
  const runs = (['technical', 'news', 'decision'] as const).map((id) => trading.agents[id]).filter(Boolean);
  return {
    mode: trading.mode,
    halted: trading.halted,
    haltReason: trading.haltReason,
    marketOpen: clock.open,
    quotesAsOf: newest?.asOf,
    quotesSource: newest?.source,
    quotesFresh: Boolean(newest) && now.getTime() - Date.parse(newest.asOf) <= STALE_QUOTE_MS,
    agentsCanDecide: Boolean(client),
    lastRoundAt: runs.map((r) => r!.lastRunAt).filter((x): x is string => Boolean(x)).sort().pop(),
    agentErrors: (['technical', 'news', 'decision'] as const).filter((id) => trading.agents[id]?.lastError).map((id) => `${id}: ${trading.agents[id]!.lastError}`),
    bot: { connected: Boolean(trading.bot.keyHash), stale: Boolean(trading.bot.keyHash) && botStale(now.getTime()), brokerSession: Boolean(trading.bot.brokerSession), practice: Boolean(trading.bot.practice), lastSeen: trading.bot.lastSeen },
  };
}

const minutesAgo = (iso: string | undefined, now: Date) => (iso ? Math.round((now.getTime() - Date.parse(iso)) / 60_000) : Infinity);
const ago = (iso: string | undefined, now: Date) => {
  const m = minutesAgo(iso, now);
  return m === Infinity ? 'never' : m < 90 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export function tradingChecks(now = new Date()): HealthCheck[] {
  const s = tradingSummary(now);
  const live = s.mode === 'live';
  const checks: HealthCheck[] = [];
  checks.push(
    s.halted
      ? { id: 'stocksmart', name: 'StockSmart', status: 'warn', detail: `Stopped: ${s.haltReason ?? ''}`, fix: 'Resume it in StockSmart when you are ready (only you can).' }
      : { id: 'stocksmart', name: 'StockSmart', status: 'ok', detail: `${live ? 'LIVE (real money at SNB Capital)' : 'Paper (no real money)'}; market ${s.marketOpen ? 'open' : 'closed'}; last round ${ago(s.lastRoundAt, now)}.` },
  );
  // Prices matter only while the market is open; outside it the last close is expected to age.
  if (!s.quotesAsOf) checks.push({ id: 'stocksmart-prices', name: 'StockSmart prices', status: s.marketOpen ? 'fail' : 'ok', detail: s.marketOpen ? 'No prices could be read.' : 'Not read yet (the market is closed).', fix: s.marketOpen ? 'Yahoo Finance may be refusing the server; the SNB bot’s prices replace it once it runs.' : undefined });
  else checks.push({ id: 'stocksmart-prices', name: 'StockSmart prices', status: s.marketOpen && !s.quotesFresh ? 'fail' : 'ok', detail: `${s.quotesSource === 'bot' ? 'Live from SNB' : s.quotesSource === 'yahoo' ? 'Yahoo Finance, about 15 min delayed' : 'Simulated'}; newest price ${ago(s.quotesAsOf, now)}.`, fix: s.marketOpen && !s.quotesFresh ? 'The agents stop trading on old prices until they are fresh again.' : undefined });
  checks.push(
    !s.agentsCanDecide
      ? { id: 'stocksmart-agents', name: 'StockSmart agents', status: 'warn', detail: 'No Claude key: the decision agent follows a plain momentum rule.', fix: 'ANTHROPIC_API_KEY in Render → Environment.' }
      : s.agentErrors.length
        ? { id: 'stocksmart-agents', name: 'StockSmart agents', status: 'warn', detail: `Last error — ${s.agentErrors.join('; ')}`, fix: 'Usually Claude (credit or a busy moment); see Claude AI above.' }
        : { id: 'stocksmart-agents', name: 'StockSmart agents', status: 'ok', detail: `Technical, news and decision agents working; last round ${ago(s.lastRoundAt, now)}.` },
  );
  const bot = s.bot;
  if (!bot.connected) checks.push({ id: 'snb-bot', name: 'SNB desktop bot', status: live ? 'fail' : 'off', detail: 'Not connected. Needed only for real money.', fix: 'StockSmart → Limits and settings → Connect the SNB bot (a key and a signing secret, shown once).' });
  else if (bot.stale) checks.push({ id: 'snb-bot', name: 'SNB desktop bot', status: live ? 'fail' : 'warn', detail: `Not heard from since ${ago(bot.lastSeen, now)}.`, fix: 'Start the bot on your computer and keep it awake; real orders wait until it is back.' });
  else if (!bot.brokerSession) checks.push({ id: 'snb-bot', name: 'SNB desktop bot', status: live ? 'fail' : 'warn', detail: 'Running, but logged out at SNB Capital.', fix: 'Log in again on the bot (the OTP comes to your phone).' });
  else if (bot.practice) checks.push({ id: 'snb-bot', name: 'SNB desktop bot', status: live ? 'warn' : 'ok', detail: `Running in practice mode: it goes through each order and places nothing; heard from ${ago(bot.lastSeen, now)}.`, fix: live ? 'Trading is LIVE but the bot only practises, so no order reaches SNB.' : undefined });
  else checks.push({ id: 'snb-bot', name: 'SNB desktop bot', status: 'ok', detail: `Running and logged in at SNB; heard from ${ago(bot.lastSeen, now)}.` });
  return checks;
}
