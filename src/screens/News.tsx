import { useCallback, useEffect, useState } from 'react';
import type { NewsDigest, NewsItem, NewsSection } from '../../shared/types';
import { api } from '../api';
import { ago, time } from '../format';
import { useSettings } from '../settings';
import { useOnRefresh } from '../refresh';
import { useAction } from '../useAction';

const SECTIONS: NewsSection[] = ['tech', 'saudi'];
const KEY = 'maai.newsSection';

function Story({ item, top }: { item: NewsItem; top: boolean }) {
  const { t, settings } = useSettings();
  return (
    <a className={`story${top ? ' top' : ''}`} href={item.url} target="_blank" rel="noreferrer noopener">
      <div className="story-title" dir="auto">{item.title}</div>
      {item.summary && <div className="summary" dir="auto">{item.summary}</div>}
      <div className="meta">
        {top && <span className="badge">{t.newsTop}</span>}
        <span className="src">{item.source}</span>
        <span>{ago(item.publishedAt, settings.lang)}</span>
        {item.alsoBy.length > 0 && <span>{t.newsAlsoBy(item.alsoBy)}</span>}
      </div>
    </a>
  );
}

/** The News tab: the most important stories from trusted sources, in two sections, refreshed every few hours. */
export function News() {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [digest, setDigest] = useState<NewsDigest | null>(null);
  const [section, setSection] = useState<NewsSection>(() => {
    try {
      return sessionStorage.getItem(KEY) === 'saudi' ? 'saudi' : 'tech';
    } catch {
      return 'tech';
    }
  });
  const { busy, error, run, setError } = useAction();

  const load = useCallback(() => {
    api.news(lang).then(setDigest).catch((e: Error) => setError(e.message));
  }, [lang, setError]);
  useEffect(load, [load]);
  useOnRefresh(load);

  const pick = (next: NewsSection) => {
    setSection(next);
    try {
      sessionStorage.setItem(KEY, next);
    } catch {
      // the section is simply not remembered
    }
  };

  const refresh = () =>
    run(async () => {
      setDigest(await api.refreshNews(lang));
    });

  const items = digest?.sections[section] ?? [];
  const sources = (digest?.sources ?? []).filter((s) => s.section === section);

  return (
    <div className="screen cols">
      <div className="between wrap">
        <h1 className="title">{t.news}</h1>
        <button className="btn secondary round" onClick={refresh} disabled={busy}>{busy ? t.newsRefreshing : t.newsRefresh}</button>
      </div>

      <div className="news-tabs" role="tablist" aria-label={t.news}>
        {SECTIONS.map((s) => (
          <button key={s} role="tab" id={`news-tab-${s}`} aria-selected={section === s} aria-controls="news-panel" className={`news-tab ${s}`} onClick={() => pick(s)}>
            {s === 'tech' ? t.newsTech : t.newsSaudi}
          </button>
        ))}
      </div>

      {error && <div className="error" role="alert">{error}</div>}

      <section id="news-panel" role="tabpanel" aria-labelledby={`news-tab-${section}`} className={`news-section ${section}`}>
        {!digest && !error && <div className="skeleton" aria-label={t.newsLoading}><span /><span /><span /></div>}
        {digest && items.length === 0 && <div className="banner">{t.newsEmpty}</div>}
        {items.length > 0 && (
          <div className="card flush">
            {items.map((item, i) => (
              <Story key={item.id} item={item} top={i === 0} />
            ))}
          </div>
        )}
      </section>

      {digest && (
        <>
          {digest.fetchedAt && <div className="updated-at">{t.newsUpdated(time(digest.fetchedAt, lang), digest.everyHours)}</div>}
          {digest.source === 'ranked' && items.length > 0 && <p className="sub">{t.newsRankedNote}</p>}
          <details className="card news-sources">
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              {t.newsSources} · {t.newsSourcesHint(sources.filter((s) => s.ok).length, sources.length)}
            </summary>
            <p className="sub" style={{ margin: '8px 0' }}>{t.newsSourcesNote}</p>
            <ul>
              {sources.map((s) => (
                <li key={s.name}>
                  <span aria-hidden="true">{s.ok ? '✓' : '✗'}</span>
                  <span>
                    {s.name}
                    <span className="sub"> · {s.ok ? s.items : s.error ?? ''}</span>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
