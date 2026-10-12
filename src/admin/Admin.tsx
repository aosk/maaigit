import { useCallback, useEffect, useState } from 'react';
import type { AdminOverview, AgentSetting } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { Moon } from '../components/Icons';

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

const OUTCOME_STYLE: Record<string, string> = {
  approved: 'var(--success-soft);var(--success)',
  done: 'var(--tint-soft);var(--tint-text)',
  cancelled: 'var(--raised);var(--text2)',
  blocked: 'var(--danger-soft);var(--danger)',
  error: 'var(--danger-soft);var(--danger)',
};

function Badge({ outcome, label }: { outcome: string; label?: string }) {
  const [bg, fg] = (OUTCOME_STYLE[outcome] ?? OUTCOME_STYLE.done).split(';');
  return <span className="badge" style={{ background: bg, color: fg }}>{label ?? outcome[0].toUpperCase() + outcome.slice(1)}</span>;
}

/** The admin portal from the design: live counts, agent switches, integration health and the audit log. */
export function Admin() {
  const { settings, update } = useSettings();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(() => {
    api.admin().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 10_000);
    return () => clearInterval(timer);
  }, [load]);

  async function flip(agent: AgentSetting) {
    await api.setAgent(agent.id, !agent.enabled);
    load();
  }

  const dark = settings.look === 'dark' || (settings.look === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const audit = (data?.audit ?? []).filter((a) => !query || `${a.event} ${a.who}`.toLowerCase().includes(query.toLowerCase()));
  const metrics = data
    ? [
        { label: 'Requests to MAAI', value: data.counts.chats, note: `${data.counts.drafts} reply drafts` },
        { label: 'Proposals made', value: data.counts.proposals, note: `${data.counts.approved} approved · ${data.counts.cancelled} cancelled` },
        { label: 'Approval rate', value: data.approvalRate === null ? '—' : `${Math.round(data.approvalRate * 100)}%`, note: 'cards users approved' },
        { label: 'Calendar items', value: data.counts.events, note: `${data.counts.reminders} reminders` },
        { label: 'Claude usage', value: data.usage.requests, note: `${(data.usage.inputTokens / 1000).toFixed(1)}k in · ${(data.usage.outputTokens / 1000).toFixed(1)}k out tokens` },
      ]
    : [];

  return (
    <div className="admin" dir="ltr" lang="en">
      <nav className="admin-nav" aria-label="Admin sections">
        <div className="row" style={{ padding: '0 8px 20px' }}>
          <div className="admin-logo">M</div>
          <div><div style={{ fontWeight: 700, fontSize: 15 }}>MAAI Admin</div><div className="sub">Local</div></div>
        </div>
        <a href="#/admin" aria-current="page">Overview</a>
        <a href="#agents">Agents</a>
        <a href="#integrations">Integrations</a>
        <a href="#audit">Safety &amp; audit</a>
        <a href="#/today" style={{ marginTop: 'auto' }}>← Back to the app</a>
      </nav>

      <main className="admin-main">
        <header className="between wrap">
          <div>
            <h1 style={{ fontSize: 28 }}>Overview</h1>
            <span className="sub">Everything MAAI has done on this computer · refreshes every 10 seconds</span>
          </div>
          <div className="row wrap">
            <label htmlFor="search" className="sr-only">Search the audit log</label>
            <input id="search" className="admin-input" placeholder="Search the audit log" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="admin-btn" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => update({ look: dark ? 'light' : 'dark' })}>
              <Moon size={18} />
            </button>
          </div>
        </header>

        {error && <div className="error" role="alert">{error}</div>}

        <section aria-label="Key metrics" className="metrics">
          {metrics.map((m) => (
            <div key={m.label} className="admin-card">
              <span className="sub" style={{ fontWeight: 600 }}>{m.label}</span>
              <span style={{ fontSize: 28, fontWeight: 700 }}>{m.value}</span>
              <span className="sub">{m.note}</span>
            </div>
          ))}
        </section>

        <div className="row wrap" style={{ alignItems: 'stretch', gap: 24 }}>
          <section id="agents" aria-label="Agents" className="admin-card" style={{ flex: '999 1 520px', minWidth: 0 }}>
            <h2 className="h2" style={{ fontSize: 18 }}>Agents</h2>
            <div style={{ overflowX: 'auto' }}>
              <table className="admin-table">
                <thead><tr><th>Agent</th><th>Model</th><th>Needs approval for</th><th>Status</th><th>On</th></tr></thead>
                <tbody>
                  {data?.agents.map((a) => (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td className="sub">{data.status.aiConfigured ? data.status.model : 'Demo'}</td>
                      <td>{a.needsApprovalFor}</td>
                      <td><Badge outcome={a.enabled ? 'approved' : 'cancelled'} label={a.enabled ? 'Running' : 'Paused'} /></td>
                      <td>
                        <button role="switch" className="switch" aria-checked={a.enabled} aria-label={`Enable ${a.name} agent`} onClick={() => flip(a)}>
                          <span />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="integrations" aria-label="Integrations" className="admin-card" style={{ flex: '1 1 300px', minWidth: 0 }}>
            <h2 className="h2" style={{ fontSize: 18 }}>Integrations</h2>
            {[
              { name: 'Claude API', ok: data?.status.aiConfigured, okText: 'Connected', offText: 'Not set (demo mode)' },
              { name: 'Prayer times (Umm al-Qura)', ok: true, okText: data ? data.status.location.timezone : '…', offText: '' },
              { name: 'WhatsApp hand-off', ok: true, okText: 'Ready (wa.me link)', offText: '' },
              { name: 'Voice input', ok: true, okText: 'In Chrome / Edge', offText: '' },
              { name: 'Google / Outlook calendar', ok: false, okText: '', offText: 'Not connected yet' },
            ].map((i) => (
              <div key={i.name} className="between" style={{ minHeight: 44, gap: 16, borderBottom: '1px solid var(--sep)' }}>
                <span>{i.name}</span>
                <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'end', color: i.ok ? 'var(--success)' : 'var(--warn-text)' }}>
                  {i.ok ? `● ${i.okText}` : `▲ ${i.offText}`}
                </span>
              </div>
            ))}
          </section>
        </div>

        <section id="audit" aria-label="Audit log" className="admin-card">
          <div className="between wrap">
            <h2 className="h2" style={{ fontSize: 18 }}>Safety &amp; audit</h2>
            <span className="sub">Every proposal, approval and admin change is logged</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table">
              <thead><tr><th>Time</th><th>Event</th><th>Who</th><th>Outcome</th></tr></thead>
              <tbody>
                {audit.length === 0 && <tr><td colSpan={4} className="sub">Nothing yet. Use the app and actions appear here.</td></tr>}
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="sub" style={{ whiteSpace: 'nowrap' }}>{when(a.at)}</td>
                    <td>{a.event}</td>
                    <td>{a.who}</td>
                    <td><Badge outcome={a.outcome} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
