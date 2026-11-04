import { useMemo, useState } from 'react';
import { categoryOf, LOG_CATEGORIES, outcomeOf, type LogCategory, type TradeEvent, type TradingState } from '../../shared/trading';
import { time } from '../format';
import { useSettings } from '../settings';

/**
 * The agents' log, made easy to follow: filter by category (with counts), and read it either as a timeline grouped
 * by round, or trade by trade — each decision as one card with its whole path (decision → risk gate → order → fill)
 * and the analysis behind it.
 */

type View = 'timeline' | 'trades';
const ROUND_MS = 15 * 60_000;

export function TradeLog({ st }: { st: TradingState }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [view, setView] = useState<View>('trades');
  const [hidden, setHidden] = useState<Set<LogCategory>>(() => new Set());
  const [rounds, setRounds] = useState(4);

  const events = useMemo(() => st.events.filter((e) => e.type !== 'executor.heartbeat'), [st.events]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(LOG_CATEGORIES.map((k) => [k, 0])) as Record<LogCategory, number>;
    for (const e of events) c[categoryOf(e)]++;
    return c;
  }, [events]);

  const toggle = (k: LogCategory) =>
    setHidden((now) => {
      const next = new Set(now);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <div className="tl">
      <div className="seg tl-view" role="radiogroup" aria-label={t.ss.logView}>
        <button role="radio" aria-checked={view === 'trades'} onClick={() => setView('trades')}>{t.ss.viewTrades}</button>
        <button role="radio" aria-checked={view === 'timeline'} onClick={() => setView('timeline')}>{t.ss.viewTimeline}</button>
      </div>
      {view === 'timeline' && (
        <div className="tl-cats" role="group" aria-label={t.ss.logFilter}>
          {LOG_CATEGORIES.map((k) => (
            <button key={k} type="button" className={`tl-cat cat-${k}${hidden.has(k) ? '' : ' on'}`} aria-pressed={!hidden.has(k)} onClick={() => toggle(k)}>
              <i aria-hidden="true" />{t.ss.cats[k]} <b>{counts[k]}</b>
            </button>
          ))}
        </div>
      )}
      {events.length === 0 ? <p className="sub">{t.ss.noEvents}</p> : view === 'trades' ? <Trades events={events} t={t} lang={lang} /> : <Timeline events={events.filter((e) => !hidden.has(categoryOf(e)))} t={t} lang={lang} rounds={rounds} more={() => setRounds(rounds + 6)} />}
    </div>
  );
}

type T = ReturnType<typeof useSettings>['t'];

function Line({ e, t, lang }: { e: TradeEvent; t: T; lang: 'ar' | 'en' }) {
  return (
    <li className={`ss-ev ag-${e.actor} cat-${categoryOf(e)} ev-${e.type.replace('.', '-')}`}>
      <div className="ss-ev-head"><b>{t.ss.agentNames[e.actor] ?? e.actor}</b><span className="tl-tag">{t.ss.cats[categoryOf(e)]}</span><time dateTime={e.ts}>{time(e.ts, lang)}</time></div>
      <div dir="auto">{e.text}</div>
    </li>
  );
}

/** Newest round first; each round's events in the order they happened. */
function Timeline({ events, t, lang, rounds, more }: { events: TradeEvent[]; t: T; lang: 'ar' | 'en'; rounds: number; more: () => void }) {
  const groups = useMemo(() => {
    const byRound = new Map<number, TradeEvent[]>();
    for (const e of events) {
      const key = Math.floor(Date.parse(e.ts) / ROUND_MS) * ROUND_MS;
      byRound.set(key, [...(byRound.get(key) ?? []), e]);
    }
    return [...byRound.entries()].sort((a, b) => b[0] - a[0]);
  }, [events]);
  return (
    <>
      {groups.slice(0, rounds).map(([at, list]) => (
        <details key={at} className="tl-round" open={at === groups[0][0]}>
          <summary>
            <span>{t.ss.round(time(new Date(at), lang))}</span>
            <span className="tl-summary">
              {LOG_CATEGORIES.map((k) => {
                const n = list.filter((e) => categoryOf(e) === k).length;
                return n ? <span key={k} className={`tl-mini cat-${k}`}><i aria-hidden="true" />{n}</span> : null;
              })}
            </span>
          </summary>
          <ol className="ss-feed">{list.map((e) => <Line key={e.id} e={e} t={t} lang={lang} />)}</ol>
        </details>
      ))}
      {groups.length > rounds && <button className="btn ghost" onClick={more}>{t.ss.more(groups.length - rounds)}</button>}
    </>
  );
}

/** One card per decision: what was decided, what the risk gate did, and how the order ended — with the analysis behind it. */
function Trades({ events, t, lang }: { events: TradeEvent[]; t: T; lang: 'ar' | 'en' }) {
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(10);
  const trades = useMemo(() => {
    return events
      .filter((e) => e.type === 'decision.created' && e.correlationId)
      .reverse()
      .map((d) => {
        const thread = events.filter((e) => e.correlationId === d.correlationId);
        const symbol = (d.data as { symbol?: string } | undefined)?.symbol;
        const since = Date.parse(d.ts) - 30 * 60_000;
        const why = events.filter((e) => categoryOf(e) === 'analysis' && (e.data as { symbol?: string } | undefined)?.symbol === symbol && Date.parse(e.ts) >= since && Date.parse(e.ts) <= Date.parse(d.ts));
        return { d, thread, why, outcome: outcomeOf(thread), side: (d.data as { side?: string } | undefined)?.side };
      });
  }, [events]);
  if (!trades.length) return <p className="sub">{t.ss.noTrades}</p>;
  const tally = trades.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x.outcome]: (acc[x.outcome] ?? 0) + 1 }), {});
  return (
    <>
      <div className="tl-cats">
        {Object.entries(tally).map(([k, n]) => <span key={k} className={`tl-out out-${k}`}>{t.ss.outcomes[k as keyof typeof t.ss.outcomes]} <b>{n}</b></span>)}
      </div>
      <ul className="tl-trades">
        {trades.slice(0, shown).map(({ d, thread, why, outcome, side }) => (
          <li key={d.id} className={`tl-trade side-${side}`}>
            <button type="button" className="tl-trade-head" aria-expanded={open === d.correlationId} onClick={() => setOpen(open === d.correlationId ? null : d.correlationId ?? null)}>
              <span className="tl-side" aria-hidden="true">{side === 'buy' ? '▲' : '▼'}</span>
              <span style={{ flex: 1, minWidth: 0 }} dir="auto">{d.text.split(' — ')[0]}</span>
              <span className={`tl-out out-${outcome}`}>{t.ss.outcomes[outcome]}</span>
            </button>
            <ol className="tl-steps">
              {thread.filter((e) => e.id !== d.id).map((e) => (
                <li key={e.id} className={`ag-${e.actor}`}><b>{t.ss.agentNames[e.actor] ?? e.actor}</b> <time className="sub">{time(e.ts, lang)}</time><div dir="auto">{e.text}</div></li>
              ))}
            </ol>
            {open === d.correlationId && (
              <div className="tl-why">
                <div className="sub"><b>{t.ss.reason}</b> <span dir="auto">{d.text.split(' — ')[1] ?? ''}</span></div>
                {why.map((e) => <div key={e.id} className={`ag-${e.actor}`}><b>{t.ss.agentNames[e.actor] ?? e.actor}</b> <span dir="auto">{e.text}</span></div>)}
              </div>
            )}
          </li>
        ))}
      </ul>
      {trades.length > shown && <button className="btn ghost" onClick={() => setShown(shown + 10)}>{t.ss.more(trades.length - shown)}</button>}
    </>
  );
}
