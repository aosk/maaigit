import type { MarketPulse as Pulse } from '../../shared/trading';
import { useSettings } from '../settings';

/** The mood's colour, from red (falling hard) to green (rising strongly). */
export const MOOD_COLOR: Record<Pulse['mood'], string> = {
  strong_down: 'var(--danger)',
  down: '#e8743b',
  mixed: 'var(--warn-bar, #dc6803)',
  up: '#4fb07f',
  strong_up: 'var(--success)',
};
const SEGMENTS: Pulse['mood'][] = ['strong_down', 'down', 'mixed', 'up', 'strong_up'];
/** Where each mood starts on the -100..100 scale (as in server/trading/pulse.ts). */
const EDGES = [-100, -40, -12, 12, 40, 100];

const signedPct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

/** A half-dial: five coloured bands, and a needle at the score. */
function Dial({ score, mood }: { score: number; mood: Pulse['mood'] }) {
  const cx = 100;
  const cy = 96;
  const r = 78;
  // -100 is the left end (180°), +100 the right end (0°).
  const at = (v: number) => Math.PI * (1 - (v + 100) / 200);
  const point = (v: number, radius = r) => [cx + radius * Math.cos(at(v)), cy - radius * Math.sin(at(v))] as const;
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const [nx, ny] = point(score, r - 18);
  return (
    <svg viewBox="0 0 200 128" className="mp-dial" role="img" aria-label={`${score} / 100`}>
      {SEGMENTS.map((m, i) => (
        <path key={m} d={arc(EDGES[i] + (i ? 1.5 : 0), EDGES[i + 1] - (i < 4 ? 1.5 : 0))} stroke={MOOD_COLOR[m]} strokeWidth="14" fill="none" opacity={m === mood ? 1 : 0.28} strokeLinecap="butt" />
      ))}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="mp-needle" />
      <circle cx={cx} cy={cy} r="7" fill="currentColor" />
      <text x={cx} y={cy + 30} textAnchor="middle" fontSize="20" fontWeight="800" fill="currentColor" direction="ltr">{score > 0 ? `+${score}` : score}</text>
    </svg>
  );
}

/** The general market indicator: the dial and its word, TASI, how the followed stocks move together, and the news risk. */
export function MarketPulse({ pulse }: { pulse: Pulse }) {
  const { t } = useSettings();
  const s = t.ss;
  const { up, down, flat } = pulse.breadth;
  const n = up + down + flat || 1;
  const i = pulse.index;
  return (
    <section className="card mp" aria-label={s.pulseTitle}>
      <div className="between" style={{ gap: 8 }}>
        <h2 className="h2" style={{ margin: 0 }}>{s.pulseTitle}</h2>
        <span className={`mp-risk mp-risk-${pulse.risk}`}>{s.pulseRisk[pulse.risk]}</span>
      </div>
      <div className="mp-top">
        <Dial score={pulse.score} mood={pulse.mood} />
        <div className="mp-read">
          <span className="mp-mood" style={{ color: MOOD_COLOR[pulse.mood] }}>{s.pulseMood[pulse.mood]}</span>
          {i ? (
            <>
              <span className="mp-index">
                {s.pulseIndex} <bdi dir="ltr">{i.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}</bdi>{' '}
                <bdi dir="ltr" className={i.changePct > 0 ? 'up' : i.changePct < 0 ? 'down' : ''}>{signedPct(i.changePct)}</bdi> <span className="sub">{s.pulseToday}</span>
              </span>
              {i.vsAvg20Pct !== undefined && <span className="sub">{i.vsAvg20Pct >= 0 ? s.pulseAboveAvg(Math.abs(i.vsAvg20Pct).toFixed(1)) : s.pulseBelowAvg(Math.abs(i.vsAvg20Pct).toFixed(1))}</span>}
            </>
          ) : (
            <span className="sub">{s.pulseNoIndex}</span>
          )}
        </div>
      </div>
      <div>
        <div className="between sub" style={{ gap: 8, marginBottom: 4 }}>
          <span>{s.pulseFollowed}</span>
          <span>{s.pulseBreadth(up, flat, down)}</span>
        </div>
        <div className="mp-breadth" role="img" aria-label={s.pulseBreadth(up, flat, down)}>
          <i style={{ width: `${(up / n) * 100}%`, background: 'var(--success)' }} />
          <i style={{ width: `${(flat / n) * 100}%`, background: 'var(--sep)' }} />
          <i style={{ width: `${(down / n) * 100}%`, background: 'var(--danger)' }} />
        </div>
      </div>
      {pulse.reasons.length > 0 && (
        <details className="mp-why">
          <summary>{s.pulseWhy}</summary>
          <ul>{pulse.reasons.map((r) => <li key={r} dir="auto">{r}</li>)}</ul>
          <p className="sub">{s.pulseNote}</p>
        </details>
      )}
    </section>
  );
}
