import { useCallback, useEffect, useState } from 'react';
import type { NewsDigest, NewsItem, NewsSection } from '../../shared/types';
import { api } from '../api';
import { ago, time } from '../format';
import { useSettings } from '../settings';
import { readNews, saveNews } from '../newsCache';
import { useOnRefresh } from '../refresh';
import { useAction } from '../useAction';

const SECTIONS: NewsSection[] = ['tech', 'saudi', 'models'];
const isSection = (v: string | null): v is NewsSection => SECTIONS.includes(v as NewsSection);
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
      {item.compare && <div className="compare" dir="auto"><strong>{t.newsCompare}: </strong>{item.compare}</div>}
    </a>
  );
}

/**
 * The News tab: the most important stories from trusted sources, in three sections. It opens with the last copy
 * at once; the server updates it on its own every few hours, and a pull of the screen (or the button) asks for
 * an update again while the old stories stay on screen to read.
 */
export function News() {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  // What was last received, with its language: after a language change the saved copy for the new one shows until the server answers.
  const [received, setReceived] = useState<{ lang: typeof lang; digest: NewsDigest } | null>(null);
  const digest = received?.lang === lang ? received.digest : readNews(lang);
  const [section, setSection] = useState<NewsSection>(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      return isSection(saved) ? saved : 'tech';
    } catch {
      return 'tech';
    }
  });
  const { busy, error, run, setError } = useAction();

  const show = useCallback((next: NewsDigest) => {
    setReceived({ lang, digest: next });
    saveNews(lang, next);
  }, [lang]);

  // The saved copy is already on screen; the server's current one replaces it quietly (a failure leaves the old stories).
  const load = useCallback(() => {
    api.news(lang).then(show).catch((e: Error) => { if (!readNews(lang)) setError(e.message); });
  }, [lang, show, setError]);
  useEffect(load, [load]);

  // Asks for an update. The stories already shown stay until the new ones arrive.
  const refresh = () =>
    run(async () => {
      show(await api.refreshNews(lang));
    });
  useOnRefresh(() => void refresh());

  const pick = (next: NewsSection) => {
    setSection(next);
    try {
      sessionStorage.setItem(KEY, next);
    } catch {
      // the section is simply not remembered
    }
  };

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
            {s === 'tech' ? t.newsTech : s === 'saudi' ? t.newsSaudi : t.newsModels}
          </button>
        ))}
      </div>

      {busy && digest && <div className="sub" role="status">{t.newsKeepsOld}</div>}
      {error && <div className="error" role="alert">{error}</div>}

      {digest && digest.brief.length > 0 && (
        <section className="card news-brief" aria-label={t.newsBrief}>
          <strong>{t.newsBrief}</strong>
          <ul>{digest.brief.map((line, i) => <li key={i}>{line}</li>)}</ul>
        </section>
      )}

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
