import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useSettings } from '../settings';

/** Sign-in: the PIN from the computer's terminal at home, or the password when MAAI is online. */
export function Unlock({ kind }: { kind: 'pin' | 'password' }) {
  const { t, settings, update } = useSettings();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="shell">
      <form className="screen" onSubmit={submit} style={{ minHeight: '100dvh', justifyContent: 'center' }}>
        <div className="between">
          <img src="/icon.svg" alt="" width={56} height={56} style={{ borderRadius: 14 }} />
          <button type="button" className="icon-btn" aria-label={t.switchLanguage} onClick={() => update({ lang: settings.lang === 'ar' ? 'en' : 'ar' })}>
            {settings.lang === 'ar' ? 'EN' : 'ع'}
          </button>
        </div>
        <h1 className="title">{kind === 'pin' ? t.unlockTitle : t.passwordTitle}</h1>
        <p className="sub" style={{ fontSize: '0.9em' }}>{kind === 'pin' ? t.unlockHint : t.passwordHint}</p>
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
      </form>
    </div>
  );
}
