import { Fragment, useState } from 'react';
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

/** «أساسيات الشركات»: each company's valuation, growth against a year earlier and dividend yield, with one line on its state. */
export function FundamentalsCard({ st }: { st: TradingState }) {
  const { t, settings } = useSettings();
  const s = t.ss;
  const f = st.fundamentals;
  if (!f) return null;
  const name = (symbol: string) => {
    const i = st.universe.find((u) => u.symbol === symbol);
    return i && st.market === 'sa' ? (settings.lang === 'ar' ? i.nameAr : i.nameEn) : symbol;
  };
  const growth = (n: number | undefined) => (n === undefined ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(0)}%`);
  const tone = (n: number | undefined) => (n === undefined || n === 0 ? '' : n > 0 ? 'up' : 'down');
  return (
    <section className="card dk" aria-label={s.fdTitle}>
      <div>
        <h2 className="h2" style={{ margin: 0 }}>{s.fdTitle}</h2>
        <span className="sub">{s.fdSub(f.covered, f.total)}</span>
      </div>
      {f.companies.length === 0 ? (
        <p className="sub" style={{ margin: 0 }}>{s.fdEmpty}</p>
      ) : (
        <div className="fd-wrap" role="region" aria-label={s.fdTitle} tabIndex={0}>
          <table className="fd-table">
            <thead>
              <tr><th>{s.fdCompany}</th><th>{s.fdPe}</th><th>{s.fdEps}</th><th>{s.fdRev}</th><th>{s.fdYield}</th></tr>
            </thead>
            <tbody>
              {f.companies.map((c) => (
                <Fragment key={c.symbol}>
                  <tr className={c.note ? 'fd-has-note' : ''}>
                    <td><b><bdi>{name(c.symbol)}</bdi></b></td>
                    <td dir="ltr">{c.pe === undefined ? '—' : c.pe.toFixed(1)}</td>
                    <td dir="ltr" className={tone(c.epsGrowthPct)}>{growth(c.epsGrowthPct)}</td>
                    <td dir="ltr" className={tone(c.revenueGrowthPct)}>{growth(c.revenueGrowthPct)}</td>
                    <td dir="ltr">{c.dividendYieldPct === undefined ? '—' : `${c.dividendYieldPct.toFixed(1)}%`}</td>
                  </tr>
                  {c.note && (
                    <tr className="fd-note-row">
                      <td colSpan={5} dir="auto">{c.note}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="sub" style={{ margin: 0 }}>{s.fdNote}</p>
    </section>
  );
}

/** «تقييم القرارات»: each filled trade set against the market index once its holding window has passed, and the lesson drawn. */
export function Scorecard({ st }: { st: TradingState }) {
  const { t, settings } = useSettings();
  const s = t.ss;
  const c = st.scorecard;
  if (!c || (c.settled === 0 && c.pending === 0)) return null;
  const name = (symbol: string) => {
    const i = st.universe.find((u) => u.symbol === symbol);
    return i && st.market === 'sa' ? (settings.lang === 'ar' ? i.nameAr : i.nameEn) : symbol;
  };
  // Rounded first, so a tiny move reads 0.0%, not −0.0%.
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const pct = (n: number) => `${r1(n) > 0 ? '+' : r1(n) < 0 ? '−' : ''}${Math.abs(r1(n)).toFixed(1)}%`;
  const tone = (n: number | undefined) => (r1(n ?? 0) > 0 ? 'up' : r1(n ?? 0) < 0 ? 'down' : '');
  const MARK = { right: '✓', wrong: '✗', even: '=' } as const;
  return (
    <section className="card dk" aria-label={s.scTitle}>
      <div>
        <h2 className="h2" style={{ margin: 0 }}>{s.scTitle}</h2>
        <span className="sub">{s.scSub(c.holdDays, st.indexName[settings.lang === 'ar' ? 'ar' : 'en'])}</span>
      </div>
      <div className="dk-stats">
        <div><b>{c.right}/{c.settled}</b><span>{s.scRight}</span></div>
        <div><b className={tone(c.avgAlpha)} dir="ltr">{c.settled ? pct(c.avgAlpha) : '—'}</b><span>{s.scAlpha}</span></div>
        <div><b>{c.wrong}</b><span>{s.scWrong}</span></div>
        <div><b>{c.pending}</b><span>{s.scPending}</span></div>
      </div>
      {c.recent.length === 0 ? (
        <p className="sub" style={{ margin: 0 }}>{s.scWaiting(c.holdDays)}</p>
      ) : (
        <ul className="dk-list">
          {c.recent.map((d) => (
            <li key={d.orderId}>
              <span className={`dk-icon sc-${d.verdict}`} aria-label={d.verdict ? s.scVerdict[d.verdict] : ''}>{d.verdict ? MARK[d.verdict] : ''}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="dk-line">
                  {d.side === 'buy' ? s.scBuy : s.scSell} <bdi>{name(d.symbol)}</bdi>
                </span>
                <span className="sub">
                  {s.scStock} <bdi dir="ltr">{pct(d.ret ?? 0)}</bdi> · {s.scIndex} <bdi dir="ltr">{pct(d.indexRet ?? 0)}</bdi>
                </span>
                {d.lesson && <span className="sc-lesson" dir="auto">{d.lesson}</span>}
              </span>
              <b className={`sc-alpha ${d.verdict === 'even' ? '' : tone(d.alpha)}`} dir="ltr">{pct(d.alpha ?? 0)}</b>
            </li>
          ))}
        </ul>
      )}
      <p className="sub" style={{ margin: 0 }}>{s.scNote}</p>
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
