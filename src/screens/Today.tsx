import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { Briefing, CalendarEvent } from '../../shared/types';
import { api, type TodayData } from '../api';
import { dayHeading, dayTime, hijri, sameDay, time } from '../format';
import { useSettings } from '../settings';
import { speak, stopSpeaking } from '../speech';
import { Bell, Mic, Send, Speaker, Sun } from '../components/Icons';
import { LISTEN_KEY, go } from '../App';
import { Logo } from '../components/Logo';

type Row =
  | { kind: 'event'; at: string; event: CalendarEvent }
  | { kind: 'prayer'; at: string; name: TodayData['prayers'][number]['name'] };

/** First free 2-hour gap between 13:00 and 18:00 today that avoids events and prayers. */
function focusGap(data: TodayData): Date | null {
  const busy = [
    ...data.events.map((e) => [new Date(e.start).getTime(), new Date(e.start).getTime() + e.minutes * 60_000]),
    ...data.prayers.map((p) => [new Date(p.time).getTime(), new Date(p.time).getTime() + 20 * 60_000]),
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
  const [unread, setUnread] = useState<number | null>(null);
  useEffect(() => {
    api.mailCount().then((c) => setUnread(c.unread)).catch(() => {});
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
    const events: Row[] = data.events.filter((e) => !e.allDay && sameDay(e.start, now)).map((e) => ({ kind: 'event', at: e.start, event: e }));
    const prayers: Row[] = data.prayers.map((p) => ({ kind: 'prayer', at: p.time, name: p.name }));
    return [...events, ...prayers].sort((a, b) => a.at.localeCompare(b.at));
  }, [data, now]);

  const allDay = useMemo(() => (data?.events ?? []).filter((e) => {
    if (!e.allDay) return false;
    const start = new Date(e.start).getTime();
    return start <= now.getTime() && start + e.minutes * 60_000 > now.getTime();
  }), [data, now]);
  // Items that have finished (a prayer counts as finished 20 minutes after it starts).
  const pastCount = useMemo(() => {
    let n = 0;
    for (const row of rows) {
      const end = row.kind === 'prayer' ? new Date(row.at).getTime() + 20 * 60_000 : new Date(row.at).getTime() + row.event.minutes * 60_000;
      if (end < now.getTime()) n++;
      else break;
    }
    return n;
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
        <button className="icon-btn mic-head" aria-label={t.talkToMaai} onClick={() => { sessionStorage.setItem(LISTEN_KEY, '1'); go('assistant'); }}>
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
          <button className="btn secondary grow" onClick={() => go('assistant', t.planMyDayPrompt)}>{t.planMyDay}</button>
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
          const isPast = i < pastCount;
          if (isPast && !showPast) return null;
          const nowLine = i === pastCount && pastCount > 0 ? (
            <div key="now" className="now-line" aria-label={t.now}><span>{t.now} · {time(now, lang)}</span></div>
          ) : null;
          if (row.kind === 'prayer') {
            return (
              <Fragment key={`p-${row.name}`}>
                {nowLine}
                <div className={`slot prayer${isPast ? ' past' : ''}`}>
                  <div className="slot-time">{time(row.at, lang)}</div>
                  <div className="slot-bar" />
                  <div><div className="slot-title">{t.prayers[row.name]}</div><div className="slot-meta">{t.protectedTime}</div></div>
                </div>
              </Fragment>
            );
          }
          const e = row.event;
          const end = new Date(e.start).getTime() + e.minutes * 60_000;
          const leave = e.travelMinutes ? new Date(new Date(e.start).getTime() - (e.travelMinutes + 7) * 60_000) : null;
          const meta = leave
            ? t.leaveAt(time(leave, lang), e.travelMinutes!)
            : [e.place, e.bookedByMaai ? t.bookedByMaai : t.minutesShort(e.minutes)].filter(Boolean).join(' · ');
          return (
            <Fragment key={e.id}>
              {nowLine}
              <div className={`slot${leave ? ' warn' : ''}${end < now.getTime() ? ' past' : ''}${e.source === 'google' ? ' google' : ''}`}>
                <div className="slot-time">{time(e.start, lang)}</div>
                <div className="slot-bar" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="slot-title">
                    {e.title}
                    {e.source === 'google' && <span className="g-tag" title={t.fromGoogle} aria-label={t.fromGoogle}>G</span>}
                  </div>
                  <div className="slot-meta">{meta}</div>
                </div>
              </div>
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
