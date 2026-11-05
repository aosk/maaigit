import type { Gauge, RenderUsage as Usage } from '../../shared/types';
import { LevelLegend, LevelPill, Meter, Spark, mb, usd } from './levels';

const MARKS: Record<string, number[]> = { memory: [60, 85], cpu: [50, 80], disk: [60, 85] };

function GaugeRow({ name, g, kind, note }: { name: string; g?: Gauge; kind: 'memory' | 'cpu' | 'disk'; note?: string }) {
  if (!g || g.pct === undefined || !g.level) return null;
  const amount = kind === 'cpu' ? `${Math.round(g.pct)}% of ${g.limit} CPU at the busiest` : `${mb(g.used)} of ${mb(g.limit ?? 0)}`;
  return (
    <div className="rd-gauge">
      <div className="between" style={{ gap: 8 }}>
        <strong>{name}</strong>
        <LevelPill level={g.level} />
      </div>
      <Meter pct={g.pct} level={g.level} marks={MARKS[kind]} />
      <div className="between sub" style={{ gap: 8 }}>
        <span>{amount}</span>
        <span>{note}</span>
      </div>
      {g.series && g.series.length > 2 && <Spark values={g.series} level={g.level} />}
    </div>
  );
}

const TYPE: Record<string, string> = { web_service: 'Web', private_service: 'Private', static_site: 'Static site', background_worker: 'Worker', cron_job: 'Cron' };

/** Render: the monthly bill (estimated), every service in the workspace, and how hard this server is working. */
export function RenderUsage({ data, error, busy, reload }: { data: Usage | null; error: string; busy: boolean; reload: () => void }) {
  const self = data?.self;
  const memory = self?.memory ?? data?.local.memory;
  const cpu = self?.cpu ?? data?.local.cpu;
  return (
    <section aria-label="Render hosting" className="admin-card" style={{ gap: 18 }}>
      <div className="between wrap">
        <div>
          <h2 className="h2" style={{ fontSize: 18 }}>Render hosting</h2>
          <span className="sub">Where MAAI runs · {data?.reports === 'ok' ? 'live from Render' : 'this machine only'}</span>
        </div>
        <button className="admin-btn" onClick={reload} disabled={busy}>{busy ? 'Reading…' : 'Refresh'}</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <LevelLegend />

      {data?.monthly && (
        <div className="rd-bill">
          <div>
            <span className="lv-label">This month, estimated</span>
            <div className="lv-value" style={{ fontSize: 34 }}>{usd(data.monthly.usd)}</div>
            <span className="sub">
              {data.monthly.running} paid running · {data.monthly.free} free · {data.monthly.suspended} suspended
              {data.monthly.idleUsd ? ` (${usd(data.monthly.idleUsd)} still paid for their disks)` : ''}
            </span>
          </div>
          <LevelPill level={data.monthly.level} label={data.monthly.level === 'low' ? 'Low cost' : data.monthly.level === 'medium' ? 'Medium cost' : 'High cost'} />
        </div>
      )}

      <div className="rd-gauges">
        <GaugeRow name="Memory" g={memory} kind="memory" note={self?.memory ? 'last 24 h' : 'now'} />
        <GaugeRow name="CPU" g={cpu} kind="cpu" note={self?.cpu ? 'last 24 h' : 'last hour'} />
        <GaugeRow name="Disk (your data)" g={data?.local.disk} kind="disk" note="now" />
        {self?.bandwidth && (
          <div className="rd-gauge">
            <div className="between" style={{ gap: 8 }}><strong>Bandwidth</strong><LevelPill level={self.bandwidth.level} /></div>
            <Meter pct={(self.bandwidth.projectedMonthMB / self.bandwidth.includedMB) * 100} level={self.bandwidth.level} marks={[50, 80]} />
            <div className="between sub" style={{ gap: 8 }}><span>{mb(self.bandwidth.last30MB)} in 30 days</span><span>~{mb(self.bandwidth.projectedMonthMB)} a month of {mb(self.bandwidth.includedMB)} included</span></div>
            <Spark values={self.bandwidth.series} level={self.bandwidth.level} />
          </div>
        )}
        {self?.requests && (
          <div className="rd-gauge">
            <div className="between" style={{ gap: 8 }}><strong>Server errors</strong><LevelPill level={self.requests.level} /></div>
            <Meter pct={Math.min(100, self.requests.errorRate * 10)} level={self.requests.level} marks={[10, 50]} />
            <div className="between sub" style={{ gap: 8 }}><span>{self.requests.errors24h} of {self.requests.total24h.toLocaleString('en-US')} requests ({self.requests.errorRate}%)</span><span>last 24 h</span></div>
            <Spark values={self.requests.series} level={self.requests.level} />
          </div>
        )}
      </div>
      {self?.requests && self.requests.errors24h > 0 && <p className="sub">Errors during a deploy are normal: the server restarts for about a minute. Many errors outside deploys need a look.</p>}

      {data?.reports === 'needs-key' && (
        <div className="rd-setup">
          <strong>See the bill, every service, bandwidth and errors</strong>
          <ol>
            <li>Render → your avatar → <b>Account settings</b> → <b>API keys</b> → <b>Create API key</b>.</li>
            <li>Render → <b>maaigit</b> → <b>Environment</b> → add <code>RENDER_API_KEY</code> with that key → Save.</li>
            <li>Render restarts MAAI; this card then fills in by itself.</li>
          </ol>
          <span className="sub">Until then it shows this machine only. The key stays on Render; it is never shown here.</span>
        </div>
      )}
      {data?.reports === 'error' && <div className="banner" role="status">{data.message}</div>}
      {data?.reports === 'ok' && data.message && <p className="sub">{data.message}</p>}

      {data?.services && (
        <div style={{ overflowX: 'auto' }}>
          <table className="admin-table rd-table">
            <thead>
              <tr><th>Service</th><th>Plan</th><th style={{ textAlign: 'end' }}>A month</th></tr>
            </thead>
            <tbody>
              {data.services.map((s) => (
                <tr key={s.id} className={s.suspended ? 'rd-off' : undefined}>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      {s.dashboardUrl ? <a href={s.dashboardUrl} target="_blank" rel="noreferrer">{s.name}</a> : s.name}
                      {s.self && <span className="tag-chip" style={{ marginInlineStart: 8 }}>MAAI</span>}
                    </div>
                    <div className="sub">{TYPE[s.type] ?? s.type}{s.suspended ? ' · suspended' : ''}{s.note ? ` · ${s.note}` : ''}</div>
                  </td>
                  <td>{s.plan}{s.diskGB ? ` + ${s.diskGB} GB disk` : ''}</td>
                  <td style={{ textAlign: 'end', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.monthlyUsd ? usd(s.monthlyUsd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="sub">
        An estimate from Render’s published prices (instances, and $0.25 per GB of disk). Render’s API has no invoice, so the real bill, build minutes and any workspace plan are under <a href="https://dashboard.render.com/billing" target="_blank" rel="noreferrer">Render → Billing</a>.
      </p>
    </section>
  );
}
