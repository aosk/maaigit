import type { HealthCheck, HealthLevel, HealthReport } from '../../shared/types';

/**
 * Server health, arranged for reviewing: one line saying whether anything needs you, then the checks that do
 * (failing first) with what to do, then every part grouped by area. Parts not set up are folded away with the
 * key each one needs, so they don't drown the ones that matter.
 */

const COLOR: Record<HealthLevel, string> = { ok: 'var(--success)', warn: 'var(--warn-text)', fail: 'var(--danger)', off: 'var(--text2)' };
const WORD: Record<HealthLevel, string> = { ok: 'Working', warn: 'Needs a look', fail: 'Not working', off: 'Not set up' };
const OVERALL: Record<HealthReport['status'], string> = { ok: 'All working', warn: 'Working, with something to look at', fail: 'Something is not working' };
const RANK: Record<HealthLevel, number> = { fail: 0, warn: 1, ok: 2, off: 3 };

const GROUPS = [
  { id: 'core', title: 'MAAI core', ids: ['server', 'storage', 'render', 'claude', 'push', 'news'], link: undefined },
  { id: 'messages', title: 'Messages & WhatsApp', ids: ['bot', 'replies', 'gmail', 'whatsapp'], link: '#/admin/bots' },
  { id: 'calendar', title: 'Calendar & tasks', ids: ['calendar', 'asana'], link: '#/settings' },
  { id: 'stocks', title: 'maai Stocks', ids: ['stocksmart', 'stocksmart-prices', 'stocksmart-agents', 'snb-bot'], link: '#/stocks' },
] as const;

const groupOf = (c: HealthCheck) => GROUPS.find((g) => (g.ids as readonly string[]).includes(c.id)) ?? GROUPS[0];
/** Where to fix a check: StockSmart for its parts, the bots page for the device bot, Settings for the rest. */
const fixLink = (c: HealthCheck) => (c.id === 'news' ? '#/news' : c.id === 'render' || c.id === 'server' ? '#/admin/usage' : c.id === 'bot' || c.id === 'replies' ? '#/admin/bots' : groupOf(c).link);

const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** How many checks need the user: shown on the menu and the top line. */
export const attentionCount = (r: HealthReport | null) => (r ? r.checks.filter((c) => c.status === 'fail' || c.status === 'warn').length : 0);

const Dot = ({ level, size = 10 }: { level: HealthLevel; size?: number }) => (
  <span aria-hidden="true" className="hl-dot" style={{ width: size, height: size, background: COLOR[level] }} />
);

export function Health({ report, error, reload, banner = true }: { report: HealthReport | null; error: string; reload: () => void; banner?: boolean }) {
  if (error) return <div className="error" role="alert">The server did not answer: {error}</div>;
  if (!report) return <div className="admin-card"><div className="skeleton"><span /><span /></div></div>;

  const attention = report.checks.filter((c) => c.status === 'fail' || c.status === 'warn').sort((a, b) => RANK[a.status] - RANK[b.status]);
  const working = report.checks.filter((c) => c.status === 'ok').length;
  const off = report.checks.filter((c) => c.status === 'off').length;

  return (
    <>
      {banner && <section aria-label="Overall health" className={`admin-card hl-banner hl-${report.status}`}>
        <div className="between wrap" style={{ gap: 12 }}>
          <div role="status" className="row" style={{ gap: 10 }}>
            <Dot level={report.status} size={14} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{OVERALL[report.status]}</div>
              <div className="sub">
                {attention.length ? `${attention.length} need${attention.length === 1 ? 's' : ''} you · ` : ''}{working} working · {off} not set up
              </div>
            </div>
          </div>
          <button className="admin-btn" onClick={reload}>Check now</button>
        </div>
        <span className="sub">
          Checked {time(report.checkedAt)} · up since {time(report.startedAt)}{report.version ? ` · version ${report.version}` : ''} · your phone is alerted when something stops working
        </span>
      </section>}

      {attention.length > 0 && (
        <section id="attention" aria-label="Needs your attention" className="admin-card">
          <h2 className="h2" style={{ fontSize: 17 }}>Needs your attention</h2>
          {attention.map((c) => (
            <div key={c.id} className={`hl-issue hl-${c.status}`}>
              <div className="between wrap" style={{ gap: 8 }}>
                <strong>{c.name}</strong>
                <span className="hl-word" style={{ color: COLOR[c.status] }}>{WORD[c.status]}</span>
              </div>
              <div className="sub" style={{ overflowWrap: 'anywhere' }}>{c.detail}</div>
              {(c.fix || fixLink(c)) && (
                <div className="row wrap" style={{ gap: 12, fontSize: 13 }}>
                  {c.fix && <span style={{ flex: '1 1 240px' }}>→ {c.fix}</span>}
                  {fixLink(c) && <a href={fixLink(c)} className="hl-go">Open</a>}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <section aria-label="Every part, by area" className="hl-groups">
        {GROUPS.map((g) => {
          const list = report.checks.filter((c) => groupOf(c).id === g.id).sort((a, b) => RANK[a.status] - RANK[b.status]);
          if (!list.length) return null;
          const set = list.filter((c) => c.status !== 'off');
          const notSet = list.filter((c) => c.status === 'off');
          const worst = list.reduce<HealthLevel>((w, c) => (RANK[c.status] < RANK[w] ? c.status : w), 'off');
          const issues = list.filter((c) => c.status === 'fail' || c.status === 'warn').length;
          return (
            <div key={g.id} className="admin-card hl-group">
              <div className="between" style={{ gap: 8 }}>
                <h2 className="h2" style={{ fontSize: 16 }}>{g.title}</h2>
                <span className="hl-chip" style={{ color: COLOR[worst] }}>
                  <Dot level={worst} size={8} />
                  {issues ? `${issues} to look at` : set.length ? 'All working' : 'Not set up'}
                </span>
              </div>
              {set.map((c) => (
                <details key={c.id} className="hl-row">
                  <summary>
                    <Dot level={c.status} />
                    <span className="hl-name">{c.name}</span>
                    <span className="hl-word" style={{ color: COLOR[c.status] }}>{WORD[c.status]}</span>
                  </summary>
                  <div className="sub" style={{ overflowWrap: 'anywhere' }}>{c.detail}</div>
                  {c.fix && <div style={{ fontSize: 13 }}>→ {c.fix}</div>}
                </details>
              ))}
              {notSet.length > 0 && (
                <details className="hl-off">
                  <summary>Not set up ({notSet.length}): {notSet.map((c) => c.name).join(', ')}</summary>
                  {notSet.map((c) => (
                    <div key={c.id} className="hl-off-row">
                      <strong>{c.name}</strong> <span className="sub">{c.detail}</span>
                      {c.fix && <div style={{ fontSize: 13 }}>→ {c.fix}</div>}
                    </div>
                  ))}
                </details>
              )}
              {g.link && <a href={g.link} className="hl-go" style={{ alignSelf: 'flex-start' }}>{g.id === 'stocks' ? 'Open maai Stocks' : g.id === 'messages' ? 'Manage the bots' : 'Open Settings'}</a>}
            </div>
          );
        })}
      </section>
    </>
  );
}
