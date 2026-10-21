import { useCallback, useEffect, useState } from 'react';
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startRegistration } from '@simplewebauthn/browser';
import { api, type Passkey } from '../api';
import { dayTime } from '../format';
import { useSettings } from '../settings';
import { useAction } from '../useAction';

/** Settings → Face ID: sign in with Face ID (or a fingerprint) instead of typing the password. */
export function FaceId() {
  const { t, settings } = useSettings();
  const [keys, setKeys] = useState<Passkey[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const { busy, error, run } = useAction();

  const load = useCallback(() => {
    api.passkeys().then(setKeys).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    if (!browserSupportsWebAuthn()) return setAvailable(false);
    platformAuthenticatorIsAvailable().then(setAvailable).catch(() => setAvailable(false));
  }, [load]);

  const setUp = () =>
    run(async () => {
      try {
        const options = await api.passkeyRegisterOptions();
        const response = await startRegistration({ optionsJSON: options });
        await api.passkeyRegister(response, /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : t.thisDevice);
        load();
      } catch (err) {
        if ((err as Error).name === 'NotAllowedError') throw new Error(t.faceIdCancelled, { cause: err });
        throw err;
      }
    });

  const remove = (id: string) =>
    run(async () => {
      await api.deletePasskey(id);
      load();
    });

  return (
    <>
      <div className="section-label">{t.faceIdTitle}</div>
      <section className="card">
        <p style={{ fontSize: '0.9em' }}>{keys.length ? t.faceIdOn : t.faceIdOff}</p>
        {available === false && <div className="banner">{t.faceIdUnsupported}</div>}
        {keys.map((k) => (
          <div key={k.id} className="between">
            <div>
              <div>{k.name}</div>
              <div className="sub">{k.lastUsedAt ? t.faceIdLastUsed(dayTime(k.lastUsedAt, settings.lang)) : t.faceIdNeverUsed}</div>
            </div>
            <button className="btn danger" onClick={() => remove(k.id)} disabled={busy} aria-label={`${t.remove}: ${k.name}`}>{t.remove}</button>
          </div>
        ))}
        <button className="btn primary big" onClick={setUp} disabled={busy || available === false}>{busy ? t.sending : keys.length ? t.faceIdAddAnother : t.faceIdSetUp}</button>
        {keys.length > 0 && <LockAfter />}
        {error && <div className="error" role="alert">{error}</div>}
      </section>
    </>
  );
}

const LOCK_CHOICES = [5, 15, 30, 60, 240, 1440];

/** How long a Face ID device stays open without being used. Devices without Face ID never lock by themselves. */
function LockAfter() {
  const { t } = useSettings();
  const [minutes, setMinutes] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.status().then((s) => setMinutes(s.lockMinutes ?? 30)).catch(() => {});
  }, []);
  const pick = (next: number) => {
    const before = minutes;
    setMinutes(next);
    setError('');
    api.setLockMinutes(next).catch((e: Error) => {
      setMinutes(before);
      setError(e.message);
    });
  };
  return (
    <div className="field">
      <label htmlFor="lock-after">{t.lockAfter}</label>
      <select id="lock-after" value={minutes ?? ''} disabled={minutes === null} onChange={(e) => pick(Number(e.target.value))}>
        {LOCK_CHOICES.map((m) => <option key={m} value={m}>{t.lockChoice(m)}</option>)}
      </select>
      <span className="sub">{t.lockHint}</span>
      {error && <div className="error" role="alert">{error}</div>}
    </div>
  );
}
