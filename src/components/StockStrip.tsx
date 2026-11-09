import { useEffect, useState } from 'react';
import type { TradingState } from '../../shared/trading';
import { api, type TradingMarket } from '../api';
import { useSettings } from '../settings';
import { signed } from '../screens/StockSmart';
import { MOOD_COLOR } from './MarketPulse';

const MARKETS: TradingMarket[] = ['sa', 'us', 'crypto'];
const FLAG: Record<TradingMarket, string> = { sa: '🇸🇦', us: '🇺🇸', crypto: '₿' };
/** The market's overall mood as a symbol: strongly up, up, mixed, down, strongly down. */
const MOOD_SYMBOL: Record<NonNullable<TradingState['pulse']>['mood'], string> = { strong_up: '▲▲', up: '▲', mixed: '◆', down: '▼', strong_down: '▼▼' };

/** «أسواقي» at the top of «يومك»: one line per desk, its flag, the market's overall mood today and the desk's profit or loss in money. */
export function StockStrip() {
  const { t } = useSettings();
  const s = t.ss;
  const [desks, setDesks] = useState<Partial<Record<TradingMarket, TradingState>>>({});

  useEffect(() => {
    const load = () =>
      MARKETS.forEach((m) =>
        api
          .trading(true, m)
          .then((st) => setDesks((d) => ({ ...d, [m]: st })))
          .catch(() => undefined),
      );
    load();
    const poll = setInterval(() => !document.hidden && load(), 60_000);
    return () => clearInterval(poll);
  }, []);

  const shown = MARKETS.filter((m) => desks[m]);
  if (shown.length === 0) return null;
  const name: Record<TradingMarket, string> = { sa: s.marketSa, us: s.marketUs, crypto: s.marketCrypto };
  const open = (m: TradingMarket) => {
    try {
      localStorage.setItem('maai.stocksMarket', m);
    } catch {
      /* the screen opens on the Saudi desk */
    }
  };

  return (
    <section className="sx" aria-label={s.stripTitle}>
      {shown.map((m) => {
        const st = desks[m]!;
        const tone = st.dayPnl > 0 ? 'up' : st.dayPnl < 0 ? 'down' : '';
        return (
          <a key={m} className={`sx-row${st.halted ? ' halted' : ''}`} href="#/stocks" onClick={() => open(m)} aria-label={`${name[m]} · ${s.open}`} title={name[m]}>
            <span className="sx-flag" aria-hidden="true">{FLAG[m]}</span>
            <span className="sx-cell">
              <span className="sub">{s.stripMarket}</span>
              {st.pulse ? (
                <b className="sx-mood" style={{ color: MOOD_COLOR[st.pulse.mood] }} title={s.pulseMood[st.pulse.mood]} aria-label={s.pulseMood[st.pulse.mood]}>
                  {MOOD_SYMBOL[st.pulse.mood]}
                </b>
              ) : (
                <b>—</b>
              )}
            </span>
            <span className="sx-cell">
              <span className="sub">{s.stripMine}</span>
              <b className={`ss-num ${tone}`} dir="ltr">{signed(st.dayPnl)} <small>{st.currency}</small></b>
            </span>
          </a>
        );
      })}
    </section>
  );
}
