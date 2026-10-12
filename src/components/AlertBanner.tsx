import { useEffect, useRef, useState } from 'react';
import type { AppAlert } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { Bell } from './Icons';

/** While MAAI is open, alerts also slide in at the top, so nothing is missed without notifications on. */
export function AlertBanner() {
  const { t } = useSettings();
  const [shown, setShown] = useState<AppAlert[]>([]);
  const since = useRef(new Date().toISOString());

  useEffect(() => {
    const poll = () =>
      api
        .alerts(since.current)
        .then((alerts) => {
          if (!alerts.length) return;
          since.current = alerts[0].at;
          setShown((s) => [...alerts.reverse(), ...s].slice(0, 3));
        })
        .catch(() => {});
    const timer = setInterval(poll, 20_000);
    return () => clearInterval(timer);
  }, []);

  if (!shown.length) return null;
  return (
    <div className="alerts" role="status" aria-live="polite">
      {shown.map((a) => (
        <div key={a.id} className="alert">
          <span className="alert-icon"><Bell size={20} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{a.title}</div>
            <div className="sub">{a.body}</div>
          </div>
          <button className="btn ghost" onClick={() => setShown((s) => s.filter((x) => x.id !== a.id))}>{t.dismiss}</button>
        </div>
      ))}
    </div>
  );
}
