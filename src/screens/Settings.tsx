import { useEffect, useState } from 'react';
import type { Lang, StatusInfo } from '../../shared/types';
import { api } from '../api';
import { useSettings, type Look, type ToggleId } from '../settings';
import { NotificationSettings } from '../components/NotificationSettings';

export function SettingsScreen() {
  const { t, settings, update, toggle } = useSettings();
  const [status, setStatus] = useState<StatusInfo | null>(null);

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
  }, []);

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
            <div className="conn">
              <span className={`conn-dot ${status.aiConfigured ? 'on' : 'off'}`} aria-hidden="true" />
              <span><strong>Claude AI: </strong>{status.aiConfigured ? t.aiConnected(status.model) : t.aiDemo}</span>
            </div>
            <div className="conn">
              <span className={`conn-dot ${status.mail?.configured ? 'on' : 'off'}`} aria-hidden="true" />
              <span><strong>{t.gmail}: </strong>{status.mail?.configured ? t.gmailConnected(status.mail.from) : t.gmailOff}</span>
            </div>
            <div className="conn">
              <span className={`conn-dot ${status.calendar?.error ? 'bad' : status.calendar?.configured ? 'on' : 'off'}`} aria-hidden="true" />
              <span>
                <strong>{t.googleCalendar}: </strong>
                {status.calendar?.error
                  ? t.calendarError(status.calendar.error)
                  : status.calendar?.configured
                    ? t.calendarConnected(status.calendar.events)
                    : t.calendarOff}
              </span>
            </div>
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
