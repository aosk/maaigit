import { useState } from 'react';
import type { AdminOverview, AuditEntry, CloudUsage, HealthReport, RenderUsage, UsageLevel, UsageRow } from '../../shared/types';
import { OWNER_FIRST_NAME } from '../../shared/owner';
import { LevelLegend, Vital, levelOf, mb, usd, worstLevel } from './levels';

/**
 * The first thing the admin sees: a morning brief for the server. One sentence on how things are, a ring for how many
 * parts work, what happened since the last visit, and the vital signs with their level (low, medium, high), each a
 * tap away from its detail.
 */

const SEEN_KEY = 'maai.admin.seen';
const DAY = 86_400_000;

/** When the admin last looked, read once per visit (then moved to now as they leave). */
function lastSeen(now = Date.now()): number {
  try {
    const at = Number(localStorage.getItem(SEEN_KEY));
    return at > 0 ? Math.max(at, now - DAY) : now - 12 * 3_600_000;
  } catch {
    return now - 12 * 3_600_000;
  }
}
export function markSeen(now = Date.now()) {
  try {
    localStorage.setItem(SEEN_KEY, String(now));
  } catch {
    // private mode
  }
}

const hourIn = (timeZone: string, d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(d));
const greeting = (h: number) => (h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
const ago = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** The ring: the share of parts that are set up and working. */
function Ring({ pct, level }: { pct: number; level: 'ok' | 'warn' | 'fail' }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color = level === 'ok' ? 'var(--success)' : level === 'warn' ? 'var(--warn-bar, var(--warn-text))' : 'var(--danger)';
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`${pct}% of parts working`} className="mo-ring">
      <circle className="mo-ring-track" cx="42" cy="42" r={r} fill="none" stroke="var(--sep)" strokeWidth="8" />
      <circle className="mo-ring-fill" cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 42 42)" />
      <text x="42" y="47" textAnchor="middle" fontSize="18" fontWeight="700" fill="currentColor">{pct}%</text>
    </svg>
  );
}

/** Claude's tokens per day (oldest first) for the last 14 days, and today's level against the days before. */
function claudeLoad(rows: UsageRow[], timeZone: string, now = new Date()) {
  const key = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const days = Array.from({ length: 14 }, (_, i) => key(new Date(now.getTime() - (13 - i) * DAY)));
  const per = days.map((d) => rows.filter((r) => r.day === d).reduce((a, r) => a + r.input + r.cached + r.output, 0));
  const today = per[13];
  const before = per.slice(0, 13).filter((v) => v > 0);
  const avg = before.length ? before.reduce((a, v) => a + v, 0) / before.length : 0;
  const level: UsageLevel = avg ? levelOf(today / avg, 1.3, 2) : 'low';
  const requests = rows.filter((r) => r.day === days[13]).reduce((a, r) => a + r.requests, 0);
  return { today, avg, level, series: per, requests };
}

const OUTCOME_WORD: Record<AuditEntry['outcome'], string> = { approved: 'approved', done: 'done', cancelled: 'cancelled', blocked: 'blocked', error: 'failed' };

export function Overview({ data, health, render, cloud, reload }: { data: AdminOverview | null; health: HealthReport | null; render: RenderUsage | null; cloud: CloudUsage | null; reload: () => void }) {
  // Read once per visit: the moment the page opened, and the last visit before it.
  const [{ now, since }] = useState(() => {
    const at = Date.now();
    return { now: at, since: lastSeen(at) };
  });
  const tz = data?.status.location.timezone ?? 'Asia/Riyadh';
  const checks = health?.checks ?? [];
  const setUp = checks.filter((c) => c.status !== 'off');
  const working = setUp.filter((c) => c.status === 'ok').length;
  const needs = checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  const pct = setUp.length ? Math.round((working / setUp.length) * 100) : 100;
  const status = health?.status ?? 'ok';
  const headline = !health
    ? 'Looking at everything…'
    : status === 'ok'
      ? `All ${working} parts are working.`
      : needs.length === 1
        ? `One thing needs you: ${needs[0].name}.`
        : `${needs.length} things need you, ${needs.filter((c) => c.status === 'fail').length ? 'and something has stopped' : 'nothing has stopped'}.`;

  const away = (data?.audit ?? []).filter((a) => Date.parse(a.at) > since);
  const problems = away.filter((a) => a.outcome === 'error' || a.outcome === 'blocked').length;
  const approved = away.filter((a) => a.outcome === 'approved').length;

  const claude = data ? claudeLoad(data.usageLog, tz) : null;
  const self = render?.self;
  const memory = self?.memory ?? render?.local.memory;
  const cpu = self?.cpu ?? render?.local.cpu;
  const disk = render?.local.disk;
  const trading = data?.status.trading;
  const overall = worstLevel([memory?.level, cpu?.level, disk?.level, self?.requests?.level, render?.monthly?.level, claude?.level]);

  return (
    <>
      <section aria-label="Morning brief" className={`mo-hero mo-${status}`}>
        <div className="mo-hero-text">
          <span className="mo-greet">{greeting(hourIn(tz))}, {OWNER_FIRST_NAME.en}</span>
          <h2 className="mo-headline" role="status">{headline}</h2>
          <span className="mo-meta">
            {working} working · {needs.length} to look at · {checks.length - setUp.length} not set up
            {health ? ` · checked ${new Date(health.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz })}` : ''}
          </span>
          <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
            <button className="mo-btn" onClick={reload}>Check now</button>
            {needs.length > 0 && <a className="mo-btn mo-btn-strong" href="#attention">See what needs you</a>}
          </div>
        </div>
        <Ring pct={pct} level={status} />
      </section>

      <section aria-label="While you were away" className="admin-card mo-away">
        <div className="between wrap" style={{ gap: 8 }}>
          <h2 className="h2" style={{ fontSize: 16 }}>Since you last looked <span className="sub">({ago(now - since)} ago)</span></h2>
          <span className="sub">{away.length ? `${away.length} logged · ${approved} approved · ${problems} problem${problems === 1 ? '' : 's'}` : ''}</span>
        </div>
        {away.length === 0 ? (
          <p className="sub" style={{ margin: 0 }}>A quiet stretch: nothing was proposed, sent or blocked.</p>
        ) : (
          <ol className="mo-timeline">
            {away.slice(0, 5).map((a) => (
              <li key={a.id} className={`mo-t-${a.outcome}`}>
                <span className="mo-t-time">{new Date(a.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz })}</span>
                <span className="mo-t-text">{a.event}</span>
                <span className="mo-t-out">{OUTCOME_WORD[a.outcome]}</span>
              </li>
            ))}
            {away.length > 5 && <li className="mo-more"><a href="#/admin/audit">All {away.length} in the log →</a></li>}
          </ol>
        )}
      </section>

      <section aria-label="Vital signs" className="admin-card">
        <div className="between wrap" style={{ gap: 8 }}>
          <h2 className="h2" style={{ fontSize: 16 }}>Vital signs {render && <span className="sub">· overall use {overall}</span>}</h2>
          <LevelLegend />
        </div>
        <div className="lv-grid">
          {memory?.level && <Vital label="Server memory" value={`${Math.round(memory.pct ?? 0)}%`} sub={`${mb(memory.used)} of ${mb(memory.limit ?? 0)}`} level={memory.level} series={memory.series} href="#/admin/usage" />}
          {cpu?.level && <Vital label="Server CPU" value={`${Math.round(cpu.pct ?? 0)}%`} sub={`busiest ${self?.cpu ? 'in 24 h' : 'in the last hour'} of ${cpu.limit} CPU`} level={cpu.level} series={cpu.series} href="#/admin/usage" />}
          {disk?.level && <Vital label="Disk" value={`${Math.round(disk.pct ?? 0)}%`} sub={`${mb(disk.used)} of ${mb(disk.limit ?? 0)}`} level={disk.level} href="#/admin/usage" />}
          {self?.requests && <Vital label="Server errors, 24 h" value={`${self.requests.errorRate}%`} sub={`${self.requests.errors24h} of ${compact(self.requests.total24h)} requests`} level={self.requests.level} series={self.requests.series} href="#/admin/usage" />}
          {render?.monthly ? (
            <Vital label="Render, this month" value={usd(render.monthly.usd)} sub={`${render.monthly.running} paid service${render.monthly.running === 1 ? '' : 's'} · estimate`} level={render.monthly.level} href="#/admin/usage" />
          ) : (
            render && <Vital label="Render cost" value="—" sub={render.reports === 'needs-key' ? 'Add RENDER_API_KEY to see it' : render.message} href="#/admin/usage" />
          )}
          {claude && <Vital label="Claude today" value={compact(claude.today)} sub={`${claude.requests} request${claude.requests === 1 ? '' : 's'}${claude.avg ? ` · usual ${compact(claude.avg)} a day` : ''}`} level={claude.level} series={claude.series} href="#/admin/usage" />}
          {cloud?.cost && <Vital label="Claude, 30 days" value={usd(cloud.cost.last30)} sub={`${usd(cloud.cost.today)} today · from Anthropic`} level={levelOf(cloud.cost.last30, 30, 100)} href="#/admin/usage" />}
          {trading && (
            <Vital
              label="maai Stocks"
              value={trading.halted ? 'Stopped' : trading.mode === 'live' ? 'Live' : 'Paper'}
              sub={`market ${trading.marketOpen ? 'open' : 'closed'} · ${trading.decider === 'rules' ? 'plain rule' : 'Claude decides'}`}
              href="#/stocks"
            />
          )}
        </div>
      </section>
    </>
  );
}
