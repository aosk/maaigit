import { useCallback, useEffect, useState } from 'react';
import type { HealthLevel, HealthReport } from '../../shared/types';
import { api } from '../api';

const COLOR: Record<HealthLevel, string> = { ok: 'var(--success)', warn: 'var(--warn-text)', fail: 'var(--danger)', off: 'var(--text2)' };
const WORD: Record<HealthLevel, string> = { ok: 'Working', warn: 'Needs a look', fail: 'Not working', off: 'Off' };
const OVERALL: Record<HealthReport['status'], string> = { ok: 'All systems working', warn: 'Working, with something to look at', fail: 'Something is not working' };

const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(iso));

/** Every part of MAAI at a glance: green working, amber needs a look, red not working, grey not set up. */
export function Health() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState('');

  const load = useCallback((background = false) => {
    api
      .health(background)
      .then((r) => {
        setReport(r);
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(() => document.hidden || load(true), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <section id="health" aria-label="Server health" className="admin-card">
      <div className="between wrap">
        <h2 className="h2" style={{ fontSize: 18 }}>Server health</h2>
        <button className="admin-btn" onClick={() => load()}>Check now</button>
      </div>
      {error && <div className="error" role="alert">The server did not answer: {error}</div>}
      {report && (
        <>
          <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 17 }}>
            <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 7, background: COLOR[report.status] }} />
            {OVERALL[report.status]}
          </div>
          <span className="sub">
            Checked {time(report.checkedAt)} · running since {time(report.startedAt)}
            {report.version ? ` · version ${report.version}` : ''} · refreshes every 30 seconds
          </span>
          <div style={{ display: 'grid', gap: 2 }}>
            {report.checks.map((c) => (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: '14px 1fr', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--sep)' }}>
                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, marginTop: 6, background: COLOR[c.status] }} />
                <div style={{ minWidth: 0 }}>
                  <div className="between wrap">
                    <strong>{c.name}</strong>
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLOR[c.status] }}>{WORD[c.status]}</span>
                  </div>
                  <div className="sub" style={{ overflowWrap: 'anywhere' }}>{c.detail}</div>
                  {c.fix && <div style={{ fontSize: 13, marginTop: 2 }}>→ {c.fix}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
