import { useState } from 'react';
import type { StatusInfo } from '../../shared/types';
import { api } from '../api';
import { CITIES, nearestCity } from '../places';
import { refreshAll } from '../refresh';
import { useSettings } from '../settings';
import { useAction } from '../useAction';

type Where = StatusInfo['location'];

/** Where the user is: prayer times and the clock follow it. A city from the list, or the phone's own position. */
export function PlaceSettings({ where, onChanged }: { where?: Where; onChanged: () => Promise<void> | void }) {
  const { t, settings } = useSettings();
  const { busy, error, setError, run } = useAction();
  const [asking, setAsking] = useState(false);
  const ar = settings.lang === 'ar';
  const picked = where ? CITIES.find((c) => Math.abs(c.latitude - where.latitude) < 0.01 && Math.abs(c.longitude - where.longitude) < 0.01) : undefined;
  const name = !where ? '…' : picked ? (ar ? picked.ar : picked.en) : where.name || t.place.serverDefault;

  const set = (place: { latitude: number; longitude: number; timezone: string; name: string }) =>
    run(async () => {
      await api.setLocation(place);
      await onChanged();
      void refreshAll(); // «يومك» shows the new prayer times at once
    });

  const useMine = () => {
    setError('');
    if (!('geolocation' in navigator)) return setError(t.place.noGps);
    setAsking(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setAsking(false);
        const { latitude, longitude } = pos.coords;
        const near = nearestCity(latitude, longitude);
        // The phone's own time zone goes with its position.
        void set({ latitude, longitude, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Riyadh', name: near ? (ar ? near.ar : near.en) : t.place.mine });
      },
      (e) => {
        setAsking(false);
        setError(e.code === e.PERMISSION_DENIED ? t.place.denied : t.place.failed);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 600_000 },
    );
  };

  return (
    <section className="card" aria-labelledby="place-label">
      <span className="section-label" id="place-label" style={{ padding: 0 }}>{t.place.title}</span>
      <p className="sub">{t.place.now(name, where?.timezone ?? '')}</p>
      <div className="field">
        <label htmlFor="place-city">{t.place.city}</label>
        <select
          id="place-city"
          value={picked ? picked.en : ''}
          disabled={busy || asking}
          onChange={(e) => {
            const c = CITIES.find((x) => x.en === e.target.value);
            if (c) void set({ latitude: c.latitude, longitude: c.longitude, timezone: c.timezone, name: ar ? c.ar : c.en });
          }}
        >
          <option value="">{t.place.pick}</option>
          {CITIES.map((c) => <option key={c.en} value={c.en}>{ar ? c.ar : c.en}</option>)}
        </select>
      </div>
      <button className="btn secondary" type="button" disabled={busy || asking} onClick={useMine}>{asking ? t.place.asking : t.place.useMine}</button>
      <p className="sub">{t.place.note}</p>
      {error && <div className="error" role="alert">{error}</div>}
    </section>
  );
}
