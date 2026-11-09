import { useState } from 'react';
import type { CalendarEvent, TradingState } from '../../shared/trading';
import { api } from '../api';
import { useSettings } from '../settings';

const KIND_ICON: Record<CalendarEvent['kind'], string> = { earnings: '📊', rates: '🏦', inflation: '📈', jobs: '👷', other: '📌' };

/** "2026-11-12" as "الخميس 12 نوفمبر" (or "Thu 12 Nov"). */
function dayLabel(day: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

/** «الأحداث القادمة»: results, rate decisions and reports in the next two weeks, and what the risk gate does about them. */
export function Calendar({ st }: { st: TradingState }) {
  const { t, settings } = useSettings();
  const s = t.ss;
  const name = (symbol: string) => {
    const i = st.universe.find((u) => u.symbol === symbol);
    return i ? (settings.lang === 'ar' ? i.nameAr : i.nameEn) : symbol;
  };
  const events = st.calendar.slice(0, 8);
  return (
    <section className="card dk" aria-label={s.calTitle}>
      <div>
        <h2 className="h2" style={{ margin: 0 }}>{s.calTitle}</h2>
        <span className="sub">{s.calSub}</span>
      </div>
      {events.length === 0 ? (
        <p className="sub" style={{ margin: 0 }}>{s.calEmpty}</p>
      ) : (
        <ul className="dk-list">
          {events.map((e) => (
            <li key={e.id}>
              <span className="dk-icon" aria-hidden="true">{KIND_ICON[e.kind]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="dk-line" dir="auto">{e.title}</span>
                <span className="sub">
                  {dayLabel(e.date, settings.lang)}
                  {e.timeRiyadh ? ` · ${e.timeRiyadh}` : ''}
                  {e.symbols.length ? ` · ${e.symbols.map(name).join('، ')}` : ''} · {e.source}
                </span>
              </span>
              <span className={`dk-tag${e.confirmed ? ' on' : ''}`}>{e.confirmed ? s.calConfirmed : s.calEstimate}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="sub" style={{ margin: 0 }}>{s.calRule}</p>
    </section>
  );
}

/** «مراجعة الأسبوع»: the numbers, what worked and what did not, and suggested instructions to add with one tap. */
export function Review({ st, busy, act }: { st: TradingState; busy: boolean; act: (run: () => Promise<TradingState>) => Promise<boolean> }) {
  const { t } = useSettings();
  const s = t.ss;
  const r = st.review;
  const [added, setAdded] = useState<string[]>([]);
  const money = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)} ${st.currency}`;
  return (
    <section className="card dk" aria-label={s.revTitle}>
      <div className="between wrap" style={{ gap: 8 }}>
        <div>
          <h2 className="h2" style={{ margin: 0 }}>{s.revTitle}</h2>
          <span className="sub">{r ? s.revWeek(r.week) : s.revSub}</span>
        </div>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => act(api.tradingReview)}>{s.revNow}</button>
      </div>
      {r && (
        <>
          <div className="dk-stats">
            <div><b>{r.stats.orders}</b><span>{s.revOrders}</span></div>
            <div><b>{r.stats.wins}/{r.stats.closed}</b><span>{s.revWins}</span></div>
            <div><b className={r.stats.realized > 0 ? 'up' : r.stats.realized < 0 ? 'down' : ''} dir="ltr">{money(r.stats.realized)}</b><span>{s.revRealized}</span></div>
            <div><b>{r.stats.vetoed}</b><span>{s.revVetoed}</span></div>
          </div>
          {r.summary && <p style={{ margin: 0 }} dir="auto">{r.summary}</p>}
          {r.lessons.length > 0 && <ul className="dk-bullets">{r.lessons.map((l) => <li key={l} dir="auto">{l}</li>)}</ul>}
          {r.suggestions.length > 0 && (
            <div className="dk-suggest">
              <span className="section-label">{s.revSuggest}</span>
              {r.suggestions.map((x) => (
                <div key={x} className="between" style={{ gap: 8 }}>
                  <span dir="auto">{x}</span>
                  <button
                    type="button"
                    className="btn secondary"
                    disabled={busy || added.includes(x) || st.directives.some((d) => d.text === x)}
                    onClick={async () => {
                      if (await act(() => api.tradingDirective(x))) setAdded((a) => [...a, x]);
                    }}
                  >
                    {added.includes(x) || st.directives.some((d) => d.text === x) ? s.revAdded : s.revAdd}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The US list's quarterly Shariah check: each stock still held by SPUS, or not, and when it is next due. */
export function Shariah({ st, busy, act }: { st: TradingState; busy: boolean; act: (run: () => Promise<TradingState>) => Promise<boolean> }) {
  const { t, settings } = useSettings();
  const s = t.ss;
  const c = st.shariah;
  if (!c) return null;
  const date = (iso?: string) => (iso ? dayLabel(iso.slice(0, 10), settings.lang) : '—');
  return (
    <section className="card dk" aria-label={s.shTitle}>
      <div className="between wrap" style={{ gap: 8 }}>
        <div>
          <h2 className="h2" style={{ margin: 0 }}>{s.shTitle}</h2>
          <span className="sub">{c.checkedAt ? s.shWhen(date(c.checkedAt), date(c.nextDue)) : s.shNever}</span>
        </div>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => act(api.tradingShariahCheck)}>{s.shNow}</button>
      </div>
      {c.removed.length > 0 && <div className="error" role="alert">{s.shRemoved(c.removed.join('، '))}</div>}
      {c.results.length > 0 && (
        <div className="dk-chips">
          {c.results.map((r) => (
            <span key={r.symbol} className={`dk-chip ${r.held === true ? 'ok' : r.held === false ? 'bad' : ''}`} title={r.note}>
              {r.held === true ? '✓' : r.held === false ? '✗' : '?'} <bdi dir="ltr">{r.symbol}</bdi>
            </span>
          ))}
        </div>
      )}
      {c.error && <p className="sub" style={{ margin: 0 }}>{s.shError}</p>}
      <p className="sub" style={{ margin: 0 }}>{s.shNote}</p>
    </section>
  );
}
