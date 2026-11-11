import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { TradeEvent, TradingState } from '../../shared/trading';
import { time } from '../format';
import { useSettings } from '../settings';

/**
 * «وكلاء أسهمي» as an orbit: the order's trip from the market (the start, at the top) through the agents to the
 * broker (the end, at the bottom). The five agents on the route sit close to «معي»; the ones that inform or learn
 * drift on the outer ring. Each new event on the desk's log lights its stop in turn, with the event's own words
 * underneath, so the picture follows what the agents are really doing; with nothing new it rests on the last thing
 * that happened. Tapping anyone shows the last thing they did.
 */

type Group = 'read' | 'decide' | 'guard' | 'exec' | 'learn';
/** The app's own colours, one per kind of work. */
const COLOR: Record<Group, string> = { read: 'tech', decide: 'task', guard: 'mail', exec: 'chat', learn: 'reminder' };
const ink = (g: Group) => `var(--c-${COLOR[g]})`;
const soft = (g: Group) => `var(--c-${COLOR[g]}-soft)`;

const ICON: Record<string, ReactNode> = {
  technical: <><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 6-7" /></>,
  news: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 9h6M7 13h10M7 16h7" /></>,
  decision: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".6" /></>,
  risk: <><path d="M12 3 4.5 6v6c0 4.5 3.2 8 7.5 9 4.3-1 7.5-4.5 7.5-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  executor: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  fundamentals: <path d="M5 20V11M12 20V5M19 20v-6" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  second: <><path d="M4 5h11v8H9l-3 3v-3H4z" /><path d="M15 9h5v8h-2v3l-3-3h-4" /></>,
  holders: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 5.5a3 3 0 0 1 0 5.6M18 14.5c1.9.7 3 2.6 3 5" /></>,
  scoring: <><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>,
  review: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9zM9 12h6M9 16h4" /></>,
  shariah: <path d="M19 14.5A8 8 0 1 1 10 4a6.5 6.5 0 0 0 9 10.5z" />,
  market: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></>,
  broker: <path d="M3 10 12 4l9 6M5 10v8M9.7 10v8M14.3 10v8M19 10v8M3 20.5h18" />,
};

const CX = 178;
const CY = 270;
const RI = 82;
const RO = 140;
const at = (deg: number, r: number) => ({ x: CX + r * Math.cos((deg * Math.PI) / 180), y: CY + r * Math.sin((deg * Math.PI) / 180) });

/** The stops of the route, in order; `start` and `end` are the two capsules. */
type Stop = 'start' | 'technical' | 'news' | 'decision' | 'risk' | 'executor' | 'end';
const STAGE: Record<Stop, number> = { start: 0, technical: 1, news: 1, decision: 2, risk: 3, executor: 4, end: 5 };
const STAGE_GROUP: Group[] = ['read', 'read', 'decide', 'guard', 'exec', 'exec'];
const MAIN: { id: Exclude<Stop, 'start' | 'end'>; group: Group; x: number; y: number }[] = [
  { id: 'technical', group: 'read', ...at(-135, RI) },
  { id: 'news', group: 'read', ...at(-45, RI) },
  { id: 'decision', group: 'decide', ...at(45, RI) },
  { id: 'risk', group: 'guard', ...at(135, RI) },
  { id: 'executor', group: 'exec', x: CX, y: CY + RO },
];
const P = (id: string) => {
  const m = MAIN.find((n) => n.id === id)!;
  return `${m.x.toFixed(1)} ${m.y.toFixed(1)}`;
};
const ROUTE = `M${CX} 56L${P('news')}L${CX} ${CY}L${P('decision')}A${RI} ${RI} 0 0 1 ${P('risk')}L${P('executor')}L${CX} 474`;
const ROUTE_2 = `M${CX} 56L${P('technical')}L${CX} ${CY}`;

/** Where an event shows on the route. */
function stopOf(e: TradeEvent): Stop | undefined {
  if (e.actor === 'executor') return e.type === 'order.filled' ? 'end' : e.type === 'executor.heartbeat' ? undefined : 'executor';
  if (e.actor === 'technical' || e.actor === 'news' || e.actor === 'decision' || e.actor === 'risk') return e.actor;
  return undefined;
}

/** YYYY-MM-DD in Riyadh, the day the desks count "today" by. */
const riyadhDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const reducedMotion = () => document.documentElement.dataset.motion === 'reduce' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function Glyph({ k, x, y, size, color }: { k: string; x: number; y: number; size: number; color: string }) {
  return (
    <svg x={x - size / 2} y={y - size / 2} width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ stroke: color }} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON[k]}
    </svg>
  );
}

export function AgentOrbit({ st, status }: { st: TradingState; status: string }) {
  const { t, settings } = useSettings();
  const s = t.ss;
  const lang = settings.lang;
  const [hot, setHot] = useState<{ stop: Stop; text: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const played = useRef<number | null>(null);
  const queue = useRef<{ stop: Stop; text: string }[]>([]);
  const timer = useRef<number | undefined>(undefined);

  // Only what happens from now on is played: the log's past stays in the log.
  useEffect(() => {
    const newest = st.events.at(-1)?.id ?? 0;
    if (played.current === null) {
      played.current = newest;
      return;
    }
    const fresh = st.events.filter((e) => e.id > played.current!).flatMap((e) => {
      const stop = stopOf(e);
      return stop ? [{ stop, text: e.text }] : [];
    });
    played.current = Math.max(played.current, newest);
    if (fresh.length === 0) return;
    // A burst begins where the route does: at the market.
    if (queue.current.length === 0 && timer.current === undefined) queue.current.push({ stop: 'start', text: s.obArrived });
    queue.current.push(...fresh.slice(-12));
    const next = () => {
      const item = queue.current.shift();
      setHot(item ?? null);
      timer.current = item ? window.setTimeout(next, reducedMotion() ? 2200 : 1500) : undefined;
    };
    if (timer.current === undefined) next();
  }, [st.events, s.obArrived]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const enabled = (id: string) => st.agents.find((a) => a.id === id)?.enabled !== false;

  /** The agents on the outer ring: who applies to this desk, whether each has something to show, and what it says. */
  const side = useMemo(() => {
    const second = [...st.events].reverse().find((e) => e.data?.secondOpinion);
    const all: { id: string; group: Group; on: boolean; line: string; show: boolean }[] = [
      { id: 'fundamentals', group: 'read', show: Boolean(st.fundamentals), on: (st.fundamentals?.covered ?? 0) > 0, line: st.fundamentals ? s.fdSub(st.fundamentals.covered, st.fundamentals.total) : '' },
      { id: 'calendar', group: 'read', show: true, on: st.calendar.length > 0, line: st.calendar[0] ? `${st.calendar[0].date} · ${st.calendar[0].title}` : s.calEmpty },
      { id: 'second', group: 'decide', show: st.decider === 'claude', on: Boolean(second), line: second?.text ?? s.obSecondIdle },
      { id: 'holders', group: 'read', show: st.market === 'sa', on: (st.holders?.covered ?? 0) > 0, line: s.obHolders(st.holders?.covered ?? 0, st.holders?.total ?? 0) },
      { id: 'scoring', group: 'learn', show: true, on: st.scorecard.settled + st.scorecard.pending > 0, line: s.obScoring(st.scorecard.right, st.scorecard.settled, st.scorecard.pending) },
      { id: 'review', group: 'learn', show: true, on: Boolean(st.review), line: st.review ? `${s.revWeek(st.review.week)}${st.review.summary ? ` · ${st.review.summary}` : ''}` : s.revSub },
      { id: 'shariah', group: 'learn', show: st.market === 'us', on: Boolean(st.shariah?.checkedAt), line: st.shariah?.checkedAt ? s.obShariah(st.shariah.checkedAt.slice(0, 10)) : s.shNever },
    ];
    const shown = all.filter((a) => a.show);
    // Readers and the second opinion on the right, the learners on the left, spread evenly on each side.
    const right = shown.filter((a) => a.group !== 'learn');
    const left = shown.filter((a) => a.group === 'learn');
    const spread = (n: number, i: number, mid: number, step: number) => mid + (i - (n - 1) / 2) * step;
    return [...right.map((a, i) => ({ ...a, ...at(spread(right.length, i, 0, 27), RO) })), ...left.map((a, i) => ({ ...a, ...at(spread(left.length, i, 180, 30), RO) }))];
  }, [st, s]);

  const asleep = !st.clock.open;
  // The clock ticks on its own so «the next round in N min» and the opening time stay right between updates.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const stage = hot ? STAGE[hot.stop] : -1;
  const working = MAIN.filter((m) => enabled(m.id)).length + side.filter((a) => a.on).length;
  // When the market opens next, in the desk's own words (the day by Riyadh's calendar).
  const opensAt = (() => {
    const at = new Date(nowMs + st.clock.minutesToChange * 60_000);
    const day = riyadhDay(at) === riyadhDay(new Date(nowMs)) ? s.obDayToday : new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en', { weekday: 'long', timeZone: 'Asia/Riyadh' }).format(at);
    return `${day} ${new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en', { hour: 'numeric', minute: '2-digit', hour12: lang !== 'ar' ? true : false, timeZone: 'Asia/Riyadh' }).format(at)}`;
  })();
  // Minutes until the desk's next round (0 when it is due), from the last round and the cycle length.
  const lastRound = st.agents.filter((a) => a.id === 'technical').map((a) => a.lastRunAt).filter((x): x is string => Boolean(x)).sort().pop();
  const nextRound = lastRound ? Math.max(0, Math.ceil((Date.parse(lastRound) + st.limits.cycleMinutes * 60_000 - nowMs) / 60_000)) : null;
  const doing = hot && hot.stop !== 'start' && hot.stop !== 'end' ? hot.stop : null;
  const pill = st.halted ? s.obPillStopped : asleep && !doing ? s.obPillSleep(opensAt) : doing ? s.obPillHot(s.agentNames[doing]) : s.obPillReady(working, nextRound);
  const pillTone = st.halted || (asleep && !doing) ? 'off' : doing ? 'hot' : 'ready';
  const moving = Boolean(hot) && !reducedMotion();

  // The line under the picture: what is playing now, else the last thing that happened.
  const last = [...st.events].reverse().find((e) => stopOf(e));
  const line = hot
    ? { group: STAGE_GROUP[stage], icon: hot.stop === 'start' ? 'market' : hot.stop === 'end' ? 'broker' : hot.stop, name: hot.stop === 'start' ? s.obStart : hot.stop === 'end' ? s.obEnd : s.agentNames[hot.stop], text: hot.text, at: undefined }
    : last
      ? { group: STAGE_GROUP[STAGE[stopOf(last)!]], icon: stopOf(last) === 'end' ? 'broker' : last.actor, name: s.obLast, text: last.text, at: last.ts }
      : null;

  /** Whoever was tapped: what it does, how it works, and what it did today (by the desk's own day, Riyadh). */
  const detail = (() => {
    if (!picked) return null;
    const today = riyadhDay(new Date());
    const todays = (keep: (e: TradeEvent) => boolean) =>
      st.events.filter((e) => e.type !== 'executor.heartbeat' && riyadhDay(new Date(e.ts)) === today && keep(e)).reverse().slice(0, 6).map((e) => ({ at: e.ts, text: e.text }));
    const info = s.obInfo[picked as keyof typeof s.obInfo];
    const main = MAIN.find((x) => x.id === picked);
    if (main) return { group: main.group, icon: main.id, name: s.agentNames[main.id], ...info, state: enabled(main.id) ? '' : s.obOff, items: todays((e) => e.actor === main.id), note: '' };
    const a = side.find((x) => x.id === picked);
    if (a) {
      const by: Record<string, (e: TradeEvent) => boolean> = { second: (e) => Boolean(e.data?.secondOpinion), scoring: (e) => Boolean(e.data?.scored), review: (e) => Boolean(e.data?.review) };
      const upcoming = picked === 'calendar' ? st.calendar.slice(0, 4).map((e) => ({ at: undefined, text: `${e.date} · ${e.title}` })) : [];
      return { group: a.group, icon: a.id, name: s.obNames[a.id as keyof typeof s.obNames], ...info, state: '', items: by[picked] ? todays(by[picked]) : upcoming, note: a.line };
    }
    if (picked === 'start') return { group: 'read' as Group, icon: 'market', name: s.obStart, ...info, state: '', items: [], note: `${st.indexName?.[lang === 'ar' ? 'ar' : 'en'] ?? ''}${st.quotesSource ? ` · ${s.sources[st.quotesSource]}` : ''}${st.quotesAsOf ? ` · ${time(st.quotesAsOf, lang)}` : ''}` };
    if (picked === 'end') return { group: 'exec' as Group, icon: 'broker', name: s.obEnd, ...info, state: '', items: todays((e) => e.type === 'order.filled'), note: st.mode === 'live' ? status : s.obEndPaper };
    return null;
  })();
  const pick = (id: string) => setPicked(picked === id ? null : id);
  const keys = (id: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); // Space would scroll the page
    pick(id);
  };

  // A name sits under its agent, or above it for the ones high on the outer ring (clear of the agents below them).
  const node = (id: string, group: Group, x: number, y: number, r: number, name: string, state: 'on' | 'idle' | 'hot' | 'sleep', above = false) => (
    <g key={id} className={`ob-n ${state}${picked === id ? ' picked' : ''}`} role="button" tabIndex={0} aria-label={name} aria-pressed={picked === id} onClick={() => pick(id)} onKeyDown={keys(id)}>
      <circle className="ob-halo" cx={x} cy={y} r={r + 9} style={{ fill: ink(group) }} filter="url(#ob-blur)" />
      <circle className="ob-ring" cx={x} cy={y} r={r} style={{ fill: soft(group), stroke: ink(group) }} />
      <circle className="ob-spinner" cx={x} cy={y} r={r + 6} fill="none" style={{ stroke: ink(group) }} strokeWidth="1.3" strokeDasharray="3 6" />
      <Glyph k={id} x={x} y={y} size={r * 1.04} color={ink(group)} />
      <text x={x} y={above ? y - r - 7 : y + r + 15} textAnchor="middle" className="ob-label">{name}</text>
    </g>
  );
  const capsule = (id: 'start' | 'end', y: number, group: Group, icon: string, title: string, sub: string, tag: string) => (
    <g className={`ob-cap${hot?.stop === id ? ' hot' : ''}${picked === id ? ' picked' : ''}`} role="button" tabIndex={0} aria-label={title} aria-pressed={picked === id} onClick={() => pick(id)} onKeyDown={keys(id)}>
      <rect className="ob-halo" x="58" y={y - 4} width="240" height="52" rx="26" style={{ fill: ink(group) }} filter="url(#ob-blur)" />
      <rect className="ob-body" x="62" y={y} width="232" height="44" rx="22" style={{ fill: soft(group), stroke: ink(group) }} />
      <Glyph k={icon} x={273} y={y + 22} size={22} color={ink(group)} />
      <text x="252" y={y + 19} textAnchor="end" className="ob-cap-title">{title}</text>
      <text x="252" y={y + 35} textAnchor="end" className="ob-cap-sub">{sub}</text>
      <rect x="72" y={y + 11} width="52" height="22" rx="11" style={{ fill: ink(group) }} />
      <text x="98" y={y + 26} textAnchor="middle" className="ob-tag">{tag}</text>
    </g>
  );

  return (
    <section className={`card ob${asleep ? ' asleep' : ''}${st.halted ? ' halted' : ''}${picked ? ' reading' : ''}`} aria-label={s.obTitle}>
      <div className="between" style={{ gap: 8 }}>
        <div>
          <h2 className="h2" style={{ margin: 0 }}>{s.obTitle}</h2>
          <span className="sub">{st.halted ? s.officeStopped : asleep ? s.officeAsleep : doing ? s.obRoundRunning : s.obBetween}</span>
        </div>
        <span className={`ob-pill ${pillTone}`}><i aria-hidden="true" />{pill}</span>
      </div>
      <svg viewBox="0 0 356 528" className="ob-svg" role="group" aria-label={s.obSub}>
        <defs>
          <filter id="ob-blur" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="9" /></filter>
          <filter id="ob-blur-s" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="2.5" /></filter>
          <radialGradient id="ob-core">
            <stop offset="0" style={{ stopColor: 'var(--tint)', stopOpacity: 0.95 }} />
            <stop offset=".6" style={{ stopColor: 'var(--tint)', stopOpacity: 0.25 }} />
            <stop offset="1" style={{ stopColor: 'var(--tint)', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <circle cx={CX} cy={CY} r={RI} className="ob-orbit" />
        <circle cx={CX} cy={CY} r={RO} className="ob-orbit outer" />
        <path d={ROUTE} className={`ob-route${moving ? ' moving' : ''}`} />
        <path d={ROUTE_2} className={`ob-route${moving ? ' moving' : ''}`} />
        {moving && [0, 1, 2].map((i) => (
          <g key={i}>
            <circle r="5" style={{ fill: 'var(--tint)' }} filter="url(#ob-blur-s)" opacity=".9" />
            <circle r="2.6" fill="#fff" />
            <animateMotion dur="4.8s" begin={`${-i * 1.6}s`} repeatCount="indefinite" path={ROUTE} />
          </g>
        ))}
        <g className="ob-core"><circle cx={CX} cy={CY} r="52" fill="url(#ob-core)" /></g>
        <circle cx={CX} cy={CY} r="26" className="ob-me-dot" style={{ fill: 'var(--tint)' }} />
        <text x={CX} y={CY + 5} textAnchor="middle" className="ob-me">{s.obMe}</text>
        <g className="ob-sway">
          {side.map((a) => (
            <g key={a.id} className="ob-unsway">{node(a.id, a.group, a.x, a.y, 15, s.obNames[a.id as keyof typeof s.obNames], hot?.stop === a.id ? 'hot' : asleep ? 'sleep' : a.on ? 'on' : 'idle', a.y < CY - 50)}</g>
          ))}
        </g>
        {MAIN.map((m) => node(m.id, m.group, m.x, m.y, m.id === 'executor' ? 19 : 20, s.agentNames[m.id], hot?.stop === m.id ? 'hot' : !enabled(m.id) ? 'idle' : asleep ? 'sleep' : 'on'))}
        {capsule('start', 10, 'read', 'market', s.obStart, s.obStartSub(st.clock.open), s.obStartTag)}
        {capsule('end', 474, 'exec', 'broker', s.obEnd, st.mode === 'live' ? status : s.obEndPaper, s.obEndTag)}
      </svg>
      <div className="ob-steps" aria-hidden="true">
        {STAGE_GROUP.map((g, i) => <i key={i} style={i <= stage ? { background: ink(g) } : undefined} />)}
      </div>
      <div className="ob-now" aria-live="polite" style={line ? { background: soft(line.group) } : undefined}>
        {line ? (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ stroke: ink(line.group), flex: 'none' }} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[line.icon] ?? ICON.decision}</svg>
            <span>
              <b style={{ color: ink(line.group) }}>{line.name}:</b> <span dir="auto">{line.text}</span>
              {line.at && <> · <time dateTime={line.at} className="sub">{time(line.at, lang)}</time></>}
            </span>
          </>
        ) : (
          <span className="sub">{s.obHint}</span>
        )}
      </div>
      {detail ? (
        <div className="ob-detail" style={{ borderColor: ink(detail.group) }}>
          <div className="between" style={{ gap: 8 }}>
            <b className="ob-detail-name" style={{ color: ink(detail.group) }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ stroke: ink(detail.group), flex: 'none' }} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[detail.icon] ?? ICON.decision}</svg>
              {detail.name}
              {detail.state && <span className="sub"> · {detail.state}</span>}
            </b>
            <button type="button" className="ob-close" onClick={() => setPicked(null)} aria-label={s.obClose}>✕</button>
          </div>
          <dl>
            <dt>{s.obWhat}</dt>
            <dd>{detail.what}</dd>
            <dt>{s.obHow}</dt>
            <dd>{detail.how}</dd>
            <dt>{picked === 'calendar' ? s.obNext : s.obToday}</dt>
            <dd>
              {detail.note && <span className="ob-note" dir="auto">{detail.note}</span>}
              {detail.items.length > 0 ? (
                <ul>
                  {detail.items.map((it, i) => (
                    <li key={i}>
                      {it.at && <time dateTime={it.at} className="sub">{time(it.at, lang)}</time>}
                      <span dir="auto">{it.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                !detail.note && <span className="sub">{s.obNoneToday}</span>
              )}
            </dd>
          </dl>
        </div>
      ) : (
        <span className="sub ob-hint">{s.obHint}</span>
      )}
    </section>
  );
}
