import { useEffect, useRef, useState, type FormEvent } from 'react';
import { browserSupportsWebAuthn, startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { api } from '../api';
import { useSettings } from '../settings';

/** Sign-in: the PIN from the computer's terminal at home, or the password when MAAI is online. */
export function Unlock({ kind, idle = false }: { kind: 'pin' | 'password'; idle?: boolean }) {
  const { t, settings, update } = useSettings();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Face ID, when it was set up on this MAAI: its one-time challenge is fetched ahead, so the tap can open Face ID at once.
  const faceId = useRef<{ options: PublicKeyCredentialRequestOptionsJSON; at: number } | null>(null);
  const [faceReady, setFaceReady] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    if (kind !== 'password' || !browserSupportsWebAuthn()) return;
    api
      .passkeyLoginOptions()
      .then((options) => {
        faceId.current = { options, at: Date.now() };
        setFaceReady(true);
      })
      .catch(() => {});
  }, [kind]);

  async function signInWithFace(automatic = false) {
    if (!faceId.current) return;
    setBusy(true);
    setError('');
    try {
      const response = await startAuthentication({ optionsJSON: faceId.current.options });
      await api.passkeyLogin(response);
      window.location.reload();
    } catch (err) {
      const cancelled = (err as Error).name === 'NotAllowedError';
      // Opening MAAI tries Face ID by itself; if the phone wants a tap first, that is not an error to show.
      if (!(automatic && cancelled)) setError(cancelled ? t.faceIdCancelled : (err as Error).message);
      setBusy(false);
      // A challenge works once: get a fresh one for the next try.
      api.passkeyLoginOptions().then((options) => (faceId.current = { options, at: Date.now() })).catch(() => setFaceReady(false));
    }
  }

  // Opening MAAI asks for Face ID straight away.
  useEffect(() => {
    if (faceReady && !asked.current) {
      asked.current = true;
      void signInWithFace(true);
    }
  }, [faceReady]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.unlock(pin);
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  // With Face ID set up, opening MAAI is Face ID alone; the password is a small fallback.
  const faceFirst = kind === 'password' && faceReady && !usePassword;

  return (
    <div className="shell">
      <form className="screen" onSubmit={submit} style={{ minHeight: '100dvh', justifyContent: 'center' }}>
        <div className="between">
          <img src="/icon.svg" alt="" width={56} height={56} style={{ borderRadius: 14 }} />
          <button type="button" className="icon-btn" aria-label={t.switchLanguage} onClick={() => update({ lang: settings.lang === 'ar' ? 'en' : 'ar' })}>
            {settings.lang === 'ar' ? 'EN' : 'ع'}
          </button>
        </div>
        <h1 className="title">{faceFirst ? t.faceIdLockedTitle : kind === 'pin' ? t.unlockTitle : t.passwordTitle}</h1>
        <p className="sub" style={{ fontSize: '0.9em' }}>{faceFirst ? (idle ? t.faceIdIdleHint : t.faceIdLockedHint) : kind === 'pin' ? t.unlockHint : t.passwordHint}</p>

        {faceFirst ? (
          <>
            <button type="button" className="btn primary big" onClick={() => signInWithFace()} disabled={busy} autoFocus>
              {t.faceIdSignIn}
            </button>
            {error && <div className="error" role="alert">{error}</div>}
            <button type="button" className="btn ghost" onClick={() => setUsePassword(true)}>{t.usePasswordInstead}</button>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="pin">{kind === 'pin' ? t.pin : t.password}</label>
              {kind === 'pin' ? (
                <input
                  id="pin"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  style={{ fontSize: '1.6em', letterSpacing: '0.3em', textAlign: 'center' }}
                  autoFocus
                />
              ) : (
                <input id="pin" type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" dir="ltr" autoFocus />
              )}
            </div>
            {error && <div className="error" role="alert">{error}</div>}
            <button className="btn primary big" type="submit" disabled={busy || pin.length < (kind === 'pin' ? 4 : 1)}>{t.unlock}</button>
            {kind === 'password' && faceReady && (
              <button type="button" className="btn ghost" onClick={() => setUsePassword(false)}>{t.faceIdSignIn}</button>
            )}
          </>
        )}
      </form>
    </div>
  );
}
