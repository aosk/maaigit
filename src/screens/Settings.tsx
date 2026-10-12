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

      <div className="section-label">{t.aboutAi}</div>
      <section className="card">
        <p style={{ fontSize: '0.88em' }}>{status ? (status.aiConfigured ? t.aiConnected(status.model) : t.aiDemo) : '…'}</p>
        <a href="#/admin" className="btn secondary" style={{ textDecoration: 'none' }}>{t.adminPortal}</a>
      </section>
    </div>
  );
}
