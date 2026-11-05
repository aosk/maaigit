import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { TradeEvent, TradeLimits, TradingState } from '../../shared/trading';
import { api } from '../api';
import { ago, time } from '../format';
import { useOnRefresh } from '../refresh';
import { useSettings } from '../settings';
import { ChartUp, Chevron, Send, Stop } from '../components/Icons';
import { TradeLog } from '../components/TradeLog';

/**
 * StockSmart: what the trading agents hold and earn today, what they are doing right now (the desk's log, live), and the
 * controls that are the user's alone: stop, resume, real money, the limits, and instructions to the agents.
 */

type T = ReturnType<typeof useSettings>['t'];

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
const tone = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

/** A small line chart of today's portfolio value. */
function Spark({ points, width = 320, height = 56 }: { points: number[]; width?: number; height?: number }) {
  if (points.length < 2) return <div className="ss-spark-empty" style={{ height }} />;
  const lo = Math.min(...points);
  const hi = Math.max(...points);
  const span = hi - lo || 1;
  const xy = points.map((v, i) => [(i / (points.length - 1)) * width, height - 3 - ((v - lo) / span) * (height - 8)]);
  const line = `M${xy.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}`;
  return (
    <svg className="ss-spark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-hidden="true">
      <path d={`${line} L${width} ${height} L0 ${height} Z`} className="area" />
      <path d={line} className="line" />
    </svg>
  );
}

export function StockSmart() {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [st, setSt] = useState<TradingState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refetch = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback((background = false) => {
    api
      .trading(background)
      .then((s) => {
        setSt(s);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(() => !document.hidden && load(true), 60_000);
    // The log as it happens; the numbers follow a moment after each event.
    let source: EventSource | undefined;
    if (typeof EventSource !== 'undefined') {
      source = new EventSource('/api/trading/stream');
      source.addEventListener('trade', (msg) => {
        const event = JSON.parse((msg as MessageEvent<string>).data) as TradeEvent;
        setSt((prev) => (prev && !prev.events.some((e) => e.id === event.id) ? { ...prev, events: [...prev.events, event].slice(-150) } : prev));
        clearTimeout(refetch.current);
        refetch.current = setTimeout(() => load(true), 800);
      });
    }
    return () => {
      clearInterval(poll);
      clearTimeout(refetch.current);
      source?.close();
    };
  }, [load]);
  useOnRefresh(() => load());

  async function act(run: () => Promise<TradingState>): Promise<boolean> {
    setBusy(true);
    try {
      setSt(await run());
      setError('');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!st) {
    return (
      <div className="screen">
        <h1 className="title">{t.stocks}</h1>
        {error ? <div className="error" role="alert">{error}</div> : <div className="skeleton" aria-label={t.loading}><span /><span /><span /></div>}
      </div>
    );
  }

  const live = st.mode === 'live';
  return (
    <div className={`screen ss${live ? ' ss-live' : ''}`}>
      <header className="ss-head">
        <div>
          <div className="eyebrow">{t.ss.subtitle} · <Clock st={st} t={t} /></div>
          <h1 className="title">{t.stocks}</h1>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className={`ss-mode ${st.mode}`}>● {live ? t.ss.live : t.ss.paper}</span>
          {st.halted ? (
            <button className="btn primary" disabled={busy} onClick={() => window.confirm(t.ss.resumeConfirm) && act(api.tradingResume)}>{t.ss.resume}</button>
          ) : (
            <button className="btn ss-stop" disabled={busy} onClick={() => window.confirm(t.ss.stopConfirm) && act(() => api.tradingHalt())}><Stop size={16} />{t.ss.stop}</button>
          )}
        </div>
      </header>

      {st.halted && <div className="error" role="alert">{t.ss.halted(st.haltReason ?? '')}</div>}
      <UnknownOrders st={st} t={t} busy={busy} act={act} />
      {error && <div className="error" role="alert">{error}</div>}

      <div className="ss-grid">
        <div className="ss-col">
          <Hero st={st} t={t} />
          <AgentChips st={st} t={t} />
          <Positions st={st} t={t} />
          <Orders st={st} t={t} lang={lang} />
          <SettingsPanel st={st} t={t} busy={busy} act={act} />
        </div>
        <div className="ss-col ss-side">
          <Feed st={st} t={t} lang={lang} onAsk={(q) => api.tradingAsk(q, lang).then((r) => r.answer)} onKeep={(text) => act(() => api.tradingDirective(text))} />
        </div>
      </div>
    </div>
  );
}

function Clock({ st, t }: { st: TradingState; t: T }) {
  const m = st.clock.minutesToChange;
  return <>{st.clock.open ? t.ss.closesIn(Math.floor(m / 60), m % 60) : t.ss.opensIn(Math.floor(m / 60), m % 60)}</>;
}

function Hero({ st, t }: { st: TradingState; t: T }) {
  const invested = st.positions.reduce((sum, p) => sum + p.qty * (p.price ?? p.avgCost), 0);
  const most = (st.limits.capital * st.limits.dailyLossPct) / 100;
  const used = st.dayPnl < 0 && most > 0 ? Math.min(100, Math.round((-st.dayPnl / most) * 100)) : 0;
  return (
    <section className="ss-hero" aria-label={t.ss.dayPnl}>
      <div className="between">
        <span className="ss-muted">{t.ss.dayPnl}</span>
        <span className="ss-muted">{t.ss.totalPnl} <bdi dir="ltr">{signed(st.totalPnl)}</bdi></span>
      </div>
      <div className={`ss-pnl ${tone(st.dayPnl)}`} dir="ltr">
        {signed(st.dayPnl)} <small>SAR ({st.dayPnlPct > 0 ? '+' : ''}{st.dayPnlPct.toFixed(2)}%)</small>
      </div>
      <Spark points={st.curve.map((c) => c.value)} />
      <div className="ss-kv">
        <div>{t.ss.portfolio}<b dir="ltr">{money(st.portfolioValue)}</b></div>
        <div>{t.ss.invested}<b dir="ltr">{money(invested)}</b></div>
        <div>{t.ss.cash}<b dir="ltr">{money(st.cash)}</b></div>
        <div>{t.ss.tradesToday}<b dir="ltr">{st.ordersToday} / {st.limits.maxOrdersPerDay}</b></div>
      </div>
      <div>
        <div className="ss-muted" style={{ marginBottom: 4 }}>{t.ss.lossLimit(st.limits.dailyLossPct, used)}</div>
        <div className="ss-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={used} aria-label={t.ss.lossLimit(st.limits.dailyLossPct, used)}><i style={{ width: `${Math.max(2, used)}%` }} /></div>
      </div>
    </section>
  );
}

function AgentChips({ st, t }: { st: TradingState; t: T }) {
  const ex = st.executor;
  const exec = st.mode === 'paper' ? t.ss.paperExecutor : !ex.connected ? t.ss.botOff : ex.stale ? t.ss.botStale : !ex.brokerSession ? t.ss.botLoggedOut : ex.practice ? t.ss.botPractice : t.ss.botOn;
  return (
    <div className="ss-agents">
      {st.agents.filter((a) => a.id !== 'executor').map((a) => (
        <span key={a.id} className={`ss-chip ag-${a.id}${a.enabled ? '' : ' off'}${a.lastError ? ' bad' : ''}`} title={a.lastError}>
          <i />{t.ss.agentNames[a.id]}
        </span>
      ))}
      <span className={`ss-chip ag-executor${st.mode === 'live' && (ex.stale || !ex.brokerSession) ? ' bad' : ''}`}><i />{exec}</span>
    </div>
  );
}

function Positions({ st, t }: { st: TradingState; t: T }) {
  const name = (symbol: string) => st.universe.find((i) => i.symbol === symbol);
  return (
    <>
      <h2 className="h2 sec ss-sec-pos">{t.ss.positions}</h2>
      {st.positions.length === 0 ? <p className="sub ss-empty">{t.ss.noPositions}</p> : <section className="card flush">
        {st.positions.map((p) => {
          const price = p.price ?? p.avgCost;
          const pnl = (price - p.avgCost) * p.qty;
          const pct = p.avgCost > 0 ? ((price - p.avgCost) / p.avgCost) * 100 : 0;
          const i = name(p.symbol);
          return (
            <div key={p.symbol} className="ss-pos">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ss-sym"><bdi>{i?.nameAr ?? p.symbol}</bdi> · <bdi dir="ltr">{p.symbol}</bdi></div>
                <div className="sub">{t.ss.shares(p.qty)} · {t.ss.avg(p.avgCost.toFixed(2))} · <bdi dir="ltr">{price.toFixed(2)}</bdi></div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <div className={`ss-num ${tone(pnl)}`} dir="ltr">{signed(pnl)}</div>
                <div className="sub" dir="ltr">{pct > 0 ? '+' : ''}{pct.toFixed(2)}%</div>
              </div>
            </div>
          );
        })}
      </section>}
    </>
  );
}

function Orders({ st, t, lang }: { st: TradingState; t: T; lang: 'ar' | 'en' }) {
  // The newest order's session: orders within the same 18 hours (the list comes newest first).
  const newest = st.orders[0] ? Date.parse(st.orders[0].createdAt) : 0;
  const today = st.orders.filter((o) => newest - Date.parse(o.createdAt) < 18 * 3_600_000).slice(0, 8);
  if (!today.length) return null;
  return (
    <details className="ss-orders">
      <summary className="sub">{t.ss.orders} ({today.length})</summary>
      <ul>
        {today.map((o) => (
          <li key={o.id} className="between">
            <span><b>{o.side === 'buy' ? '▲' : '▼'}</b> <bdi dir="ltr">{o.symbol}</bdi> · {o.filledQty || o.qty} × <bdi dir="ltr">{(o.avgFillPrice ?? o.limitPrice).toFixed(2)}</bdi></span>
            <span className={`ss-status ${o.status}`}>{t.ss.orderStatus[o.status]}{o.stage && o.status === 'sent' ? ` · ${stageText(o.stage, t)}` : ''} · {time(o.createdAt, lang)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The executor's own stage words, in the user's language when it is one the screen knows. */
function stageText(stage: string, t: T): string {
  if (stage.startsWith('waiting for exchange prices')) return t.ss.stageWaitingPrices;
  if (stage.startsWith('accepted at SNB')) return t.ss.stageAccepted;
  return stage;
}

/**
 * Orders SNB may or may not have (the bot was cut off after Submit): trading stays stopped until each is resolved,
 * by the bot or by the user after looking in the SNB app.
 */
function UnknownOrders({ st, t, busy, act }: { st: TradingState; t: T; busy: boolean; act: (run: () => Promise<TradingState>) => Promise<boolean> }) {
  const unknown = st.orders.filter((o) => o.status === 'unknown');
  if (!unknown.length) return null;
  const name = (symbol: string) => st.universe.find((i) => i.symbol === symbol)?.nameAr ?? symbol;
  return (
    <section className="card ss-unknown" role="alert">
      <b>{t.ss.unknownTitle}</b>
      <p className="sub">{t.ss.unknownHint}</p>
      {unknown.map((o) => (
        <div key={o.id} className="ss-unknown-row">
          <span>{o.side === 'buy' ? '▲' : '▼'} <bdi>{name(o.symbol)}</bdi> · <bdi dir="ltr">{o.qty} × {o.limitPrice.toFixed(2)}</bdi></span>
          <span className="row wrap" style={{ gap: 6 }}>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => window.confirm(t.ss.unknownExecutedConfirm) && act(() => api.tradingResolve(o.id, true))}>{t.ss.unknownExecuted}</button>
            <button type="button" className="btn secondary" disabled={busy} onClick={() => window.confirm(t.ss.unknownNotConfirm) && act(() => api.tradingResolve(o.id, false))}>{t.ss.unknownNot}</button>
          </span>
        </div>
      ))}
    </section>
  );
}

function Feed({ st, t, lang, onAsk, onKeep }: { st: TradingState; t: T; lang: 'ar' | 'en'; onAsk: (q: string) => Promise<string>; onKeep: (text: string) => void }) {
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');

  async function ask(e: FormEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskError('');
    try {
      await onAsk(q);
    } catch (err) {
      setAskError((err as Error).message);
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="ss-feedbox" aria-label={t.ss.feed}>
      <h2 className="h2 sec ss-sec-live"><span className="ss-pulse" aria-hidden="true" />{t.ss.feed}</h2>
      <form className="ss-ask" onSubmit={ask}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t.ss.askPlaceholder} aria-label={t.ss.askPlaceholder} dir="auto" maxLength={500} />
        <button className="icon-btn" type="submit" disabled={asking || !question.trim()} aria-label={t.ss.send}><Send size={18} /></button>
      </form>
      {(asking || askError || question.trim()) && (
        <div className="row between wrap">
          <span className="sub">{asking ? t.ss.asking : askError}</span>
          {question.trim() && !asking && <button className="link-btn" onClick={() => { onKeep(question.trim()); setQuestion(''); }}>{t.ss.keepInstruction}</button>}
        </div>
      )}
      <TradeLog st={st} />
      {st.quotesAsOf && st.quotesSource && <p className="sub">{t.ss.prices(t.ss.sources[st.quotesSource], ago(st.quotesAsOf, lang))}</p>}
      {!st.agentsCanDecide && <p className="sub">{t.ss.noClaude}</p>}
    </section>
  );
}

const LIMIT_KEYS: (keyof TradeLimits)[] = ['capital', 'maxOrder', 'maxPerSymbolPct', 'maxPerSectorPct', 'maxOrdersPerDay', 'dailyLossPct', 'cycleMinutes'];

function SettingsPanel({ st, t, busy, act }: { st: TradingState; t: T; busy: boolean; act: (run: () => Promise<TradingState>) => Promise<boolean> }) {
  const [limits, setLimits] = useState<Record<string, string>>(() => Object.fromEntries(LIMIT_KEYS.map((k) => [k, String(st.limits[k])])));
  const [saved, setSaved] = useState(false);
  const [confirmLive, setConfirmLive] = useState('');
  const [keys, setKeys] = useState<{ key: string; signSecret: string } | null>(null);
  const sectors = [...new Set(st.universe.map((i) => i.sector))];

  async function saveLimits(e: FormEvent) {
    e.preventDefault();
    if (!(await act(() => api.tradingLimits(Object.fromEntries(LIMIT_KEYS.map((k) => [k, Number(limits[k])])))))) return;
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <details className="group ss-settings">
      <summary className="group-head"><span className="h2" style={{ fontSize: '1.05em' }}>{t.ss.settings}</span><Chevron size={20} /></summary>
      <div className="group-body" style={{ padding: '0 16px 16px', gap: 16 }}>
        <form className="ss-limits" onSubmit={saveLimits}>
          {LIMIT_KEYS.map((k) => (
            <div key={k} className="field">
              <label htmlFor={`lim-${k}`}>{t.ss.limits[k]}</label>
              <input id={`lim-${k}`} inputMode="decimal" dir="ltr" value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} />
            </div>
          ))}
          <button className="btn primary" disabled={busy}>{saved ? `✓ ${t.ss.saved}` : t.ss.saveLimits}</button>
        </form>

        <div>
          <div className="section-label">{t.ss.sectors}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {sectors.map((s) => {
              const on = !st.excluded.includes(s);
              return (
                <button key={s} type="button" className={`ss-toggle${on ? ' on' : ''}`} aria-pressed={on} disabled={busy} onClick={() => act(() => api.tradingExcluded(on ? [...st.excluded, s] : st.excluded.filter((x) => x !== s)))}>
                  {t.ss.sectorNames[s] ?? s}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="section-label">{t.ss.deciderTitle}</div>
          <div className="seg" role="radiogroup" aria-label={t.ss.deciderTitle}>
            <button type="button" role="radio" aria-checked={st.decider === 'claude'} disabled={busy} onClick={() => act(() => api.tradingDecider('claude'))}>{t.ss.deciderClaude}</button>
            <button type="button" role="radio" aria-checked={st.decider === 'rules'} disabled={busy} onClick={() => act(() => api.tradingDecider('rules'))}>{t.ss.deciderRules}</button>
          </div>
          <p className="sub">{st.decider === 'rules' ? t.ss.deciderRulesHint : t.ss.deciderClaudeHint}</p>
        </div>

        <div>
          <div className="section-label">{t.ss.agents}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {st.agents.filter((a) => a.id === 'technical' || a.id === 'news' || a.id === 'decision').map((a) => (
              <button key={a.id} type="button" className={`ss-toggle${a.enabled ? ' on' : ''}`} aria-pressed={a.enabled} disabled={busy} onClick={() => act(() => api.tradingAgent(a.id, !a.enabled))}>
                {t.ss.agentNames[a.id]}
              </button>
            ))}
            {st.clock.open && !st.halted && <button type="button" className="btn secondary" disabled={busy} onClick={() => act(api.tradingRound)}><ChartUp size={16} />{t.ss.runNow}</button>}
          </div>
        </div>

        <div>
          <div className="section-label">{t.ss.instructions}</div>
          {st.directives.length === 0 && <p className="sub">{t.ss.noInstructions}</p>}
          <ul className="ss-directives">
            {st.directives.map((d) => (
              <li key={d.id} className="between">
                <span dir="auto">{d.text}</span>
                <button className="link-btn" disabled={busy} onClick={() => act(() => api.tradingRemoveDirective(d.id))}>{t.ss.remove}</button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="section-label">{t.ss.mode}: {st.mode === 'live' ? t.ss.liveLong : t.ss.paperLong}</div>
          {st.mode === 'live' ? (
            <button className="btn secondary" disabled={busy} onClick={() => act(() => api.tradingMode('paper'))}>{t.ss.backToPaper}</button>
          ) : (
            <div className="ss-golive">
              <p className="sub">{t.ss.liveNeeds}</p>
              <div className="row wrap" style={{ gap: 8 }}>
                <input className="ss-confirm" value={confirmLive} onChange={(e) => setConfirmLive(e.target.value)} placeholder={t.ss.typeLive} aria-label={t.ss.typeLive} dir="ltr" />
                <button className="btn ss-live-btn" disabled={busy || confirmLive !== 'LIVE'} onClick={() => act(() => api.tradingMode('live', confirmLive))}>{t.ss.goLive}</button>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="section-label">{t.ss.bot}</div>
          {keys && (
            <div className="banner" role="status">
              <p>{t.ss.botKeyShown}</p>
              <div className="ss-secret"><span>{t.ss.botKey}</span><code dir="ltr">{keys.key}</code></div>
              <div className="ss-secret"><span>{t.ss.botSecret}</span><code dir="ltr">{keys.signSecret}</code></div>
            </div>
          )}
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn secondary" disabled={busy} onClick={async () => setKeys(await api.tradingBotKey())}>{st.executor.connected ? t.ss.newBotKey : t.ss.connectBot}</button>
            {st.executor.connected && <button className="btn danger" disabled={busy} onClick={() => window.confirm(t.ss.disconnectConfirm) && act(api.tradingRevokeBot).then(() => setKeys(null))}>{t.ss.disconnectBot}</button>}
          </div>
        </div>
      </div>
    </details>
  );
}
