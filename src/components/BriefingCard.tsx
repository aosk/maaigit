import type { ReactNode } from 'react';
import type { Briefing, BriefingFacts } from '../../shared/types';
import type { DayPeriod } from '../../shared/schedule';
import { dayTime, time } from '../format';
import { useSettings } from '../settings';
import { openInbox } from '../nav';
import { Bell, Calendar, Chat, Inbox, Moon, Speaker, Sun, Sunrise, Check } from './Icons';

const PERIOD_ICON: Record<DayPeriod, ReactNode> = { morning: <Sunrise size={22} />, noon: <Sun size={22} />, night: <Moon size={22} /> };

/** Scrolls to a part of the Today screen. */
function jump(id: string) {
  const reduce = document.documentElement.dataset.motion === 'reduce';
  document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
}

interface Chip {
  key: string;
  kind: 'event' | 'task' | 'reminder' | 'mail' | 'chat';
  icon: ReactNode;
  label: string;
  urgent?: boolean;
  go: () => void;
}

/**
 * The daily briefing, in the order a person scans it: the one-line summary, what is next, then a row of
 * colour-coded counts. Each colour always means the same thing (events blue, tasks orange, reminders
 * purple, email red, WhatsApp green) and a tap on a count jumps to that list. The card's own accent
 * follows the time of day (morning gold, noon blue, night indigo).
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

  const chips: Chip[] = [];
  if (facts) {
    if (facts.events.total > 0) chips.push({ key: 'events', kind: 'event', icon: <Calendar size={16} />, label: t.chipEvents(facts.events.left), go: () => jump('today-schedule') });
    const due = facts.tasks.overdue + facts.tasks.dueToday;
    if (due > 0) chips.push({ key: 'tasks', kind: 'task', icon: <Check size={16} />, label: t.chipTasks(due, facts.tasks.overdue), urgent: facts.tasks.overdue > 0, go: () => jump('today-tasks') });
    if (facts.reminders.open > 0) chips.push({ key: 'reminders', kind: 'reminder', icon: <Bell size={16} />, label: t.chipReminders(facts.reminders.open), go: () => jump('today-reminders') });
    const needs = facts.email.toDecide + facts.email.toReply;
    if (needs > 0) chips.push({ key: 'email', kind: 'mail', icon: <Inbox size={16} />, label: t.chipEmailNeed(needs), urgent: facts.email.toDecide > 0, go: () => openInbox('email') });
    else if (facts.email.unread > 0) chips.push({ key: 'email', kind: 'mail', icon: <Inbox size={16} />, label: t.chipEmailUnread(facts.email.unread), go: () => openInbox('email') });
    if (facts.whatsapp.waiting > 0) chips.push({ key: 'whatsapp', kind: 'chat', icon: <Chat size={16} />, label: t.chipWhatsApp(facts.whatsapp.waiting), go: () => openInbox('whatsapp') });
  }

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
    <section className="card brief" data-period={shown} aria-label={t.briefingTitle[shown]}>
      <div className="brief-head">
        <span className="brief-icon" aria-hidden="true">{PERIOD_ICON[shown]}</span>
        <div>
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

      {facts && chips.length === 0 && <div className="brief-clear">{t.briefClear}</div>}
      {chips.length > 0 && (
        <ul className="brief-chips" aria-label={t.briefJump}>
          {chips.map((c) => (
            <li key={c.key}>
              <button type="button" className={`brief-chip ${c.kind}${c.urgent ? ' urgent' : ''}`} onClick={c.go}>
                {c.icon}
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="row">
        <button className="btn primary grow" onClick={onListen} disabled={!brief}>
          <Speaker size={18} />{speaking ? t.stop : t.listen}
        </button>
        <button className="btn secondary grow" onClick={onPlan}>{t.planMyDay}</button>
      </div>
    </section>
  );
}
