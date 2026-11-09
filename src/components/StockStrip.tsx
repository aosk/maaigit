import { useEffect, useState } from 'react';
import type { TradeOrder, TradingState } from '../../shared/trading';
import { api, type TradingMarket } from '../api';
import { useSettings } from '../settings';
import { signed } from '../screens/StockSmart';
import { ChartUp, Chevron } from './Icons';
import { MOOD_COLOR } from './MarketPulse';

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
  const qty = (n: number) => String(Number(n.toFixed(6)));
  const open = (m: TradingMarket) => {
    try {
      localStorage.setItem('maai.stocksMarket', m);
    } catch {
      /* the screen opens on the Saudi desk */
    }
  };

  return (
    <section className="sx" aria-label={s.stripTitle}>
      <a className="sx-head" href="#/stocks" onClick={() => open('sa')}>
        <span className="ss-strip-icon" aria-hidden="true"><ChartUp size={20} /></span>
        <b style={{ flex: 1 }}>{s.stripTitle}</b>
        <span className={`ss-mode ${desks.sa?.mode ?? 'paper'}`}>{desks.sa?.mode === 'live' ? s.live : s.paper}</span>
      </a>
      {shown.map((m) => {
        const st = desks[m]!;
        const trades = todaysTrades(st, now);
        const tone = st.dayPnl > 0 ? 'up' : st.dayPnl < 0 ? 'down' : '';
        return (
          <a key={m} className={`sx-row${st.halted ? ' halted' : ''}`} href="#/stocks" onClick={() => open(m)} aria-label={`${name[m]} · ${s.open}`}>
            <span className="sx-line">
              <span className="sx-flag" aria-hidden="true">{FLAG[m]}</span>
              <span className="sx-name">
                <b>{name[m]}</b>
                <span className="sub">
                  <i className={`sx-dot${st.clock.open ? ' on' : ''}`} aria-hidden="true" />
                  {st.halted ? s.stripHalted : st.clock.open ? s.stripOpen : s.stripClosed}
                  {st.pulse && (
                    <span style={{ color: MOOD_COLOR[st.pulse.mood] }}> · {s.pulseMood[st.pulse.mood]}</span>
                  )}
                </span>
              </span>
              <span className="sx-pnl">
                <b className={`ss-num ${tone}`} dir="ltr">{signed(st.dayPnl)} <small>{st.currency}</small></b>
                <span className="sub" dir="ltr">{st.dayPnlPct > 0 ? '+' : ''}{st.dayPnlPct.toFixed(2)}%</span>
              </span>
              <span className="ss-chev" aria-hidden="true"><Chevron size={16} /></span>
            </span>
            {trades.length === 0 ? (
              <span className="sub sx-none">{s.stripNoTrades}</span>
            ) : (
              <span className="sx-trades">
                {trades.map((o) => (
                  <span key={o.id} className={`sx-trade ${o.side}`}>
                    {o.side === 'buy' ? s.stripBuy : s.stripSell} <bdi dir="ltr">{qty(o.filledQty)}</bdi> <bdi>{label(st, o.symbol)}</bdi> {s.stripAt} <bdi dir="ltr">{o.avgFillPrice ?? o.limitPrice}</bdi>
                  </span>
                ))}
              </span>
            )}
          </a>
        );
      })}
    </section>
  );
}
