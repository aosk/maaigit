import { useEffect, useState } from 'react';
import type { CourierLogEntry, CourierSettings as Courier } from '../../shared/types';
import { api } from '../api';
import { dayTime } from '../format';
import { useSettings } from '../settings';
import { plusDigits } from '../teamsLogic';
import { useAction } from '../useAction';

/** Settings → Delivery couriers: what MAAI texts to someone who looks like a courier, and what it did lately. */
export function CourierSettings() {
  const { t, settings } = useSettings();
  const [saved, setSaved] = useState<Courier | null>(null);
  const [log, setLog] = useState<CourierLogEntry[]>([]);
  const [short, setShort] = useState('');
  const [details, setDetails] = useState('');
  const [photo, setPhoto] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, setError, run } = useAction();

  const show = (c: Courier) => {
    setSaved(c);
    setShort(c.shortAddress);
    setDetails(c.fullDetails);
    setPhoto(c.doorPhotoPath);
  };

  useEffect(() => {
    api.courier().then(
      (r) => {
        show(r.settings);
        setLog(r.log);
      },
      (e: Error) => setError(e.message),
    );
  }, [setError]);

  const save = (enabled: boolean) =>
    run(async () => {
      setDone(false);
      if (enabled && !short.trim()) return setError(t.cr.needAddress);
      show(await api.saveCourier({ enabled, shortAddress: short, fullDetails: details, doorPhotoPath: photo }));
      setLog((await api.courier()).log);
      setDone(true);
    });

  const on = saved?.enabled ?? false;
  return (
    <section className="card" aria-labelledby="cr-label">
      <span className="section-label" id="cr-label" style={{ padding: 0 }}>{t.cr.title}</span>
      <div className="banner" role="note">{t.cr.warn}</div>
      <div className="tm-switch-row">
        <span>
          <span id="cr-on">{t.cr.on}</span>
          <span className="sub" style={{ display: 'block' }}>{t.cr.offHint}</span>
        </span>
        <button role="switch" className="switch" aria-checked={on} aria-labelledby="cr-on" disabled={busy || !saved} onClick={() => void save(!on)}>
          <span />
        </button>
      </div>
      <form className="tm-form" onSubmit={(e) => { e.preventDefault(); void save(on); }}>
        <div className="field">
          <label htmlFor="cr-short">{t.cr.shortAddress}</label>
          <textarea id="cr-short" rows={3} maxLength={240} value={short} onChange={(e) => setShort(e.target.value)} aria-describedby="cr-short-hint" />
          <span className="sub" id="cr-short-hint">{t.cr.shortHint}</span>
        </div>
        <div className="field">
          <label htmlFor="cr-details">{t.cr.details}</label>
          <textarea id="cr-details" rows={4} maxLength={600} value={details} onChange={(e) => setDetails(e.target.value)} aria-describedby="cr-details-hint" />
          <span className="sub" id="cr-details-hint">{t.cr.detailsHint}</span>
        </div>
        <div className="field">
          <label htmlFor="cr-photo">{t.cr.photo}</label>
          <input id="cr-photo" value={photo} dir="ltr" maxLength={400} autoComplete="off" onChange={(e) => setPhoto(e.target.value)} aria-describedby="cr-photo-hint" />
          <span className="sub" id="cr-photo-hint">{t.cr.photoHint}</span>
        </div>
        <button className="btn primary" type="submit" disabled={busy}>{t.cr.save}</button>
        {done && <p className="sub" role="status">✓ {t.cr.saved}</p>}
        {error && <div className="error" role="alert">{error}</div>}
      </form>
      <span className="section-label" style={{ padding: 0 }}>{t.cr.logTitle}</span>
      {log.length === 0 ? (
        <p className="sub">{t.cr.logEmpty}</p>
      ) : (
        <ul className="tm-list" aria-label={t.cr.logTitle}>
          {log.slice(0, 20).map((e, i) => (
            <li key={`${e.at}-${i}`} className="tm-item">
              <div className="tm-head">
                <strong>{t.cr.stages[e.stage]}</strong>
                <span className="sub">{dayTime(e.at, settings.lang)}</span>
              </div>
              <span className="sub tm-meta">
                {e.name && <><bdi>{e.name}</bdi>{' '}</>}
                <bdi dir="ltr">{plusDigits(e.phone)}</bdi>
              </span>
              {e.note && <span className="sub tm-meta"><bdi dir="auto">{e.note}</bdi></span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
