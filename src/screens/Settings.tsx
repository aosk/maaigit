import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { Lang, StatusInfo } from '../../shared/types';
import { api } from '../api';
import { useSettings, type Look, type ToggleId } from '../settings';
import { useOnRefresh } from '../refresh';
import { CalendarFeed } from '../components/CalendarFeed';
import { NotificationSettings } from '../components/NotificationSettings';

export function SettingsScreen() {
  const { t, settings, update, toggle } = useSettings();
  const [status, setStatus] = useState<StatusInfo | null>(null);

  const loadStatus = useCallback(() => api.status().then(setStatus).catch(() => {}), []);
  useOnRefresh(() => void loadStatus());
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const langs: { id: Lang; label: string }[] = [
    { id: 'en', label: 'English' },
    { id: 'ar', label: 'العربية' },
  ];
  const looks: Look[] = ['system', 'light', 'dark'];
  const toggles = Object.keys(t.toggles) as ToggleId[];

  return (
    <div className="screen">
      <h1 className="title">{t.settings}</h1>

      <section className="card">
        <div className="field">
          <span className="section-label" id="lang-label" style={{ padding: 0 }}>{t.language}</span>
          <div className="seg" role="radiogroup" aria-labelledby="lang-label">
            {langs.map((l) => (
              <button key={l.id} role="radio" aria-checked={settings.lang === l.id} onClick={() => update({ lang: l.id })}>{l.label}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="section-label" id="look-label" style={{ padding: 0 }}>{t.appearance}</span>
          <div className="seg" role="radiogroup" aria-labelledby="look-label">
            {looks.map((l) => (
              <button key={l} role="radio" aria-checked={settings.look === l} onClick={() => update({ look: l })}>{t.looks[l]}</button>
            ))}
          </div>
        </div>
      </section>

      <div className="section-label">{t.connections}</div>
      <section className="card" aria-label={t.connections}>
        {status ? (
          <>
            <Conn state={status.aiConfigured ? 'on' : 'off'} name="Claude AI">{status.aiConfigured ? t.aiConnected(status.model) : t.aiDemo}</Conn>
            <Conn state={status.mail?.configured ? 'on' : 'off'} name={t.gmail}>{status.mail?.configured ? t.gmailConnected(status.mail.from) : t.gmailOff}</Conn>
            <Conn state={status.calendar?.error ? 'bad' : status.calendar?.configured ? 'on' : 'off'} name={t.calendars}>
              {status.calendar?.configured ? (
                <>
                  {status.calendar.sources?.map((c) => (
                    <span key={c.name} style={{ display: 'block' }}>
                      {c.error ? '✗' : '✓'} {t.calendarSource(c.name, c.events)}
                      {c.error && <span className="sub" style={{ display: 'block' }}>{t.calendarError(c.error)}</span>}
                    </span>
                  ))}
                  {status.calendar.merged ? <span className="sub" style={{ display: 'block' }}>{t.calendarMerged(status.calendar.merged)}</span> : null}
                </>
              ) : (
                t.calendarOff
              )}
                          {status.calendar?.write && (
                <span style={{ display: 'block', marginTop: 4 }}>
                  {status.calendar.write.configured ? (status.calendar.write.error ? `✗ ${t.googleWriteError(status.calendar.write.error)}` : `✓ ${t.googleWriteOn(status.calendar.write.calendar ?? 'Google Calendar')}`) : <span className="sub">{t.googleWriteOff}</span>}
                </span>
              )}
            </Conn>
            <Conn state={status.asana?.error ? 'bad' : status.asana?.configured ? 'on' : 'off'} name={t.asana}>
              {status.asana?.error
                ? t.asanaError(status.asana.error)
                : status.asana?.configured
                  ? t.asanaConnected(status.asana.open, status.asana.overdue)
                  : t.asanaOff}
            </Conn>
            <Conn state={status.whatsapp?.configured ? 'on' : 'off'} name={t.whatsappConn}>
              {status.whatsapp?.configured ? t.whatsappConnected(status.whatsapp.number ?? '', status.whatsapp.keepDays) : t.whatsappOff}
            </Conn>
          </>
        ) : (
          <div className="skeleton"><span /><span /></div>
        )}
        <div className="row wrap">
          <a href="#/admin" className="btn secondary grow" style={{ textDecoration: 'none' }}>{t.adminPortal}</a>
          {status?.auth && status.auth !== 'none' && (
            <button className="btn danger" onClick={() => api.logout().finally(() => window.location.reload())}>{t.signOut}</button>
          )}
        </div>
      </section>

      <CalendarFeed googleDirect={Boolean(status?.calendar?.write?.working)} />

      <NotificationSettings />

      <div className="section-label">{t.accessibility} · {t.howYouUse}</div>
      <section className="card flush">
        {toggles.map((id) => {
          const [label, hint] = t.toggles[id];
          return (
            <div key={id} className="toggle-row">
              <div>
                <div>{label}</div>
                <div className="sub">{hint}</div>
              </div>
              <button role="switch" className="switch" aria-checked={settings.toggles[id]} aria-label={label} onClick={() => toggle(id)}>
                <span />
              </button>
            </div>
          );
        })}
      </section>
      <p className="sub">{t.followsDevice}</p>

    </div>
  );
}

/** One line in the Connections card: a dot (green working, red failing, grey off), the service, and its status. */
function Conn({ state, name, children }: { state: 'on' | 'off' | 'bad'; name: string; children: ReactNode }) {
  return (
    <div className="conn">
      <span className={`conn-dot ${state}`} aria-hidden="true" />
      <span><strong>{name}: </strong>{children}</span>
    </div>
  );
}
