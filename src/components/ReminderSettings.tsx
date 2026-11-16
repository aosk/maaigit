import { useState } from 'react';
import type { TeamSettings } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { hoursOk, phoneOk } from '../teamsLogic';
import { useAction } from '../useAction';

/** When and how MAAI sends the reminders, and the number it uses to tell the owner. */
export function ReminderSettings({ settings, reload }: { settings: TeamSettings; reload: () => Promise<void> }) {
  const { t } = useSettings();
  const [enabled, setEnabled] = useState(settings.enabled);
  const [alert, setAlert] = useState(settings.alertPhone ?? '');
  const [from, setFrom] = useState(String(settings.fromHour));
  const [to, setTo] = useState(String(settings.toHour));
  const [between, setBetween] = useState(String(settings.hoursBetween));
  const [saved, setSaved] = useState(false);
  const { busy, error, setError, run } = useAction();

  const save = (on = enabled) =>
    run(async () => {
      setSaved(false);
      const [f, h, b] = [Number(from), Number(to), Number(between)];
      if (alert.trim() && !phoneOk(alert)) return setError(t.tm.errPhone);
      if (!hoursOk(f, h)) return setError(t.tm.errHours);
      if (!Number.isInteger(b) || b < 1 || b > 24) return setError(t.tm.errBetween);
      await api.saveTeamSettings({ enabled: on, alertPhone: alert.trim(), fromHour: f, toHour: h, hoursBetween: b });
      await reload();
      setSaved(true);
      return true;
    });

  return (
    <section className="card" aria-labelledby="tm-rem-label">
      <span className="section-label" id="tm-rem-label" style={{ padding: 0 }}>{t.tm.remindersTitle}</span>
      <div className="tm-switch-row">
        <span id="tm-rem-on">{t.tm.remindersOn}</span>
        <button role="switch" className="switch" aria-checked={enabled} aria-labelledby="tm-rem-on" disabled={busy} onClick={() => { setEnabled(!enabled); void save(!enabled).then((r) => { if (!r) setEnabled(enabled); }); }}>
          <span />
        </button>
      </div>
      <form className="tm-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <div className="field">
          <label htmlFor="tm-alert">{t.tm.alertPhone}</label>
          <input id="tm-alert" value={alert} dir="ltr" inputMode="tel" autoComplete="off" onChange={(e) => setAlert(e.target.value)} aria-describedby="tm-alert-hint" />
          <span className="sub" id="tm-alert-hint">{t.tm.alertPhoneHint}</span>
        </div>
        <div className="tm-three">
          <div className="field">
            <label htmlFor="tm-from">{t.tm.fromHour}</label>
            <input id="tm-from" type="number" min={0} max={23} inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tm-to">{t.tm.toHour}</label>
            <input id="tm-to" type="number" min={0} max={23} inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="tm-between">{t.tm.hoursBetween}</label>
            <input id="tm-between" type="number" min={1} max={24} inputMode="numeric" value={between} onChange={(e) => setBetween(e.target.value)} />
          </div>
        </div>
        <p className="sub">{t.tm.remindersHint}</p>
        <button className="btn primary" type="submit" disabled={busy}>{t.tm.save}</button>
        {saved && <p className="sub" role="status">✓ {t.tm.saved}</p>}
        {error && <div className="error" role="alert">{error}</div>}
      </form>
    </section>
  );
}
