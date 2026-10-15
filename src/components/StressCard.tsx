import type { ReactNode } from 'react';
import type { Stress, StressFactor } from '../../shared/types';
import { askAssistant } from '../nav';
import { useSettings } from '../settings';
import { Bell, Calendar, Chat, Check, Clock, Inbox } from './Icons';

const ICON: Record<StressFactor, ReactNode> = {
  schedule: <Calendar size={18} />,
  tasks: <Check size={18} />,
  email: <Inbox size={18} />,
  whatsapp: <Chat size={18} />,
  reminders: <Bell size={18} />,
  time: <Clock size={18} />,
};

const levelOf = (score: number) => (score < 25 ? 'calm' : score < 50 ? 'steady' : score < 75 ? 'busy' : 'heavy');

/**
 * How loaded the day is: a score out of 100 on a gauge, one sentence on what drives it and what to do,
 * and (opened) every part with its count and its share, plus the last seven days. Worked out from the data
 * on the device's own server: no guesswork and no AI.
 */
export function StressCard({ stress }: { stress: Stress }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const num = (x: number) => x.toLocaleString(lang === 'ar' ? 'ar-SA' : 'en-GB');
  const level = t.stressLevel[stress.level];
  const drivers = stress.drivers.map((d) => t.stressFactor[d]);
  const weekday = (day: string) => new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

  return (
    <section className="card load" data-level={stress.level} aria-label={t.stressTitle}>
      <div className="load-head">
        <div>
          <div className="eyebrow">{t.stressTitle}</div>
          <span className="load-level">{level}</span>
        </div>
        <div className="load-score" aria-hidden="true">{num(stress.score)}<span style={{ fontSize: '0.4em', fontWeight: 600, color: 'var(--text2)' }}> /{num(100)}</span></div>
      </div>

      <div className="gauge" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stress.score} aria-valuetext={`${t.stressOutOf(stress.score)}, ${level}`} aria-label={t.stressTitle}>
        <i style={{ left: `${Math.min(97, Math.max(3, stress.score))}%` }} />
      </div>

      <p className="sub" style={{ fontSize: '0.9em' }}>
        {drivers.length ? `${t.stressDrivers(drivers.join(lang === 'ar' ? ' و' : ' and '))}. ` : `${t.stressNone} `}
        {t.stressAdvice[stress.level]}
      </p>
      {(stress.level === 'busy' || stress.level === 'heavy') && (
        <button className="btn secondary round" style={{ alignSelf: 'flex-start' }} onClick={() => askAssistant(t.planMyDayPrompt)}>{t.planMyDay}</button>
      )}

      <details className="load-why">
        <summary>{t.stressWhy}</summary>
        <div style={{ marginTop: 8 }}>
          {stress.factors.map((f) => (
            <div key={f.key} className={`factor ${f.key}`}>
              <span className="ic" aria-hidden="true">{ICON[f.key]}</span>
              <span>
                <div className="name">{t.stressFactor[f.key]}</div>
                <div className="what">{f.count > 0 || f.points > 0 ? t.stressCount[f.key](f.count) : '—'}</div>
              </span>
              <span className="pts">{num(f.points)}/{num(f.max)}</span>
              <span className="bar" aria-hidden="true"><span style={{ width: `${(f.points / f.max) * 100}%` }} /></span>
            </div>
          ))}
        </div>
        <div className="eyebrow" style={{ margin: '14px 0 6px' }}>{t.stressWeek}</div>
        <ul className="week">
          {stress.week.map((d, i) => (
            <li key={d.day} aria-current={i === stress.week.length - 1 ? 'date' : undefined} aria-label={`${weekday(d.day)}: ${t.stressOutOf(d.score)}`}>
              <span className={`col ${levelOf(d.score)}`} style={{ height: `${Math.max(4, d.score * 0.6)}px` }} aria-hidden="true" />
              <span aria-hidden="true">{weekday(d.day)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
