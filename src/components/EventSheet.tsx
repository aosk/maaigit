import { Fragment, useEffect, useRef } from 'react';
import type { CalendarEvent } from '../../shared/types';
import { eventEnd, leaveTime } from '../../shared/schedule';
import { dayHeading, time } from '../format';
import { realHost, safeWebAddress, splitLinks, stripBidi } from '../links';
import { useSettings } from '../settings';

/** Text with its web addresses made tappable (and nothing else interpreted). */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((piece, i) =>
        piece.link ? (
          // The text is the sender's and can name another site than the one opened: the real host always follows it.
          <Fragment key={i}>
            <a href={piece.link} target="_blank" rel="noopener noreferrer" dir="ltr" className="wrap-anywhere">{stripBidi(piece.text)}</a>
            {piece.host && <bdi dir="ltr" className="link-host wrap-anywhere"> ({piece.host})</bdi>}
          </Fragment>
        ) : (
          <Fragment key={i}>{stripBidi(piece.text)}</Fragment>
        ),
      )}
    </>
  );
}

const host = (url: string) => realHost(url).replace(/^www\./, '');

/** Everything about one calendar event: when, where, the link to join, and its notes. */
export function EventSheet({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      opener?.focus?.();
    };
  }, [onClose]);

  const leave = leaveTime(event);
  const when = event.allDay ? dayHeading(event.start, lang) : `${dayHeading(event.start, lang)} · ${time(event.start, lang)} – ${time(new Date(eventEnd(event)), lang)}`;
  const origin = event.source === 'google' ? event.calendar ?? t.fromGoogle : event.bookedByMaai ? t.bookedByMaai : t.appName;
  const placeIsLink = event.place && /^https?:\/\//.test(event.place);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <h2 id="sheet-title" className="h2 wrap-anywhere" dir="auto" style={{ margin: 0 }}><bdi>{stripBidi(event.title)}</bdi></h2>
          <button ref={closeButton} className="icon-btn" aria-label={t.close} onClick={onClose}>✕</button>
        </div>

        <div>
          <div style={{ fontWeight: 600 }}>{when}</div>
          {!event.allDay && <div className="sub">{t.minutesShort(event.minutes)}</div>}
          {leave && <div className="sub" style={{ color: 'var(--warn-text)' }}>{t.leaveAt(time(leave, lang), event.travelMinutes!)}</div>}
        </div>

        {event.meetingUrl && safeWebAddress(event.meetingUrl) && (
          <a className="btn primary big" href={safeWebAddress(event.meetingUrl)} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
            {t.joinMeeting}
            <bdi dir="ltr" style={{ fontWeight: 400, opacity: 0.85 }}> · {host(event.meetingUrl)}</bdi>
          </a>
        )}

        {event.place && event.place !== event.meetingUrl && (
          <div>
            <div className="sub">{t.eventWhere}</div>
            <div dir="auto" className="wrap-anywhere">{placeIsLink ? <Linkified text={event.place} /> : <bdi>{stripBidi(event.place)}</bdi>}</div>
          </div>
        )}

        {event.description ? (
          <div>
            <div className="sub">{t.eventNotes}</div>
            <div className="sheet-notes" dir="auto"><Linkified text={event.description} /></div>
          </div>
        ) : (
          !event.meetingUrl && !event.place && <p className="sub">{t.eventNoDetails}</p>
        )}

        <div className="sub">{t.eventCalendar}: <bdi>{stripBidi(origin)}</bdi></div>
      </section>
    </div>
  );
}
