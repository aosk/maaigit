import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { AsanaOverview, Briefing, CalendarEvent, TodayData } from '../../shared/types';
import { PRAYER_BUFFER_MINUTES } from '../../shared/prayer';
import { eventEnd, leaveTime } from '../../shared/schedule';
import { api } from '../api';
import { dayHeading, dayTime, hijri, sameDay, time } from '../format';
import { useSettings } from '../settings';
import { speak, stopSpeaking } from '../speech';
import { Bell, Mic, Send, Speaker, Sun } from '../components/Icons';
import { askAssistant, talkToAssistant } from '../nav';
import { Logo } from '../components/Logo';
import { useMailCount } from '../useMailCount';

type Row =
  | { kind: 'event'; at: string; end: number; event: CalendarEvent }
  | { kind: 'prayer'; at: string; end: number; name: TodayData['prayers'][number]['name'] };

const prayerEnd = (time: string) => Date.parse(time) + PRAYER_BUFFER_MINUTES * 60_000;

/** First free 2-hour gap between 13:00 and 18:00 today that avoids events and prayers. */
function focusGap(data: TodayData): Date | null {
  const busy = [
    ...data.events.map((e) => [Date.parse(e.start), eventEnd(e)]),
    ...data.prayers.map((p) => [Date.parse(p.time), prayerEnd(p.time)]),
  ];
  const now = Date.now();
  for (let hour = 13; hour <= 16; hour++) {
    const start = new Date();
    start.setHours(hour, 0, 0, 0);
    const s = start.getTime();
    const e = s + 2 * 3_600_000;
    if (s > now && !busy.some(([bs, be]) => s < be && e > bs)) return start;
  }
  return null;
}

export function Today() {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [data, setData] = useState<TodayData | null>(null);
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [showPast, setShowPast] = useState(false);
  const unread = useMailCount();
  const [asana, setAsana] = useState<AsanaOverview | null>(null);
  useEffect(() => {
    api.asana().then(setAsana).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api.today().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    setBrief(null);
    api.briefing(lang).then(setBrief).catch(() => setBrief(null));
  }, [lang]);

  useEffect(() => () => stopSpeaking(), []);

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const events: Row[] = data.events.filter((e) => !e.allDay && sameDay(e.start, now)).map((e) => ({ kind: 'event', at: e.start, end: eventEnd(e), event: e }));
    const prayers: Row[] = data.prayers.map((p) => ({ kind: 'prayer', at: p.time, end: prayerEnd(p.time), name: p.name }));
    return [...events, ...prayers].sort((a, b) => a.at.localeCompare(b.at));
  }, [data, now]);

  const allDay = useMemo(
    () => (data?.events ?? []).filter((e) => e.allDay && Date.parse(e.start) <= now.getTime() && eventEnd(e) > now.getTime()),
    [data, now],
  );
  // Rows at the top that have already finished; they fold away under "Earlier today".
  const pastCount = useMemo(() => {
    const i = rows.findIndex((row) => row.end >= now.getTime());
    return i < 0 ? rows.length : i;
  }, [rows, now]);
  const upcoming = useMemo(() => (data?.events ?? []).filter((e) => !sameDay(e.start, now) && new Date(e.start) > now).slice(0, 3), [data, now]);
  const gap = data && !dismissed ? focusGap(data) : null;
  const next = data?.nextPrayer;
  const minsToPrayer = next ? Math.max(0, Math.round((new Date(next.time).getTime() - now.getTime()) / 60_000)) : 0;
  const openReminders = (data?.reminders ?? []).filter((r) => !r.done);

  function toggleListen() {
    if (!brief) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
    } else {
      setSpeaking(true);
      speak(brief.text, lang, settings.toggles.slow, () => setSpeaking(false));
    }
  }

  async function addFocus(start: Date) {
    await api.addEvent({ title: t.focusTitle, start: start.toISOString(), minutes: 120 });
    setNote(t.added);
    setDismissed(true);
    load();
  }

  async function done(id: string) {
    await api.reminderDone(id);
    load();
  }

  return (
    <div className="screen">
      <div className="top">
        <div>
          <div className="eyebrow">{dayHeading(now, lang)}</div>
          <div className="eyebrow hijri">{hijri(now, lang)}</div>
          <h1 className="title row" style={{ gap: 10 }}>
            <span style={{ color: 'var(--tint-text)', display: 'inline-flex' }}><Logo size={30} /></span>
            {t.today}
          </h1>
        </div>
        <button className="icon-btn mic-head" aria-label={t.talkToMaai} onClick={talkToAssistant}>
          <Mic size={24} />
        </button>
      </div>

      {error && <div className="error" role="alert">{error}</div>}

      <section className="card" aria-label={t.morningBriefing}>
        <div className="card-label"><Sun size={20} />{t.morningBriefing}</div>
        {brief ? <p aria-live="polite">{brief.text}</p> : <div className="skeleton" aria-label={t.loading}><span /><span /></div>}
        <div className="row">
          <button className="btn primary grow" onClick={toggleListen} disabled={!brief}>
            <Speaker size={18} />{speaking ? t.stop : t.listen}
          </button>
          <button className="btn secondary grow" onClick={() => askAssistant(t.planMyDayPrompt)}>{t.planMyDay}</button>
        </div>
      </section>

      <div className="between">
        <h2 className="h2">{t.schedule}</h2>
        {next && (
          <div className="pill">{t.inPrayer(t.prayers[next.name], t.hoursMinutes(Math.floor(minsToPrayer / 60), minsToPrayer % 60))}</div>
        )}
      </div>

      {allDay.length > 0 && (
        <div className="row wrap" aria-label={t.allDay}>
          {allDay.map((e) => (
            <span key={e.id} className="pill">{t.allDay}: {e.title}</span>
          ))}
        </div>
      )}

      {unread !== null && unread > 0 && (
        <a className="card soft mail-teaser" href="#/inbox">
          <span className="alert-icon"><Send size={18} /></span>
          <span style={{ flex: 1 }}>
            <strong>{t.unreadEmails(unread)}</strong>
            <span className="sub" style={{ display: 'block' }}>{t.unreadEmailsHint}</span>
          </span>
          <span aria-hidden="true" className="chev">›</span>
        </a>
      )}

      <section className="card flush" aria-label={t.schedule}>
        {rows.length === 0 && <div className="slot"><span className="sub">{t.nothingToday}</span></div>}
        {pastCount > 0 && (
          <button className="slot earlier" onClick={() => setShowPast((v) => !v)} aria-expanded={showPast}>
            <span className="sub">{showPast ? t.hideEarlier : t.earlierToday(pastCount)}</span>
          </button>
        )}
        {rows.map((row, i) => {
          if (i < pastCount && !showPast) return null;
          return (
            <Fragment key={row.kind === 'prayer' ? `p-${row.name}` : row.event.id}>
              {i === pastCount && pastCount > 0 && (
                <div className="now-line" aria-label={t.now}><span>{t.now} · {time(now, lang)}</span></div>
              )}
              <ScheduleRow row={row} past={row.end < now.getTime()} />
            </Fragment>
          );
        })}
      </section>

      {note && <div className="banner" role="status" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>{note}</div>}

      {gap && (
        <section className="card soft extra">
          <p style={{ fontSize: '0.88em' }}><strong>{t.suggestion} </strong>{t.focusSuggestion(time(gap, lang))}</p>
          <div className="row">
            <button className="btn primary round" onClick={() => addFocus(gap)}>{t.addIt}</button>
            <button className="btn ghost round" onClick={() => setDismissed(true)}>{t.notNow}</button>
          </div>
        </section>
      )}

      {asana && <AsanaSection asana={asana} />}

      <h2 className="h2 extra">{t.reminders}</h2>
      <section className="card flush extra" aria-label={t.reminders}>
        {openReminders.length === 0 && <div className="check"><span className="sub">{t.noReminders}</span></div>}
        {openReminders.map((r) => (
          <div key={r.id} className="check">
            <button aria-label={`${t.markDone}: ${r.title}`} onClick={() => done(r.id)} />
            <div style={{ flex: 1 }}>
              <div>{r.title}</div>
              <div className="sub row"><Bell size={14} />{r.when}</div>
            </div>
          </div>
        ))}
      </section>

      {upcoming.length > 0 && (
        <>
          <h2 className="h2 extra">{t.upcoming}</h2>
          <section className="card flush extra">
            {upcoming.map((e) => (
              <div key={e.id} className="slot">
                <div style={{ flex: 1 }}>
                  <div className="slot-title">{e.title}</div>
                  <div className="slot-meta">{dayTime(e.start, lang)}{e.place ? ` · ${e.place}` : ''}</div>
                </div>
              </div>
            ))}
          </section>
        </>
      )}

    </div>
  );
}

/** One line of the day: a prayer (protected time) or an event, with a "leave by" hint when there is travel. */
function ScheduleRow({ row, past }: { row: Row; past: boolean }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  if (row.kind === 'prayer') {
    return (
      <div className={`slot prayer${past ? ' past' : ''}`}>
        <div className="slot-time">{time(row.at, lang)}</div>
        <div className="slot-bar" />
        <div><div className="slot-title">{t.prayers[row.name]}</div><div className="slot-meta">{t.protectedTime}</div></div>
      </div>
    );
  }
  const e = row.event;
  const leave = leaveTime(e);
  const meta = leave
    ? t.leaveAt(time(leave, lang), e.travelMinutes!)
    : [e.place, e.bookedByMaai ? t.bookedByMaai : t.minutesShort(e.minutes)].filter(Boolean).join(' · ');
  const google = e.source === 'google';
  return (
    <div className={`slot${leave ? ' warn' : ''}${past ? ' past' : ''}${google ? ' google' : ''}`}>
      <div className="slot-time">{time(e.start, lang)}</div>
      <div className="slot-bar" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="slot-title">
          {e.title}
          {google && <span className="g-tag" title={t.fromGoogle} aria-label={t.fromGoogle}>G</span>}
        </div>
        <div className="slot-meta">{meta}</div>
      </div>
    </div>
  );
}

/** The Asana tasks that matter now, or a plain reason why there are none. */
function AsanaSection({ asana }: { asana: AsanaOverview }) {
  const { t } = useSettings();
  const today = new Date().toLocaleDateString('en-CA');
  const note = !asana.configured ? t.asanaOff : asana.error ? t.asanaError(asana.error) : asana.tasks.length === 0 ? t.asanaNone : '';
  return (
    <>
      <div className="between extra">
        <h2 className="h2">{t.asanaTasks}</h2>
        {asana.overdue > 0 && <div className="pill warn">{t.asanaOverdue(asana.overdue)}</div>}
      </div>
      {note ? (
        <a className="card soft extra" href="#/settings" style={{ textDecoration: 'none', color: 'inherit' }}><span className="sub">{note}</span></a>
      ) : (
        <section className="card flush extra" aria-label={t.asanaTasks}>
          {asana.tasks.map((task) => {
            const overdue = task.dueOn && task.dueOn < today;
            return (
              <a key={task.gid} className="slot" href={task.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="slot-title">{task.name}</div>
                  <div className="slot-meta" style={overdue ? { color: 'var(--danger)' } : undefined}>
                    {[task.dueOn === today ? t.asanaDueToday : task.dueOn ?? t.asanaNoDate, task.project].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </a>
            );
          })}
        </section>
      )}
    </>
  );
}
