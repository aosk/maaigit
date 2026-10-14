import { useEffect, useState } from 'react';
import type { NotifyPrefs, NotifyStatus } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { currentSubscription, disablePush, enablePush, isIos, isStandalone, pushSupported, worker } from '../push';

type Problem = 'denied' | 'unsupported' | 'home' | 'cert' | null;

/** The Notifications card in Settings: turn alerts on for this device and choose which ones. */
export function NotificationSettings() {
  const { t, settings } = useSettings();
  const [status, setStatus] = useState<NotifyStatus | null>(null);
  const [on, setOn] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();

  useEffect(() => {
    api.notify().then(setStatus).catch(() => {});
    currentSubscription().then((s) => setOn(Boolean(s)));
    if (isIos && !isStandalone) setProblem('home');
    else if (!pushSupported) setProblem('unsupported');
    else if (Notification.permission === 'denied') setProblem('denied');
    else worker().then((reg) => !reg && window.location.protocol === 'https:' && setProblem('cert'));
  }, []);

  const turnOn = () =>
    run(async () => {
      if (!status) return;
      setNote('');
      const result = await enablePush(status.publicKey, (sub) => api.subscribe(sub, settings.lang)).catch((e: Error) => {
        console.error(e);
        throw new Error(t.notifyFailed);
      });
      if (result !== 'ok') return setProblem(result === 'no-worker' ? 'cert' : result === 'denied' ? 'denied' : 'unsupported');
      setOn(true);
      setProblem(null);
      setStatus(await api.notify());
    });

  const turnOff = () =>
    run(async () => {
      await disablePush((endpoint) => api.unsubscribe(endpoint)).catch(() => {});
      setOn(false);
      setStatus(await api.notify());
    });

  const test = () =>
    run(async () => {
      await api.testNotify();
      setNote(t.notifyTestSent);
    });

  const flip = (key: keyof Pick<NotifyPrefs, 'reminders' | 'leave' | 'events' | 'prayers' | 'briefing'>) =>
    run(async () => {
      if (!status) return;
      const prefs = await api.setNotifyPrefs({ [key]: !status.prefs[key] });
      setStatus({ ...status, prefs });
    });

  const setBriefingTime = (briefingTime: string) =>
    run(async () => {
      if (!status || !briefingTime) return;
      setStatus({ ...status, prefs: await api.setNotifyPrefs({ briefingTime }) });
    });

  const sendBriefing = () =>
    run(async () => {
      setNote('');
      await api.sendBriefing();
      setNote(t.briefingSent);
    });

  const kinds = Object.keys(t.notifyKinds) as (keyof typeof t.notifyKinds)[];

  return (
    <>
      <div className="section-label">{t.notifications}</div>
      <section className="card">
        <p style={{ fontSize: '0.9em' }}>{on ? t.notifyOn : t.notifyOff}</p>

        {problem === 'home' && <div className="banner">{t.notifyAddToHome}</div>}
        {problem === 'unsupported' && <div className="banner">{t.notifyUnsupported}</div>}
        {problem === 'denied' && <div className="banner">{t.notifyDenied}</div>}
        {problem === 'cert' && (
          <div className="banner">
            <p>{t.notifyNeedsCert}</p>
            <ol style={{ margin: '6px 0 10px', paddingInlineStart: 20 }}>
              {t.notifyCertSteps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <a className="btn secondary" href="/maai-cert.crt" style={{ textDecoration: 'none' }}>{t.downloadCert}</a>
          </div>
        )}

        <div className="row wrap">
          {on ? (
            <>
              <button className="btn secondary grow" onClick={test} disabled={busy}>{t.notifyTest}</button>
              <button className="btn danger" onClick={turnOff} disabled={busy}>{t.notifyTurnOff}</button>
            </>
          ) : (
            <button className="btn primary big grow" onClick={turnOn} disabled={busy || !status || problem === 'home' || problem === 'unsupported'}>
              {t.notifyTurnOn}
            </button>
          )}
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        {note && <p className="sub" role="status">{note}</p>}
        {status && status.devices > 0 && <p className="sub">{t.devices(status.devices)}</p>}
      </section>

      {status && (
        <section className="card flush" aria-label={t.notifications}>
          {kinds.map((k) => {
            const [label, hint] = t.notifyKinds[k];
            return (
              <div key={k} className="toggle-row">
                <div>
                  <div>{label}</div>
                  <div className="sub">{hint}</div>
                </div>
                <button role="switch" className="switch" aria-checked={status.prefs[k]} aria-label={label} onClick={() => flip(k)}>
                  <span />
                </button>
              </div>
            );
          })}
          {status.prefs.briefing && (
            <div className="toggle-row" style={{ flexWrap: 'wrap', gap: 10 }}>
              <label htmlFor="briefing-time">{t.briefingAt}</label>
              <input id="briefing-time" type="time" dir="ltr" value={status.prefs.briefingTime} disabled={busy} onChange={(e) => setBriefingTime(e.target.value)} style={{ minHeight: 40, borderRadius: 10, border: '1px solid var(--border)', padding: '6px 10px', background: 'var(--surface)', color: 'var(--text)' }} />
              <button className="btn secondary" onClick={sendBriefing} disabled={busy} style={{ flexBasis: '100%' }}>{t.briefingSendNow}</button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
