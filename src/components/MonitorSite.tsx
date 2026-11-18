import { useState } from 'react';
import type { SiteView } from '../monitorSite';
import { useSettings } from '../settings';

/** The site's state, its checked parts, and its visitors (numbers and a day-by-day chart). */
export function MonitorSite({ site }: { site: SiteView }) {
  const { t, settings } = useSettings();
  const ar = settings.lang === 'ar';
  const n = (v?: number) => (v === undefined ? '—' : new Intl.NumberFormat(ar ? 'ar-SA' : 'en', { maximumFractionDigits: 0 }).format(v));
  const when = (iso?: string) => {
    const d = iso ? new Date(iso) : null;
    return d && !Number.isNaN(d.getTime()) ? d.toLocaleString(ar ? 'ar-SA' : 'en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  };
  const v = site.visitors;

  return (
    <>
      <section className={`card mon-state ${site.up ? 'up' : 'down'}`} aria-labelledby="mon-state">
        <div className="between">
          <strong id="mon-state" dir="auto">{site.service || t.mon.site}</strong>
          <span className="mon-pill"><span aria-hidden="true">{site.up ? '●' : '▲'}</span> {site.up ? t.mon.up : t.mon.down(site.status)}</span>
        </div>
        {site.parts.map((p) => (
          <div className="between mon-part" key={p.name}>
            <span>{t.mon.part(p.name)}</span>
            <span className={p.up ? 'mon-ok' : 'mon-bad'}>{p.up ? t.mon.partUp : p.state}{p.ms !== undefined ? `${ar ? '، ' : ', '}${t.mon.ms(n(p.ms))}` : ''}</span>
          </div>
        ))}
        {site.checkedAt && <span className="sub">{t.mon.checked(when(site.checkedAt))}</span>}
      </section>

      {v && (
        <section className="card" aria-labelledby="mon-visitors">
          <span className="section-label" id="mon-visitors" style={{ padding: 0 }}>{t.mon.visitors}</span>
          <dl className="mon-tiles">
            <div className="mon-hero"><dt>{t.mon.today}</dt><dd>{n(v.today)}</dd></div>
            <div><dt>{t.mon.yesterday}</dt><dd>{n(v.yesterday)}</dd></div>
            <div><dt>{t.mon.week}</dt><dd>{n(v.week)}</dd></div>
            <div><dt>{t.mon.month}</dt><dd>{n(v.month)}</dd></div>
            {v.total !== undefined && <div><dt>{t.mon.total}</dt><dd>{n(v.total)}</dd></div>}
          </dl>
          {v.daily.length > 1 && <DailyChart daily={v.daily} fmt={n} ar={ar} />}
          <span className="sub">
            {v.definition ? `${t.mon.counted}: ` : ''}{v.definition && <bdi dir="auto">{v.definition}</bdi>}
            {v.since ? `${v.definition ? (ar ? '، ' : ', ') : ''}${t.mon.since(v.since)}` : ''}
          </span>
        </section>
      )}
    </>
  );
}

/** Visitors per day: one bar each, oldest on the left. Tap a bar to read its day; a table is there too. */
function DailyChart({ daily, fmt, ar }: { daily: { date: string; count: number }[]; fmt: (v?: number) => string; ar: boolean }) {
  const { t } = useSettings();
  const [picked, setPicked] = useState(daily.length - 1);
  const W = 320;
  const H = 120;
  const top = Math.max(1, ...daily.map((d) => d.count));
  const step = W / daily.length;
  const gap = 2;
  const bar = Math.max(2, step - gap);
  const day = (iso: string, long = false) => new Date(`${iso}T12:00:00`).toLocaleDateString(ar ? 'ar-SA' : 'en-GB', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' });
  const p = daily[Math.min(picked, daily.length - 1)];
  const busiest = daily.reduce((a, b) => (b.count > a.count ? b : a));

  return (
    <figure className="mon-chart">
      <p className="mon-readout" aria-live="polite"><b>{fmt(p.count)}</b> {t.mon.on(day(p.date, true))}</p>
      <svg viewBox={`0 0 ${W} ${H + 18}`} style={{ direction: 'ltr' }} role="img" aria-label={t.mon.chartLabel(daily.length, fmt(busiest.count), day(busiest.date, true))}>
        <line x1="0" x2={W} y1={H} y2={H} className="mon-base" />
        <text x="0" y="10" className="mon-axis">{fmt(top)}</text>
        {daily.map((d, i) => {
          const h = d.count ? Math.max(3, (d.count / top) * (H - 16)) : 0;
          const x = i * step + gap / 2;
          return (
            <g key={d.date}>
              {h > 0 && <path className={i === picked ? 'mon-bar on' : 'mon-bar'} d={`M${x},${H} v${-(h - 4)} q0,-4 4,-4 h${bar - 8} q4,0 4,4 v${h - 4} z`} />}
              {/* The whole column takes the tap, not just the bar. */}
              <rect x={i * step} y="0" width={step} height={H} fill="transparent" onPointerEnter={() => setPicked(i)} onClick={() => setPicked(i)}>
                <title>{`${day(d.date)}: ${fmt(d.count)}`}</title>
              </rect>
            </g>
          );
        })}
        <text x="0" y={H + 14} className="mon-axis">{day(daily[0].date)}</text>
        <text x={W} y={H + 14} textAnchor="end" className="mon-axis">{day(daily[daily.length - 1].date)}</text>
      </svg>
      <details className="mon-as-table">
        <summary>{t.mon.asTable}</summary>
        <div className="mon-scroll">
          <table className="mon-table">
            <thead><tr><th scope="col">{t.mon.day}</th><th scope="col">{t.mon.visitors}</th></tr></thead>
            <tbody>{[...daily].reverse().map((d) => <tr key={d.date}><td>{day(d.date, true)}</td><td>{fmt(d.count)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
