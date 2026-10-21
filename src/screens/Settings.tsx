import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import type { Lang, ReplyMode, StatusInfo } from '../../shared/types';
import { api } from '../api';
import { dayTime } from '../format';
import { useSettings, type Look, type ToggleId } from '../settings';
import type { LayoutChoice } from '../layout';
import { useOnRefresh } from '../refresh';
import { CalendarFeed } from '../components/CalendarFeed';
import { NotificationSettings } from '../components/NotificationSettings';
import { FaceId } from '../components/FaceId';
import { VoiceSettings } from '../components/VoiceSettings';
import { Chevron } from '../components/Icons';

export function SettingsScreen() {
  const { t, settings, update, toggle, detected, width } = useSettings();
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [known, setKnown] = useState<number | null>(null);

  const loadStatus = useCallback(() => {
    api.profile().then((p) => setKnown(p.facts.length)).catch(() => {});
    return api.status().then(setStatus).catch(() => {});
  }, []);
  useOnRefresh(() => void loadStatus());
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const langs: { id: Lang; label: string }[] = [
    { id: 'en', label: 'English' },
    { id: 'ar', label: 'العربية' },
  ];
  const looks: Look[] = ['system', 'light', 'dark'];
  const layouts: LayoutChoice[] = ['auto', 'phone', 'tablet', 'desktop'];
  const toggles = Object.keys(t.toggles) as ToggleId[];

  return (
    <div className="screen cols">
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
        <div className="field">
          <span className="section-label" id="layout-label" style={{ padding: 0 }}>{t.layoutTitle}</span>
          <div className="seg wrap" role="radiogroup" aria-labelledby="layout-label">
            {layouts.map((l) => (
              <button key={l} role="radio" aria-checked={settings.layout === l} onClick={() => update({ layout: l })}>{t.layoutChoices[l]}</button>
            ))}
          </div>
          <span className="sub">{t.layoutNow(t.layoutNames[detected], width)}. {t.layoutHint}</span>
        </div>
      </section>

      <a className="card link-row" href="#/profile">
        <span>
          <strong>{t.profileTitle}</strong>
          <span className="sub" style={{ display: 'block' }}>{known === null ? t.profileRowHint : `${t.profileRow(known)} · ${t.profileRowHint}`}</span>
        </span>
        <Chevron size={20} />
      </a>

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
            {status.storage && (
              <Conn state={status.storage.persistent ? 'on' : 'bad'} name={t.storageName}>
                {status.storage.persistent ? t.storageOk : t.storageLost}
              </Conn>
            )}
            <Conn state={status.bot?.stale ? 'bad' : status.bot?.connected ? 'on' : 'off'} name={t.botConn}>
              {status.bot?.connected ? (status.bot.stale ? t.botStale : t.botConnected(status.bot.device ?? '', status.bot.lastSync ? dayTime(status.bot.lastSync, settings.lang) : '')) : t.botOff}
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

      {status?.bot?.connected && <ReplyModeCard mode={status.bot.replyMode} onChanged={() => void loadStatus()} />}

      <CalendarFeed googleDirect={Boolean(status?.calendar?.write?.working)} />

      <FaceId />

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

      <div className="section-label">{t.dictationTitle}</div>
      <section className="card">
        <p className="sub"><strong>{t.smartVoiceName}:</strong> {status?.voice?.smart ? t.smartVoiceOn : t.smartVoiceOff}</p>
      </section>

      <VoiceSettings />

    </div>
  );
}

/** How MAAI answers new WhatsApp messages by itself, chosen here. */
function ReplyModeCard({ mode, onChanged }: { mode: ReplyMode; onChanged: () => void }) {
  const { t } = useSettings();
  const [current, setCurrent] = useState(mode);
  const [error, setError] = useState('');
  const modes: ReplyMode[] = ['smart', 'fixed', 'off'];
  const pick = (next: ReplyMode) => {
    setCurrent(next);
    setError('');
    api.setReplyMode(next).then(onChanged).catch((e: Error) => {
      setCurrent(mode);
      setError(e.message);
    });
  };
  return (
    <section className="card" aria-labelledby="reply-mode-label">
      <span className="section-label" id="reply-mode-label" style={{ padding: 0 }}>{t.replyModeTitle}</span>
      <div className="seg" role="radiogroup" aria-labelledby="reply-mode-label">
        {modes.map((m) => (
          <button key={m} role="radio" aria-checked={current === m} onClick={() => pick(m)}>{t.replyModes[m]}</button>
        ))}
      </div>
      <p className="sub">{t.replyModeHint[current]}</p>
      {error && <div className="error" role="alert">{error}</div>}
    </section>
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
