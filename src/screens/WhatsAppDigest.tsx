import { useCallback, useEffect, useState } from 'react';
import type { InboxMessage, MailCategory, WhatsAppDigest as Digest } from '../../shared/types';
import { api } from '../api';
import { dayTime } from '../format';
import { useSettings } from '../settings';
import { useOnRefresh } from '../refresh';
import { Chat, Sun } from '../components/Icons';

const ORDER: MailCategory[] = ['decide', 'reply', 'fyi', 'ignore'];

/** The WhatsApp Business number's messages, read and sorted by MAAI: what to decide, answer, know, or skip. */
export function WhatsAppDigest({ connected, onReply }: { connected: boolean; onReply: (message: InboxMessage) => void }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [digest, setDigest] = useState<Digest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);

  const load = useCallback(
    (refresh: boolean) => {
      setBusy(true);
      setError('');
      api
        .whatsappDigest(lang, refresh)
        .then(setDigest)
        .catch((e: Error) => setError(e.message))
        .finally(() => setBusy(false));
    },
    [lang],
  );

  useEffect(() => {
    if (connected) load(false);
  }, [connected, load]);
  useOnRefresh(() => connected && load(false));

  if (!connected) return <div className="banner">{t.whatsappNeeds}</div>;

  const groups = ORDER.map((cat) => ({ cat, threads: (digest?.threads ?? []).filter((x) => (x.insight?.category ?? 'fyi') === cat) })).filter((g) => g.threads.length && (g.cat !== 'ignore' || showIgnored));
  const ignored = (digest?.threads ?? []).filter((x) => x.insight?.category === 'ignore').length;

  return (
    <>
      <section className="card" aria-label={t.whatsappSummary}>
        <div className="between">
          <div className="card-label"><Sun size={20} />{t.whatsappSummary}</div>
          <button className="btn ghost" onClick={() => load(true)} disabled={busy}>{busy ? t.reading : t.refresh}</button>
        </div>
        <p aria-live="polite" dir="auto">{busy && !digest ? t.readingWhatsApp : digest?.summary || '…'}</p>
        {digest && <div className="sub">{t.lastChecked(dayTime(digest.fetchedAt, lang))} · {t.whatsappKept(digest.keepDays)}</div>}
        {digest && digest.threads.length === 0 && <div className="sub">{t.whatsappEmpty}</div>}
      </section>

      {error && <div className="error" role="alert">{error}</div>}

      {groups.map(({ cat, threads }) => (
        <section key={cat} aria-label={t.mailGroups[cat]}>
          <h2 className="section-label">{t.mailGroups[cat]} · {threads.length}</h2>
          <div className="card flush">
            {threads.map((thread) => {
              const ins = thread.insight;
              const last = thread.messages[thread.messages.length - 1];
              return (
                <div key={thread.key} className="mail-item">
                  <div className="msg-item" style={{ cursor: 'default' }}>
                    <span className="between" style={{ width: '100%' }}>
                      <span className="row" style={{ fontWeight: 600, minWidth: 0 }}>
                        {thread.unanswered > 0 && <span className="dot" role="img" aria-label={t.waiting(thread.unanswered)} />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{thread.name}</span>
                      </span>
                      <span className="row" style={{ flex: 'none' }}>
                        {ins?.priority === 'high' && <span className="badge-high">{t.highPriority}</span>}
                        <span className="sub">{dayTime(thread.lastAt, lang)}</span>
                      </span>
                    </span>
                    <span className="sub" dir="auto">{ins?.gist ?? last.text.slice(0, 120)}</span>
                  </div>
                  <div className="mail-actions">
                    {ins && cat !== 'ignore' && <div className="sub" dir="auto"><strong>{t.maaiSuggests}</strong> {ins.suggestion}</div>}
                    {cat !== 'ignore' && (
                      <button className="btn secondary round" onClick={() => onReply(last)}>
                        <Chat size={16} />{t.replyToThread}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {ignored > 0 && !showIgnored && <button className="btn ghost" onClick={() => setShowIgnored(true)}>{t.showIgnored(ignored)}</button>}
    </>
  );
}
