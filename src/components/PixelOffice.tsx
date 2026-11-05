import { useEffect, useMemo, useRef, useState } from 'react';
import type { TradeEvent, TradingState } from '../../shared/trading';
import { time } from '../format';
import { useSettings } from '../settings';
import { ACTOR_AGENT, createOffice, type AgentKey, type Office } from '../pixel-office/scene';

/**
 * The agents' office, live: each new event on the desk's log plays as a small scene, the lights follow Tadawul's clock
 * (awake from five minutes before the open, asleep after the close), and a stop shows at the gate. Tapping someone
 * shows the last thing that agent did; the corner button opens it full screen.
 */

const PLATES: { key: AgentKey; actor: string; left: number; top: number }[] = [
  { key: 'tech', actor: 'technical', left: 12.89, top: 51 },
  { key: 'news', actor: 'news', left: 69.14, top: 51 },
  { key: 'dec', actor: 'decision', left: 41.41, top: 64.5 },
  { key: 'risk', actor: 'risk', left: 54.1, top: 77.6 },
  { key: 'exec', actor: 'executor', left: 82.42, top: 78.1 },
];
const AGENT_ACTOR: Record<AgentKey, string> = { tech: 'technical', news: 'news', dec: 'decision', risk: 'risk', exec: 'executor' };

const reducedMotion = () => document.documentElement.dataset.motion === 'reduce' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function PixelOffice({ st, status }: { st: TradingState; status: string }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const canvas = useRef<HTMLCanvasElement>(null);
  const office = useRef<Office | null>(null);
  const played = useRef<number | null>(null);
  const [picked, setPicked] = useState<AgentKey | null>(null);
  const [full, setFull] = useState(false);

  const night = !st.clock.open && !(st.clock.label === 'closed' && st.clock.minutesToChange <= 5);
  const name = useMemo(() => {
    const names = new Map(st.universe.map((i) => [i.symbol, i.nameAr]));
    return (symbol: string) => names.get(symbol) ?? symbol;
  }, [st.universe]);
  const ticker = useMemo(() => {
    const held = st.positions.map((p) => {
      const price = p.price ?? p.avgCost;
      const pct = p.prevClose ? ((price - p.prevClose) / p.prevClose) * 100 : 0;
      return `${p.symbol} ${price.toFixed(2)} ${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(1)}%`;
    });
    return held.length ? held.join('   ·   ') : `STOCKSMART · ${st.mode === 'live' ? 'LIVE' : 'PAPER'} · ${st.universe.map((i) => i.symbol).join(' ')}`;
  }, [st.positions, st.mode, st.universe]);

  useEffect(() => {
    if (!canvas.current) return;
    const o = createOffice(canvas.current, { reduced: reducedMotion });
    office.current = o;
    const fit = new ResizeObserver(() => o.resize());
    fit.observe(canvas.current.parentElement!);
    return () => {
      fit.disconnect();
      o.destroy();
      office.current = null;
    };
  }, []);

  useEffect(() => {
    office.current?.setState({ night, halted: st.halted, live: st.mode === 'live', ticker });
  }, [night, st.halted, st.mode, ticker]);

  // Only what happens from now on is played: the log's past stays in the log.
  useEffect(() => {
    const newest = st.events.at(-1)?.id ?? 0;
    if (played.current === null) {
      played.current = newest;
      return;
    }
    for (const e of st.events) if (e.id > played.current) office.current?.play(e, name);
    played.current = Math.max(played.current, newest);
  }, [st.events, name]);

  useEffect(() => {
    if (!full) return;
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false);
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [full]);

  const lastOf = (key: AgentKey): TradeEvent | undefined => [...st.events].reverse().find((e) => ACTOR_AGENT[e.actor] === key && e.type !== 'executor.heartbeat');
  const shown = picked ? lastOf(picked) : undefined;
  const label = night ? t.ss.officeAsleep : st.halted ? t.ss.officeStopped : t.ss.officeAwake;

  return (
    <section className={`ss-office${full ? ' full' : ''}${night ? ' night' : ''}`} aria-label={t.ss.officeTitle}>
      <div className="ss-office-stage">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${t.ss.officeTitle}: ${label}`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const who = office.current?.pick(e.clientX - r.left, e.clientY - r.top) ?? null;
            setPicked(who === picked ? null : who);
          }}
        />
        {PLATES.map((p) => (
          <span key={p.key} className={`ss-plate ag-${p.actor}`} style={{ left: `${p.left}%`, top: `${p.top}%` }}>
            {t.ss.agentNames[p.actor as keyof typeof t.ss.agentNames]}
          </span>
        ))}
        <span className="ss-plate snb" style={{ left: '91.8%', top: '17.6%' }}>SNB</span>
        <button type="button" className="ss-office-full" onClick={() => setFull(!full)} aria-label={full ? t.ss.officeExit : t.ss.officeFull}>
          {full ? '✕' : '⛶'}
        </button>
      </div>
      <div className="ss-office-foot" aria-live="polite">
        {picked ? (
          <span className={`ag-${AGENT_ACTOR[picked]}`}>
            <b>{t.ss.agentNames[AGENT_ACTOR[picked] as keyof typeof t.ss.agentNames]}</b>
            {shown ? <> · <span dir="auto">{shown.text}</span> · <time dateTime={shown.ts}>{time(shown.ts, lang)}</time></> : <> · {t.ss.officeNothingYet}</>}
          </span>
        ) : (
          <span>{label} · {status} · <span className="sub">{t.ss.officeHint}</span></span>
        )}
      </div>
    </section>
  );
}
