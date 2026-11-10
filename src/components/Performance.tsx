import type { TradingState } from '../../shared/trading';
import { api } from '../api';
import { useSettings } from '../settings';

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}%`;
const tone = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

/** Two lines that both start at 100: ours (solid) and the index (dashed). */
function Lines({ points, label }: { points: { a: number; b: number }[]; label: string }) {
  if (points.length < 2) return null;
  const all = points.flatMap((p) => [p.a, p.b]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const x = (i: number) => (i / (points.length - 1)) * 300;
  const y = (v: number) => 76 - ((v - lo) / (hi - lo || 1)) * 72;
  const path = (key: 'a' | 'b') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join('');
  return (
    <svg viewBox="0 0 300 80" className="pf-chart" role="img" aria-label={label} preserveAspectRatio="none">
      <line x1="0" x2="300" y1={y(100)} y2={y(100)} className="pf-base" />
      <path d={path('b')} className="pf-index" />
      <path d={path('a')} className="pf-ours" />
    </svg>
  );
}

/** «الأداء مقابل المؤشر»: the desk against its index since it started, and the plain rule replayed over two years. */
export function Performance({ st, busy, act }: { st: TradingState; busy: boolean; act: (run: () => Promise<TradingState>) => Promise<boolean> }) {
  const { t, settings } = useSettings();
  const s = t.ss;
  const index = st.indexName[settings.lang === 'ar' ? 'ar' : 'en'];
  const b = st.benchmark;
  const r = st.replay;
  return (
    <section className="card dk" aria-label={s.pfTitle(index)}>
      <div>
        <h2 className="h2" style={{ margin: 0 }}>{s.pfTitle(index)}</h2>
        <span className="sub">{b ? s.pfSince(b.since, b.days) : s.pfNoDays}</span>
      </div>
      {b && (
        <>
          <div className="pf-pair">
            <div><b className={tone(b.deskPct)} dir="ltr">{signed(b.deskPct)}</b><span>{s.pfDesk}</span></div>
            <div><b className={tone(b.indexPct)} dir="ltr">{signed(b.indexPct)}</b><span>{index}</span></div>
            <div><b className={tone(b.deskPct - b.indexPct)} dir="ltr">{signed(b.deskPct - b.indexPct)}</b><span>{s.pfDiff}</span></div>
          </div>
          <Lines points={b.points.map((p) => ({ a: p.desk, b: p.index }))} label={s.pfTitle(index)} />
        </>
      )}
      <div className="pf-replay">
        <div className="between wrap" style={{ gap: 8 }}>
          <div>
            <b>{s.pfReplay}</b>
            <span className="sub" style={{ display: 'block' }}>{r ? s.pfReplayRange(r.from, r.to, r.symbols) : s.pfReplaySub}</span>
          </div>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => act(api.tradingReplay)}>{r ? s.pfAgain : s.pfRun}</button>
        </div>
        {r && (
          <>
            <div className="pf-pair">
              <div><b className={tone(r.rulePct)} dir="ltr">{signed(r.rulePct)}</b><span>{s.pfRule}</span></div>
              <div><b className={tone(r.indexPct)} dir="ltr">{signed(r.indexPct)}</b><span>{index}</span></div>
              <div><b className={tone(r.rulePct - r.indexPct)} dir="ltr">{signed(r.rulePct - r.indexPct)}</b><span>{s.pfDiff}</span></div>
            </div>
            <Lines points={r.curve.map((p) => ({ a: p.rule, b: p.index }))} label={s.pfReplay} />
            <span className="sub">{s.pfReplayStats(r.trades, r.wins, r.losses, r.maxDrawdownPct)}</span>
          </>
        )}
        <span className="sub">{s.pfLegend(index)} {s.pfNote}</span>
      </div>
    </section>
  );
}
