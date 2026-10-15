import type { UsagePurpose, UsageRow } from '../../shared/types';

const LABELS: Record<UsagePurpose, string> = {
  chat: 'Assistant chat',
  briefing: 'Daily briefing',
  'email-digest': 'Email summary',
  'email-draft': 'Reply drafts',
  whatsapp: 'WhatsApp summary',
};

const total = (r: Pick<UsageRow, 'input' | 'cached' | 'output'>) => r.input + r.cached + r.output;
const sum = (rows: UsageRow[]) => rows.reduce((a, r) => ({ input: a.input + r.input, cached: a.cached + r.cached, output: a.output + r.output, requests: a.requests + r.requests, hits: a.hits + (r.hits ?? 0) }), { input: 0, cached: 0, output: 0, requests: 0, hits: 0 });
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** Local YYYY-MM-DD, matching the day keys the server writes (the app's time zone). */
function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** How many tokens Claude has used: today, this week, this month, by feature, and day by day. */
export function TokenUsage({ rows, timeZone, allTime }: { rows: UsageRow[]; timeZone: string; allTime: { inputTokens: number; outputTokens: number; requests: number } }) {
  const now = new Date();
  const days = Array.from({ length: 14 }, (_, i) => dayKey(new Date(now.getTime() - (13 - i) * 86_400_000), timeZone));
  const since = (n: number) => dayKey(new Date(now.getTime() - (n - 1) * 86_400_000), timeZone);
  const today = sum(rows.filter((r) => r.day === days[13]));
  const week = sum(rows.filter((r) => r.day >= since(7)));
  const month = sum(rows);

  const byPurpose = (Object.keys(LABELS) as UsagePurpose[])
    .map((purpose) => ({ purpose, ...sum(rows.filter((r) => r.purpose === purpose)) }))
    .filter((r) => r.requests > 0 || r.hits > 0)
    .sort((a, b) => total(b) - total(a));
  const monthTotal = total(month) || 1;

  const perDay = days.map((day) => ({ day, ...sum(rows.filter((r) => r.day === day)) }));
  const peak = Math.max(1, ...perDay.map(total));

  const tiles = [
    { label: 'Today', ...today },
    { label: 'Last 7 days', ...week },
    { label: 'Last 30 days', ...month },
  ];

  return (
    <section id="usage" aria-label="Token utilization" className="admin-card" style={{ gap: 20 }}>
      <div className="between wrap">
        <h2 className="h2" style={{ fontSize: 18 }}>Token utilization</h2>
        <span className="sub">All time: {compact(allTime.inputTokens + allTime.outputTokens)} tokens · {allTime.requests} requests</span>
      </div>

      <div className="metrics">
        {tiles.map((t) => (
          <div key={t.label} className="admin-card" style={{ background: 'transparent' }}>
            <span className="sub" style={{ fontWeight: 600 }}>{t.label}</span>
            <span style={{ fontSize: 26, fontWeight: 700 }}>{compact(total(t))}</span>
            <span className="sub">{t.requests} request{t.requests === 1 ? '' : 's'}{t.hits ? ` (+${t.hits} reused)` : ''} · {compact(t.input + t.cached)} in · {compact(t.output)} out</span>
          </div>
        ))}
      </div>

      <div>
        <h3 className="h2" style={{ fontSize: 15 }}>By feature · last 30 days</h3>
        {byPurpose.length === 0 ? (
          <p className="sub">No Claude requests recorded yet. Use the assistant and this fills in.</p>
        ) : (
          <div style={{ overflowX: 'auto' }} role="region" aria-label="Token use by feature" tabIndex={0}>
            <table className="admin-table">
              <thead><tr><th>Feature</th><th>Requests</th><th>Reused</th><th>Input</th><th>From cache</th><th>Output</th><th>Total</th><th>Share</th></tr></thead>
              <tbody>
                {byPurpose.map((r) => (
                  <tr key={r.purpose}>
                    <td>{LABELS[r.purpose]}</td>
                    <td>{r.requests}</td>
                    <td>{r.hits}</td>
                    <td>{compact(r.input)}</td>
                    <td>{compact(r.cached)}</td>
                    <td>{compact(r.output)}</td>
                    <td><strong>{compact(total(r))}</strong></td>
                    <td>{Math.round((total(r) / monthTotal) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="h2" style={{ fontSize: 15 }}>Per day · last 14 days</h3>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
          {perDay.map((d) => (
            <li key={d.day} className="row" style={{ gap: 12 }}>
              <span className="sub" style={{ width: 84, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{d.day.slice(5)}</span>
              <span aria-hidden="true" style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--sep)', overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${(total(d) / peak) * 100}%`, background: 'var(--tint)', borderRadius: 5 }} />
              </span>
              <span style={{ width: 130, flex: 'none', textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{compact(total(d))} · {d.requests} req</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="sub">Reused = answers served from the saved copy because nothing had changed, so no tokens were spent. Input counts everything sent to Claude, including tokens it read from its cache (shown separately). Counts are kept for 90 days.</p>
    </section>
  );
}
