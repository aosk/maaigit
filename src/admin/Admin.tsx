import { useCallback, useEffect, useState } from 'react';
import type { AdminOverview, AgentSetting } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { Moon } from '../components/Icons';
import { TokenUsage } from './TokenUsage';
import { CloudUsage } from './CloudUsage';
import { Logo } from '../components/Logo';

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
const SECTIONS = [
  { id: '', label: 'Overview' },
  { id: 'usage', label: 'Token usage' },
  { id: 'cloud', label: 'Anthropic account' },
  { id: 'agents', label: 'Agents' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'audit', label: 'Safety & audit' },
];

/** Which admin section the address points at: #/admin/integrations (or an old #integrations link). */
const readSection = () => {
  const name = window.location.hash.replace(/^#\/?(admin\/?)?/, '');
  return SECTIONS.some((s) => s.id === name) ? name : '';
};

export function Admin() {
  const { settings, update } = useSettings();
  const [section, setSection] = useState(readSection);

  // Section links scroll within the portal instead of leaving it.
  useEffect(() => {
    const go = () => {
      const next = readSection();
      setSection(next);
      requestAnimationFrame(() => {
        if (next) document.getElementById(next)?.scrollIntoView({ block: 'start' });
        else window.scrollTo(0, 0);
      });
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback((background = false) => {
    api.admin(background).then(setData).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => document.hidden || load(true), 10_000);
    return () => clearInterval(timer);
  }, [load]);

  async function flip(agent: AgentSetting) {
    try {
      await api.setAgent(agent.id, !agent.enabled);
    } catch {
      // The list reloaded below shows what the server really has.
    }
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
        { label: 'Claude usage', value: data.usage.requests, note: `${(data.usage.inputTokens / 1000).toFixed(1)}k in · ${(data.usage.outputTokens / 1000).toFixed(1)}k out tokens (all time)` },
      ]
    : [];

  return (
    <div className="admin" dir="ltr" lang="en">
      <nav className="admin-nav" aria-label="Admin sections">
        <div className="row" style={{ padding: '0 8px 20px' }}>
          <div className="admin-logo"><Logo size={22} /></div>
          <div><div style={{ fontWeight: 700, fontSize: 15 }}>MAAI Admin</div><div className="sub">Local</div></div>
        </div>
        {SECTIONS.map((s) => (
          <a key={s.id} href={s.id ? `#/admin/${s.id}` : '#/admin'} aria-current={section === s.id ? 'page' : undefined}>
            {s.label}
          </a>
        ))}
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

        {data && <TokenUsage rows={data.usageLog} timeZone={data.status.location.timezone} allTime={data.usage} />}
        {data && <CloudUsage maaiThirtyDayTokens={data.usageLog.reduce((a, r) => a + r.input + r.cached + r.output, 0)} />}

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
              { name: 'Gmail (sending)', ok: data?.status.mail?.configured, okText: data?.status.mail?.from ?? 'Connected', offText: 'Not connected' },
              { name: 'Prayer times (Umm al-Qura)', ok: true, okText: data ? data.status.location.timezone : '…', offText: '' },
              { name: 'WhatsApp hand-off', ok: true, okText: 'Ready (wa.me link)', offText: '' },
              { name: 'WhatsApp Business (Twilio)', ok: data?.status.whatsapp?.configured, okText: data?.status.whatsapp?.number ?? 'Connected', offText: 'Not connected' },
              { name: 'Voice input', ok: true, okText: 'In Chrome / Edge', offText: '' },
              {
                name: 'Asana',
                ok: data?.status.asana?.configured && !data.status.asana.error,
                okText: `${data?.status.asana?.open ?? 0} open tasks`,
                offText: data?.status.asana?.error ? 'Sync failed' : 'Not connected',
              },
              {
                name: 'News (trusted sources)',
                ok: Boolean(data?.status.news?.sourcesOk),
                okText: `${data?.status.news?.sourcesOk ?? 0} of ${data?.status.news?.sources ?? 0} sources`,
                offText: data?.status.news?.updatedAt ? 'No source could be read' : 'Not read yet',
              },
              {
                name: 'Google Calendar (read-only)',
                ok: data?.status.calendar?.configured && !data.status.calendar.error,
                okText: `${data?.status.calendar?.events ?? 0} events`,
                offText: data?.status.calendar?.error ? 'Sync failed' : 'Not connected',
              },
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
          <div style={{ overflowX: 'auto' }} tabIndex={0} role="region" aria-label="Audit log entries">
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
