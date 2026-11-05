import type { UsageLevel } from '../../shared/types';

/**
 * Low, medium and high use, the same everywhere in the portal: green, amber, red, always with the word too (colour
 * alone is not enough to read it).
 */
const LEVEL_WORD: Record<UsageLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const LEVEL_COLOR: Record<UsageLevel, string> = { low: 'var(--success)', medium: 'var(--warn-text)', high: 'var(--danger)' };
const LEVEL_SOFT: Record<UsageLevel, string> = { low: 'var(--success-soft)', medium: 'var(--warn-soft)', high: 'var(--danger-soft)' };

export const levelOf = (value: number, medium: number, high: number): UsageLevel => (value >= high ? 'high' : value >= medium ? 'medium' : 'low');
const RANK: Record<UsageLevel, number> = { low: 0, medium: 1, high: 2 };
export const worstLevel = (levels: (UsageLevel | undefined)[]): UsageLevel => levels.reduce<UsageLevel>((w, l) => (l && RANK[l] > RANK[w] ? l : w), 'low');

export function LevelPill({ level, label }: { level: UsageLevel; label?: string }) {
  return (
    <span className="lv-pill" style={{ color: LEVEL_COLOR[level], background: LEVEL_SOFT[level] }}>
      <span aria-hidden="true" className="lv-dot" style={{ background: LEVEL_COLOR[level] }} />
      {label ?? LEVEL_WORD[level]}
    </span>
  );
}

/** A small line chart of recent values, in the level's colour. */
export function Spark({ values, level = 'low', height = 28 }: { values?: number[]; level?: UsageLevel; height?: number }) {
  if (!values || values.length < 2) return <span className="lv-spark" style={{ height }} aria-hidden="true" />;
  const max = Math.max(...values, 1e-9);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = 100 / (values.length - 1);
  const line = values.map((v, i) => `${(i * step).toFixed(2)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(2)}`).join(' ');
  return (
    <svg className="lv-spark" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden="true">
      <polygon points={`0,${height} ${line} 100,${height}`} fill={LEVEL_COLOR[level]} opacity="0.12" />
      <polyline points={line} fill="none" stroke={LEVEL_COLOR[level]} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** A bar filled to `pct`, in the level's colour, with the thresholds marked faintly. */
export function Meter({ pct, level, marks = [] }: { pct: number; level: UsageLevel; marks?: number[] }) {
  return (
    <span className="lv-meter" role="img" aria-label={`${Math.round(pct)}%, ${LEVEL_WORD[level].toLowerCase()}`}>
      <span style={{ width: `${Math.min(100, Math.max(2, pct))}%`, background: LEVEL_COLOR[level] }} />
      {marks.map((m) => <i key={m} style={{ insetInlineStart: `${m}%` }} />)}
    </span>
  );
}

/** One vital sign: what it is, its number, its level, and how it moved. */
export function Vital({ label, value, sub, level, series, href }: { label: string; value: string; sub?: string; level?: UsageLevel; series?: number[]; href?: string }) {
  const body = (
    <>
      <div className="between" style={{ gap: 8 }}>
        <span className="lv-label">{label}</span>
        {level && <LevelPill level={level} />}
      </div>
      <span className="lv-value">{value}</span>
      {sub && <span className="sub">{sub}</span>}
      {series && <Spark values={series} level={level} />}
    </>
  );
  return href ? <a href={href} className={`lv-vital lv-${level ?? 'none'}`}>{body}</a> : <div className={`lv-vital lv-${level ?? 'none'}`}>{body}</div>;
}

/** The legend, so the colours mean the same thing to everyone. */
export function LevelLegend() {
  return (
    <span className="row wrap sub" style={{ gap: 10 }}>
      <LevelPill level="low" label="Low use" />
      <LevelPill level="medium" label="Medium" />
      <LevelPill level="high" label="High: look at it" />
    </span>
  );
}

export const usd = (n: number) => `$${n.toFixed(n < 10 ? 2 : 0)}`;
export const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`);
