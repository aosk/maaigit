import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Briefing, BriefingFacts, CalendarEvent, TodayData } from '../../shared/types';
import { PRAYER_BUFFER_MINUTES } from '../../shared/prayer';
import { dayPeriod, eventEnd, leaveTime } from '../../shared/schedule';
import { api } from '../api';
import { dayHeading, dayTime, hijri, sameDay, time } from '../format';
import { useSettings } from '../settings';
import { speak, stopSpeaking } from '../speech';
import { Bell, Mic } from '../components/Icons';
import { BriefingCard } from '../components/BriefingCard';
import { StressCard } from '../components/StressCard';
import { CountBadge } from '../components/CountBadge';
import { askAssistant, talkToAssistant } from '../nav';
import { Logo } from '../components/Logo';
import { AsanaTasks } from '../components/AsanaTasks';
import { EventSheet } from '../components/EventSheet';
import { useOnRefresh } from '../refresh';

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
  const [facts, setFacts] = useState<BriefingFacts | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [showPast, setShowPast] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const closeSheet = useCallback(() => setSelected(null), []);

  const load = useCallback((background = false) => {
    api.today(background === true).then(setData).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const clock = setInterval(() => setNow(new Date()), 30_000);
    // Changes made elsewhere (an event added or deleted on the phone) show up within a minute.
    const poll = setInterval(() => !document.hidden && load(true), 60_000);
    return () => {
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [load]);

  // The counts and the next event on the briefing card: free to ask, so they follow the day closely.
  const loadFacts = useCallback((background = false) => {
    api.briefingFacts(lang, background === true).then(setFacts).catch(() => {});
  }, [lang]);
  useEffect(() => {
    loadFacts();
    const poll = setInterval(() => !document.hidden && loadFacts(true), 60_000);
    return () => clearInterval(poll);
  }, [loadFacts]);

  // Morning, noon or night: a new briefing is written when the time of day changes.
  const period = dayPeriod(now);
  const loadBrief = useCallback(() => {
    api.briefing(lang).then(setBrief).catch(() => setBrief(null));
  }, [lang]);
  useEffect(() => {
    setBrief(null);
    loadBrief();
  }, [loadBrief, period]);
  useOnRefresh(() => {
    load();
    loadBrief();
    loadFacts();
  });

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

  const focusing = useRef(false);
  async function addFocus(start: Date) {
    if (focusing.current) return; // a double tap must not book two blocks
    focusing.current = true;
    try {
      const event = await api.addEvent({ title: t.focusTitle, start: start.toISOString(), minutes: 120 });
      setNote(event.googleError ? t.googleFailed(event.googleError) : event.googleId ? `${t.added} ${t.googleAdded}.` : t.added);
      setDismissed(true);
      load();
    } catch (e) {
      setError((e as Error).message || t.errorGeneric);
    } finally {
      focusing.current = false;
    }
  }

  async function done(id: string) {
    try {
      await api.reminderDone(id);
      load();
    } catch (e) {
      setError((e as Error).message || t.errorGeneric);
    }
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

      <BriefingCard
        period={period}
        brief={brief}
        facts={facts}
        now={now}
        speaking={speaking}
        onListen={toggleListen}
        onPlan={() => askAssistant(t.planMyDayPrompt)}
        onOpenEvent={(id) => {
          const event = data?.events.find((e) => e.id === id);
          if (event) setSelected(event);
        }}
      />

      {facts && <StressCard stress={facts.stress} />}

      <div className="between" id="today-schedule">
        <h2 className="h2 sec sec-event">{t.schedule}{facts && facts.events.total > 0 && <CountBadge kind="event" n={facts.events.left} of={facts.events.total} />}</h2>
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
              <ScheduleRow row={row} past={row.end < now.getTime()} onSelect={setSelected} />
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

      <div id="today-tasks"><AsanaTasks /></div>

      <h2 className="h2 sec sec-reminder" id="today-reminders">{t.reminders}<CountBadge kind="reminder" n={openReminders.length} /></h2>
      <section className="card flush" aria-label={t.reminders}>
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
          <h2 className="h2 extra sec sec-event">{t.upcoming}<CountBadge kind="event" n={upcoming.length} /></h2>
          <section className="card flush extra">
            {upcoming.map((e) => (
              <button key={e.id} type="button" className="slot slot-btn" onClick={() => setSelected(e)} aria-haspopup="dialog">
                <div style={{ flex: 1 }}>
                  <div className="slot-title">{e.title}</div>
                  <div className="slot-meta">{dayTime(e.start, lang)}{e.place ? ` · ${e.place}` : ''}</div>
                </div>
              </button>
            ))}
          </section>
        </>
      )}

      {settings.toggles.simple && (
        <a className="sub" href="#/settings" style={{ textAlign: 'center' }}>{t.simpleHides}</a>
      )}

      {data?.syncedAt && <div className="updated-at">{t.updatedAt(time(data.syncedAt, lang))}</div>}
      {selected && <EventSheet event={selected} onClose={closeSheet} />}
    </div>
  );
}

/** One line of the day: a prayer (protected time) or an event, with a "leave by" hint when there is travel. */
function ScheduleRow({ row, past, onSelect }: { row: Row; past: boolean; onSelect: (e: CalendarEvent) => void }) {
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
    <button type="button" className={`slot slot-btn${leave ? ' warn' : ''}${past ? ' past' : ''}${google ? ' google' : ''}`} onClick={() => onSelect(e)} aria-haspopup="dialog">
      <div className="slot-time">{time(e.start, lang)}</div>
      <div className="slot-bar" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="slot-title">
          {e.title}
          {google && <span className="g-tag" title={t.fromGoogle} aria-label={t.fromGoogle}>G</span>}
        </div>
        <div className="slot-meta">{meta}</div>
      </div>
    </button>
  );
}
