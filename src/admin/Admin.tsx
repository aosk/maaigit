import { useCallback, useEffect, useState } from 'react';
import type { AdminOverview, AgentSetting, HealthReport } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { Moon } from '../components/Icons';
import { TokenUsage } from './TokenUsage';
import { CloudUsage } from './CloudUsage';
import { DeviceBot } from './DeviceBot';
import { attentionCount, Health } from './Health';
import { SnbBot } from './SnbBot';
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

/**
 * The admin portal, five sections picked in the side menu (#/admin/<section>). Overview is health first: what needs
 * you, then every part by area. The menu shows how many things need you, so a glance tells whether to open it.
 */
const SECTIONS = [
  { id: '', label: 'Overview' },
  { id: 'bots', label: 'Bots' },
  { id: 'agents', label: 'Agents' },
  { id: 'usage', label: 'Usage & cost' },
  { id: 'audit', label: 'Safety & audit' },
];
/** Old addresses, from before the sections were merged. */
const MOVED: Record<string, string> = { health: '', integrations: '', device: 'bots', cloud: 'usage' };

/** Which admin section the address points at: #/admin/bots (or an old #/admin/device link). */
const readSection = () => {
  const name = window.location.hash.replace(/^#\/?(admin\/?)?/, '');
  if (name in MOVED) return MOVED[name];
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
        window.scrollTo(0, 0);
        // On a phone the menu is a row to swipe: bring the open section's button into view.
        document.querySelector('.admin-nav a[aria-current="page"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
      });
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, []);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState('');
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthError, setHealthError] = useState('');

  const loadHealth = useCallback((background = false) => {
    api.health(background).then((r) => { setHealth(r); setHealthError(''); }).catch((e: Error) => setHealthError(e.message));
  }, []);
  useEffect(() => {
    loadHealth();
    const timer = setInterval(() => document.hidden || loadHealth(true), 30_000);
    return () => clearInterval(timer);
  }, [loadHealth]);

  const load = useCallback((background = false) => {
    api.admin(background).then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message));
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
  const allAudit = data?.audit ?? [];
  const outcomes = [...new Set(allAudit.map((a) => a.outcome))];
  const audit = allAudit.filter((a) => (!outcome || a.outcome === outcome) && (!query || `${a.event} ${a.who}`.toLowerCase().includes(query.toLowerCase())));
  const needs = attentionCount(health);
  const botIssues = health ? health.checks.filter((c) => (c.id === 'bot' || c.id === 'snb-bot') && (c.status === 'fail' || c.status === 'warn')).length : 0;
  const badge: Record<string, number> = { '': needs, bots: botIssues };
  const metrics = data
    ? [
        { label: 'Requests', value: data.counts.chats, note: `${data.counts.drafts} reply drafts` },
        { label: 'Proposals', value: data.counts.proposals, note: `${data.counts.approved} approved · ${data.counts.cancelled} cancelled` },
        { label: 'Approval rate', value: data.approvalRate === null ? '—' : `${Math.round(data.approvalRate * 100)}%`, note: 'cards you approved' },
        { label: 'Calendar', value: data.counts.events, note: `${data.counts.reminders} reminders` },
        { label: 'Claude calls', value: data.usage.requests, note: `${(data.usage.inputTokens / 1000).toFixed(1)}k in · ${(data.usage.outputTokens / 1000).toFixed(1)}k out (all time)` },
      ]
    : [];

  return (
    <div className="admin" dir="ltr" lang="en">
      <nav className="admin-nav" aria-label="Admin sections">
        <div className="row" style={{ padding: '0 8px 20px' }}>
          <div className="admin-logo"><Logo size={22} /></div>
          <div><div style={{ fontWeight: 700, fontSize: 15 }}>maai admin</div><div className="sub">{window.location.host}</div></div>
        </div>
        {SECTIONS.map((s) => (
          <a key={s.id} href={s.id ? `#/admin/${s.id}` : '#/admin'} aria-current={section === s.id ? 'page' : undefined}>
            <span style={{ flex: 1 }}>{s.label}</span>
            {badge[s.id] > 0 && <span className="admin-count" aria-label={`${badge[s.id]} need you`}>{badge[s.id]}</span>}
          </a>
        ))}
        <a href="#/today" style={{ marginTop: 'auto' }}>← Back to the app</a>
      </nav>

      <main className="admin-main">
        <header className="between wrap">
          <div>
            <h1 style={{ fontSize: 28 }}>{SECTIONS.find((x) => x.id === section)?.label ?? 'Overview'}</h1>
            {section === '' && <span className="sub">What needs you first, then every part by area · refreshes by itself</span>}
          </div>
          <div className="row wrap">
            <button className="admin-btn" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => update({ look: dark ? 'light' : 'dark' })}>
              <Moon size={18} />
            </button>
          </div>
        </header>

        {error && <div className="error" role="alert">{error}</div>}

        {section === '' && <Health report={health} error={healthError} reload={() => loadHealth()} />}

        {section === '' && metrics.length > 0 && (
          <section aria-label="Activity" className="admin-card">
            <h2 className="h2" style={{ fontSize: 16 }}>Activity</h2>
            <div className="metrics">
              {metrics.map((m) => (
                <div key={m.label} className="metric">
                  <span className="sub" style={{ fontWeight: 600 }}>{m.label}</span>
                  <span style={{ fontSize: 22, fontWeight: 700 }}>{m.value}</span>
                  <span className="sub">{m.note}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {section === 'usage' && data && <TokenUsage rows={data.usageLog} timeZone={data.status.location.timezone} allTime={data.usage} />}
        {section === 'usage' && data && <CloudUsage maaiThirtyDayTokens={data.usageLog.reduce((a, r) => a + r.input + r.cached + r.output, 0)} />}

        {section === 'bots' && <DeviceBot />}
        {section === 'bots' && data?.status.trading && <SnbBot s={data.status.trading} />}

        {section === 'agents' && <section id="agents" aria-label="Agents" className="admin-card">
            <div className="between wrap">
              <h2 className="h2" style={{ fontSize: 18 }}>MAAI agents</h2>
              <span className="sub">Model: {data?.status.aiConfigured ? data.status.model : 'Demo (no Claude key)'}</span>
            </div>
            <div>
              {data?.agents.map((a) => (
                <div key={a.id} className="between" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--sep)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{a.name}</div>
                    <div className="sub">Asks you before: {a.needsApprovalFor}</div>
                  </div>
                  <div className="row" style={{ gap: 10, flex: 'none' }}>
                    <Badge outcome={a.enabled ? 'approved' : 'cancelled'} label={a.enabled ? 'Running' : 'Paused'} />
                    <button role="switch" className="switch" aria-checked={a.enabled} aria-label={`Enable ${a.name} agent`} onClick={() => flip(a)}>
                      <span />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>}
        {section === 'agents' && data?.status.trading && (
          <section aria-label="Istithmari agents" className="admin-card">
            <div className="between wrap"><h2 className="h2" style={{ fontSize: 18 }}>Istithmari agents</h2><a href="#/stocks" className="hl-go">Open Istithmari</a></div>
            <span className="sub">Technical (indicators, in code), news (Claude with web search, hourly) and decision (Claude; a plain momentum rule without a key). They run every 15 minutes while Tadawul is open, and every order passes the risk gate.</span>
            <div className="row wrap" style={{ gap: 8 }}>
              <Badge outcome={data.status.trading.agentsCanDecide ? 'approved' : 'cancelled'} label={data.status.trading.agentsCanDecide ? 'Deciding with Claude' : 'Plain rule (no Claude key)'} />
              <Badge outcome={data.status.trading.mode === 'live' ? 'blocked' : 'done'} label={data.status.trading.mode === 'live' ? 'LIVE · real money' : 'Paper'} />
              {data.status.trading.halted && <Badge outcome="error" label="Stopped" />}
              <span className="sub">Last round {data.status.trading.lastRoundAt ? when(data.status.trading.lastRoundAt) : 'not yet'}</span>
            </div>
            {data.status.trading.agentErrors.map((e) => <div key={e} className="sub" style={{ color: 'var(--danger)' }}>{e}</div>)}
          </section>
        )}

        {section === 'audit' && <section id="audit" aria-label="Audit log" className="admin-card">
          <div className="between wrap">
            <h2 className="h2" style={{ fontSize: 18 }}>Safety &amp; audit</h2>
            <span className="sub">Every proposal, approval and admin change is logged</span>
          </div>
          <label htmlFor="search" className="sr-only">Search the audit log</label>
          <input id="search" className="admin-input" placeholder="Search the audit log" value={query} onChange={(e) => setQuery(e.target.value)} />
          {outcomes.length > 1 && (
            <div className="row wrap" role="group" aria-label="Filter by outcome" style={{ gap: 6 }}>
              {['', ...outcomes].map((o) => (
                <button key={o || 'all'} type="button" className="admin-chip" aria-pressed={outcome === o} onClick={() => setOutcome(o)}>
                  {o ? o[0].toUpperCase() + o.slice(1) : 'All'} <b>{o ? allAudit.filter((a) => a.outcome === o).length : allAudit.length}</b>
                </button>
              ))}
            </div>
          )}
          <div role="list" aria-label="Audit log entries">
            {audit.length === 0 && <p className="sub">{allAudit.length ? 'Nothing matches.' : 'Nothing yet. Use the app and actions appear here.'}</p>}
            {audit.map((a) => (
              <div key={a.id} role="listitem" className="between" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--sep)', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ overflowWrap: 'anywhere' }}>{a.event}</div>
                  <div className="sub">{when(a.at)} · {a.who}</div>
                </div>
                <Badge outcome={a.outcome} />
              </div>
            ))}
          </div>
        </section>}
      </main>
    </div>
  );
}
