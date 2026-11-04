import { useEffect, useState } from 'react';
import type { TradingState } from '../../shared/trading';
import { api } from '../api';
import { useSettings } from '../settings';
import { signed } from '../screens/StockSmart';
import { ChartUp, Chevron } from './Icons';

/** One line at the top of «يومك»: StockSmart's mode, today's profit or loss, the trades and the last thing that happened. */
export function StockStrip() {
  const { t } = useSettings();
  const [st, setSt] = useState<TradingState | null>(null);

  useEffect(() => {
    const load = () => api.trading(true).then(setSt).catch(() => setSt(null));
    void load();
    const poll = setInterval(() => !document.hidden && load(), 60_000);
    return () => clearInterval(poll);
  }, []);

  if (!st) return null;
  const last = [...st.events].reverse().find((e) => e.type === 'order.filled' || e.type === 'decision.created' || e.type === 'system.halted');
  const tone = st.dayPnl > 0 ? 'up' : st.dayPnl < 0 ? 'down' : '';
  return (
    <a className={`ss-strip${st.halted ? ' halted' : ''}`} href="#/stocks" aria-label={t.ss.open}>
      <span className="ss-strip-icon" aria-hidden="true"><ChartUp size={22} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="row" style={{ gap: 8 }}>
          <b>{t.stocks}</b>
          <span className={`ss-mode ${st.mode}`}>{st.mode === 'live' ? t.ss.live : t.ss.paper}</span>
        </span>
        <span className="sub ss-strip-last" dir="auto">{st.halted ? t.ss.halted(st.haltReason ?? '') : last ? `${t.ss.last} ${last.text}` : t.ss.tradesN(st.ordersToday)}</span>
      </span>
      <span style={{ textAlign: 'end' }}>
        <span className={`ss-num ${tone}`} dir="ltr">{signed(st.dayPnl)}</span>
        <span className="sub" dir="ltr" style={{ display: 'block' }}>{st.dayPnlPct > 0 ? '+' : ''}{st.dayPnlPct.toFixed(2)}% · {t.ss.tradesN(st.ordersToday)}</span>
      </span>
      <span className="ss-chev" aria-hidden="true"><Chevron size={18} /></span>
    </a>
  );
}
