import { useCallback, useEffect, useState } from 'react';
import type { CloudUsage as Cloud, RateLimitInfo } from '../../shared/types';
import { api } from '../api';

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const usd = (n: number) => `$${n.toFixed(n < 10 ? 2 : 0)}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** One rate limit: how much is left of what Anthropic allows in the current window. */
function Limit({ label, info }: { label: string; info?: RateLimitInfo }) {
  if (!info || info.limit === undefined || info.remaining === undefined) return null;
  const used = Math.max(0, info.limit - info.remaining);
  const percent = info.limit ? Math.min(100, Math.round((used / info.limit) * 100)) : 0;
  return (
    <li className="row" style={{ gap: 12 }}>
      <span style={{ width: 120, flex: 'none' }}>{label}</span>
      <span aria-hidden="true" style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--sep)', overflow: 'hidden' }}>
        <span style={{ display: 'block', height: '100%', width: `${percent}%`, background: percent > 80 ? 'var(--danger)' : 'var(--tint)', borderRadius: 5 }} />
      </span>
      <span style={{ width: 250, flex: 'none', textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>
        {compact(info.remaining)} left of {compact(info.limit)}
        {info.resetAt ? ` · resets ${time(info.resetAt)}` : ''}
      </span>
    </li>
  );
}

/** What Anthropic itself reports for the key MAAI uses: live limits, and (with an admin key) tokens and cost. */
export function CloudUsage({ maaiThirtyDayTokens }: { maaiThirtyDayTokens: number }) {
  const [data, setData] = useState<Cloud | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback((refresh = false) => {
    setBusy(true);
    api
      .adminCloud(refresh)
      .then((d) => {
        setData(d);
        setError('');
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => load(), [load]);

  const days = data?.days ?? [];
  const sum = (pick: (d: Cloud['days'][number]) => number) => days.reduce((a, d) => a + pick(d), 0);
  const cloudTotal = sum((d) => d.uncachedInput + d.cacheRead + d.cacheWrite + d.output);
  const last14 = days.slice(-14);
  const peak = Math.max(1, ...last14.map((d) => d.uncachedInput + d.cacheRead + d.cacheWrite + d.output));
  const l = data?.limits;

  return (
    <section id="cloud" aria-label="Anthropic account" className="admin-card" style={{ gap: 18 }}>
      <div className="between wrap">
        <h2 className="h2" style={{ fontSize: 18 }}>Anthropic account · live</h2>
        <div className="row wrap">
          {data && <span className="sub">Key {data.key.hint}{data.key.matched ? ` · “${data.key.name}” · ${data.key.status}` : ''}</span>}
          <button className="admin-btn" onClick={() => load(true)} disabled={busy}>{busy ? 'Reading…' : 'Refresh'}</button>
        </div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}

      <div>
        <h3 className="h2" style={{ fontSize: 15 }}>Rate limits for this key</h3>
        {l ? (
          <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 8 }}>
            <Limit label="Requests" info={l.requests} />
            <Limit label="Input tokens" info={l.inputTokens} />
            <Limit label="Output tokens" info={l.outputTokens} />
            <Limit label="All tokens" info={l.tokens} />
            <li className="sub">As Anthropic reported at {time(l.updatedAt)}, on its latest answer to MAAI.</li>
          </ul>
        ) : (
          <p className="sub">Anthropic reports these with each answer. They appear after MAAI makes its first request.</p>
        )}
      </div>

      {data?.reports === 'ok' ? (
        <>
          <div className="metrics">
            <div className="admin-card" style={{ background: 'transparent' }}>
              <span className="sub" style={{ fontWeight: 600 }}>Tokens, 30 days ({data.scope === 'key' ? 'this key' : 'whole organization'})</span>
              <span style={{ fontSize: 26, fontWeight: 700 }}>{compact(cloudTotal)}</span>
              <span className="sub">
                {compact(sum((d) => d.uncachedInput + d.cacheWrite))} in · {compact(sum((d) => d.cacheRead))} cached · {compact(sum((d) => d.output))} out
              </span>
            </div>
            {data.cost && (
              <div className="admin-card" style={{ background: 'transparent' }}>
                <span className="sub" style={{ fontWeight: 600 }}>Cost, 30 days (whole organization)</span>
                <span style={{ fontSize: 26, fontWeight: 700 }}>{usd(data.cost.last30)}</span>
                <span className="sub">{usd(data.cost.today)} today</span>
              </div>
            )}
            <div className="admin-card" style={{ background: 'transparent' }}>
              <span className="sub" style={{ fontWeight: 600 }}>MAAI counted</span>
              <span style={{ fontSize: 26, fontWeight: 700 }}>{compact(maaiThirtyDayTokens)}</span>
              <span className="sub">
                {data.scope === 'key' && cloudTotal > 0 ? `${Math.round((maaiThirtyDayTokens / cloudTotal) * 100)}% of what Anthropic shows for this key` : 'tokens, last 30 days'}
              </span>
            </div>
          </div>
          <div>
            <h3 className="h2" style={{ fontSize: 15 }}>Per day · from Anthropic · last 14 days</h3>
            <ol style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 6 }}>
              {last14.map((d) => {
                const total = d.uncachedInput + d.cacheRead + d.cacheWrite + d.output;
                const cost = data.cost?.days.find((c) => c.day === d.day)?.usd;
                return (
                  <li key={d.day} className="row" style={{ gap: 12 }}>
                    <span className="sub" style={{ width: 84, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{d.day.slice(5)}</span>
                    <span aria-hidden="true" style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--sep)', overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${(total / peak) * 100}%`, background: 'var(--tint)', borderRadius: 5 }} />
                    </span>
                    <span style={{ width: 150, flex: 'none', textAlign: 'end', fontVariantNumeric: 'tabular-nums' }}>{compact(total)}{cost !== undefined ? ` · ${usd(cost)}` : ''}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </>
      ) : (
        data && (
          <div className="banner" role="status">
            {data.reports === 'needs-admin-key' ? (
              <>
                <strong>Tokens and cost from Anthropic need an Admin API key.</strong> {data.message}
              </>
            ) : (
              data.message
            )}
          </div>
        )
      )}
      {data?.message && data.reports === 'ok' && <p className="sub">{data.message}</p>}
      <p className="sub">
        Your remaining prepaid credit is not available through any API: see it in the Claude Console under <a href="https://platform.claude.com/usage" target="_blank" rel="noreferrer">Usage</a> and <a href="https://platform.claude.com/cost" target="_blank" rel="noreferrer">Cost</a>.
      </p>
    </section>
  );
}
