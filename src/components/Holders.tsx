import type { HoldersView, Instrument } from '../../shared/trading';
import { useSettings } from '../settings';

const ARROW: Record<string, string> = { new: '▲', added: '▲', trimmed: '▼', exited: '▼' };

/** «كبار الملاك»: the latest changes among the substantial shareholders, and the big investors across the followed stocks. */
export function Holders({ view, universe }: { view: HoldersView; universe: Instrument[] }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const s = t.ss;
  const name = (symbol: string) => {
    const i = universe.find((u) => u.symbol === symbol);
    return i ? (lang === 'ar' ? i.nameAr : i.nameEn) : symbol;
  };
  const when = view.updatedAt ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(view.updatedAt)) : '';
  const shared = view.investors.filter((i) => i.stakes.length > 1 || i.stakes[0].pct >= 10).slice(0, 8);

  return (
    <section className="card hd" aria-label={s.holdersTitle}>
      <div>
        <h2 className="h2" style={{ margin: 0 }}>{s.holdersTitle}</h2>
        <span className="sub">{s.holdersSub}</span>
      </div>

      {!view.covered && !view.changes.length ? (
        <p className="sub" style={{ margin: 0 }}>{s.holdersEmpty}</p>
      ) : view.changes.length ? (
        <ul className="hd-changes">
          {view.changes.slice(0, 6).map((c) => (
            <li key={c.id} className={`hd-${c.kind}`}>
              <span className="hd-arrow" aria-hidden="true">{ARROW[c.kind]}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="hd-line">
                  <b dir="auto">{c.holder}</b> {s.holdersKind[c.kind]} · <bdi>{name(c.symbol)}</bdi>
                </span>
                <span className="sub">
                  {c.fromPct !== undefined && c.toPct !== undefined ? <bdi dir="ltr">{c.fromPct}% → {c.toPct}%</bdi> : c.toPct !== undefined ? <bdi dir="ltr">{c.toPct}%</bdi> : c.fromPct !== undefined ? <bdi dir="ltr">{c.fromPct}% →</bdi> : null}
                  {' · '}
                  <bdi dir="ltr">{c.date}</bdi> · {c.source} · {c.official ? <b className="hd-official">{s.holdersOfficial}</b> : s.holdersListing}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sub" style={{ margin: 0 }}>{s.holdersNone}</p>
      )}

      {shared.length > 0 && (
        <details className="hd-investors">
          <summary>{s.holdersInvestors}</summary>
          <ul>
            {shared.map((i) => (
              <li key={i.name}>
                <div className="between" style={{ gap: 8 }}>
                  <b dir="auto">{i.name}</b>
                  <span className="sub">{s.holdersStakes(i.stakes.length)}</span>
                </div>
                <div className="hd-stakes">
                  {i.stakes.map((st) => (
                    <span key={st.symbol} className="hd-stake">
                      <bdi>{name(st.symbol)}</bdi> <bdi dir="ltr">{st.pct}%</bdi>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="sub" style={{ margin: 0 }}>
        {s.holdersCoverage(view.covered, view.total, when)} · {s.holdersNote}
      </p>
    </section>
  );
}
