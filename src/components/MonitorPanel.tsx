import { useCallback, useEffect, useState } from 'react';
import type { MonitorResult } from '../../shared/types';
import { api } from '../api';
import { sections } from '../monitorView';
import { useSettings } from '../settings';

const DAYS = [1, 7, 30, 90];

/** The monitoring numbers of the user's other site: read through MAAI's server, drawn as tiles and tables. */
export function MonitorPanel({ configured }: { configured: boolean }) {
  const { t, settings } = useSettings();
  const [days, setDays] = useState(30);
  const [result, setResult] = useState<MonitorResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback((span: number, fresh = false) => {
    setBusy(true);
    api.monitoring(span, fresh).then(setResult, () => setResult({ ok: false, why: 'unreachable' })).finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    if (configured) load(days);
  }, [configured, days, load]);

  if (!configured) return <section className="card"><p className="sub">{t.mon.noKey}</p></section>;
  const parts = result?.ok ? sections(result.data, t.mon.summary, settings.lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en') : [];

  return (
    <>
      <section className="card">
        <div className="seg" role="radiogroup" aria-label={t.mon.period}>
          {DAYS.map((d) => <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)}>{t.mon.days(d)}</button>)}
        </div>
        <div className="between">
          <span className="sub" aria-live="polite">{busy ? t.mon.loading : result?.ok ? t.mon.asOf(new Date(result.fetchedAt).toLocaleTimeString(settings.lang === 'ar' ? 'ar-SA' : 'en-GB', { hour: '2-digit', minute: '2-digit' })) : ''}</span>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => load(days, true)}>{t.mon.refresh}</button>
        </div>
        {result && !result.ok && <div className="error" role="alert">{t.mon.why(result.why, result.status)}</div>}
        {result?.ok && parts.length === 0 && <p className="sub">{t.mon.empty}</p>}
      </section>
      {parts.map((s, i) => (
        <section className="card" key={`${s.title}-${i}`}>
          <span className="section-label" style={{ padding: 0 }} dir="auto">{s.title}</span>
          {s.tiles.length > 0 && (
            <dl className="mon-tiles">
              {s.tiles.map((x, j) => <div key={j}><dt dir="auto">{x.name}</dt><dd dir="auto">{x.value}</dd></div>)}
            </dl>
          )}
          {s.tables.map((tb, j) => (
            <div key={j} className="mon-table-wrap">
              {tb.title && <strong className="sub" dir="auto">{tb.title}</strong>}
              <div className="mon-scroll" tabIndex={0} role="region" aria-label={tb.title || s.title}>
                <table className="mon-table">
                  {tb.columns.length > 0 && <thead><tr>{tb.columns.map((c) => <th key={c} scope="col" dir="auto">{c}</th>)}</tr></thead>}
                  <tbody>{tb.rows.map((r, k) => <tr key={k}>{r.map((c, m) => <td key={m} dir="auto">{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
              {tb.more > 0 && <span className="sub">{t.mon.more(tb.more)}</span>}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
