import type { ReactNode } from 'react';
import type { Briefing, BriefingFacts } from '../../shared/types';
import type { DayPeriod } from '../../shared/schedule';
import { dayTime, time } from '../format';
import { useSettings } from '../settings';
import { openInbox } from '../nav';
import { Moon, Speaker, Sun, Sunrise } from './Icons';

const PERIOD_ICON: Record<DayPeriod, ReactNode> = { morning: <Sunrise size={22} />, noon: <Sun size={22} />, night: <Moon size={22} /> };

/** Scrolls to a part of the Today screen. */
function jump(id: string) {
  const reduce = document.documentElement.dataset.motion === 'reduce';
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

interface Tile {
  key: string;
  kind: 'event' | 'task' | 'reminder' | 'mail' | 'chat';
  label: string;
  value: number;
  meta?: string;
  urgent?: boolean;
  go: () => void;
}

/**
 * The daily briefing, laid out like the numbers banner of the Platforms Code (كود المنصات) dashboards: a dark green
 * panel with the one-line summary and what is next, then a tile for each kind of thing waiting (events, tasks,
 * reminders, email, WhatsApp). Each kind keeps its colour (the dot on its tile and its share of the bar), and a tap
 * on a tile jumps to that list.
 */
export function BriefingCard({
  period,
  brief,
  facts,
  now,
  speaking,
  onListen,
  onPlan,
  onOpenEvent,
}: {
  period: DayPeriod;
  brief: Briefing | null;
  facts: BriefingFacts | null;
  now: Date;
  speaking: boolean;
  onListen: () => void;
  onPlan: () => void;
  onOpenEvent: (id: string) => void;
}) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const shown = brief?.period ?? period;
  const fmt = (x: number) => x.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB');

  const tiles: Tile[] = [];
  if (facts) {
    tiles.push({ key: 'events', kind: 'event', label: t.stressFactor.schedule, value: facts.events.left, meta: facts.events.total ? t.tileOf(facts.events.total) : undefined, go: () => jump('today-schedule') });
    const due = facts.tasks.overdue + facts.tasks.dueToday;
    tiles.push({ key: 'tasks', kind: 'task', label: t.stressFactor.tasks, value: due, meta: facts.tasks.overdue ? t.tileOverdue(facts.tasks.overdue) : undefined, urgent: facts.tasks.overdue > 0, go: () => jump('today-tasks') });
    tiles.push({ key: 'reminders', kind: 'reminder', label: t.stressFactor.reminders, value: facts.reminders.open, go: () => jump('today-reminders') });
    const needs = facts.email.toDecide + facts.email.toReply;
    tiles.push({ key: 'email', kind: 'mail', label: t.stressFactor.email, value: needs || facts.email.unread, meta: needs ? t.stressCount.email(needs) : facts.email.unread ? t.tileUnread(facts.email.unread) : undefined, urgent: facts.email.toDecide > 0, go: () => openInbox('email') });
    if (facts.whatsapp.waiting > 0) tiles.push({ key: 'whatsapp', kind: 'chat', label: t.stressFactor.whatsapp, value: facts.whatsapp.waiting, go: () => openInbox('whatsapp') });
  }
  const sum = tiles.reduce((a, b) => a + b.value, 0);

  const next = facts?.next;
  let when = '';
  if (next) {
    const minutes = Math.round((Date.parse(next.start) - now.getTime()) / 60_000);
    const soon = minutes < 180;
    when = soon ? t.startsIn(t.hoursMinutes(Math.floor(minutes / 60), minutes % 60)) : dayTime(next.start, lang);
    if (next.leaveAt) when += ` · ${t.leaveBy(time(next.leaveAt, lang))}`;
    else if (next.place) when += ` · ${next.place}`;
  }

  return (
    <section className="brief" data-period={shown} aria-label={t.briefingTitle[shown]}>
      <svg className="brief-rings" aria-hidden="true" viewBox="0 0 1300 220" preserveAspectRatio="xMidYMid slice" fill="none">
        {Array.from({ length: 10 }, (_, i) => <circle key={i} cx="700" cy="620" r={420 + i * 26} stroke="currentColor" />)}
      </svg>
      <div className="brief-head">
        <span className="brief-icon" aria-hidden="true">{PERIOD_ICON[shown]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="brief-title">{t.briefingTitle[shown]}</h2>
          <div className="brief-sub">{t.briefingSub[shown]}</div>
        </div>
      </div>

      {brief ? <p className="brief-text" aria-live="polite" dir="auto">{brief.text}</p> : <div className="skeleton" aria-label={t.loading}><span /><span /></div>}

      {next && (
        <button type="button" className="brief-next" onClick={() => onOpenEvent(next.id)} aria-haspopup="dialog">
          <span className="bar" aria-hidden="true" />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="label" style={{ display: 'block' }}>{t.briefNext}</span>
            <span className="what" style={{ display: 'block' }} dir="auto">{next.title}</span>
            <span className="when" style={{ display: 'block' }}>{when}</span>
          </span>
        </button>
      )}

      {facts && sum === 0 && <div className="brief-clear">{t.briefClear}</div>}
      {tiles.length > 0 && (
        <>
          <h3 className="sr-only">{t.briefNumbers}</h3>
          {sum > 0 && (
            <div className="brief-bar" aria-hidden="true">
              {tiles.filter((c) => c.value > 0).map((c) => <span key={c.key} className={c.kind} style={{ flexGrow: c.value }} />)}
            </div>
          )}
          <ul className="brief-tiles" aria-label={t.briefJump}>
            {tiles.map((c) => (
              <li key={c.key}>
                <button type="button" className={`brief-tile ${c.kind}${c.urgent ? ' urgent' : ''}`} onClick={c.go}>
                  <span className="tile-label"><i aria-hidden="true" />{c.label}</span>
                  <span className="tile-value">{fmt(c.value)}</span>
                  {c.meta && <span className="tile-meta">{c.meta}</span>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="row brief-actions">
        <button className="btn on-dark grow" onClick={onListen} disabled={!brief}>
          <Speaker size={18} />{speaking ? t.stop : t.listen}
        </button>
        <button className="btn on-dark-outline grow" onClick={onPlan}>{t.planMyDay}</button>
      </div>
    </section>
  );
}
