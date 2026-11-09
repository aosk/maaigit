import { useEffect, useState } from 'react';
import type { TradeOrder, TradingState } from '../../shared/trading';
import { api, type TradingMarket } from '../api';
import { useSettings } from '../settings';
import { signed } from '../screens/StockSmart';

const MARKETS: TradingMarket[] = ['sa', 'us', 'crypto'];
const FLAG: Record<TradingMarket, string> = { sa: '🇸🇦', us: '🇺🇸', crypto: '₿' };

/** YYYY-MM-DD in Riyadh, the day the desks count "today" by. */
const riyadhDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** Today's trades that went through (filled in full or in part), newest first. */
function todaysTrades(st: TradingState, now: Date): TradeOrder[] {
  const today = riyadhDay(now);
  return st.orders.filter((o) => (o.status === 'filled' || o.status === 'partial') && o.filledQty > 0 && riyadhDay(new Date(o.createdAt)) === today).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** «أسواقي» at the top of «يومك»: every desk on its own line (open or closed, today's profit or loss), and each of today's trades. */
export function StockStrip() {
  const { t, settings } = useSettings();
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
  const now = new Date();
  const name: Record<TradingMarket, string> = { sa: s.marketSa, us: s.marketUs, crypto: s.marketCrypto };
  const label = (st: TradingState, symbol: string) => {
    const i = st.universe.find((u) => u.symbol === symbol);
    return st.market === 'sa' && i ? (settings.lang === 'ar' ? i.nameAr : i.nameEn) : symbol;
  };
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
        // The same buy or sale more than once today shows once, with a count.
        const trades = [...todaysTrades(st, now).reduce((g, o) => g.set(`${o.side}|${o.symbol}`, { ...o, times: (g.get(`${o.side}|${o.symbol}`)?.times ?? 0) + 1 }), new Map<string, TradeOrder & { times: number }>()).values()];
        const tone = st.dayPnl > 0 ? 'up' : st.dayPnl < 0 ? 'down' : '';
        return (
          <a key={m} className={`sx-row${st.halted ? ' halted' : ''}`} href="#/stocks" onClick={() => open(m)} aria-label={`${name[m]} · ${s.open}`}>
            <span className="sx-line">
              <span className="sx-flag" aria-hidden="true">{FLAG[m]}</span>
              <b className="sx-name">{name[m]}</b>
              <i className={`sx-dot${st.clock.open ? ' on' : ''}`} title={st.halted ? s.stripHalted : st.clock.open ? s.stripOpen : s.stripClosed} />
              <b className={`sx-pnl ss-num ${tone}`} dir="ltr">{signed(st.dayPnl)} <small>{st.currency}</small></b>
            </span>
            <span className="sx-trades sub">
              {trades.length === 0
                ? s.stripNoTrades
                : trades.map((o, i) => (
                    <span key={o.id}>
                      {i > 0 && (settings.lang === 'ar' ? '، ' : ', ')}
                      <span className={o.side === 'buy' ? 'up' : 'down'}>{o.side === 'buy' ? '▲' : '▼'}</span> <bdi>{label(st, o.symbol)}{o.times > 1 ? ` ×${o.times}` : ''}</bdi>
                    </span>
                  ))}
            </span>
          </a>
        );
      })}
    </section>
  );
}
