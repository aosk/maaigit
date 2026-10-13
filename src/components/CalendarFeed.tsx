import { useEffect, useState } from 'react';
import { api } from '../api';
import { useSettings } from '../settings';

/** MAAI's own calendar as a private link, so meetings it books also show on the phone and in Google Calendar. */
export function CalendarFeed() {
  const { t } = useSettings();
  const [feed, setFeed] = useState<{ https: string; webcal: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.calendarFeed().then(setFeed).catch(() => {});
  }, []);

  async function copy() {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.https);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(t.calendarFeed, feed.https);
    }
  }

  if (!feed) return null;
  return (
    <>
      <div className="section-label">{t.calendarFeed}</div>
      <section className="card" aria-label={t.calendarFeed}>
        <p style={{ fontSize: '0.9em' }}>{t.calendarFeedHint}</p>
        <div className="row wrap">
          <a className="btn primary grow" href={feed.webcal} style={{ textDecoration: 'none' }}>{t.subscribeIphone}</a>
          <button className="btn secondary grow" onClick={copy}>{copied ? t.copied : t.copyLink}</button>
        </div>
        <p className="sub">{t.calendarFeedGoogle}</p>
      </section>
    </>
  );
}
