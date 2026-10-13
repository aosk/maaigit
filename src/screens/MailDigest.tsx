import { useCallback, useEffect, useState } from 'react';
import type { MailCategory, MailDigest as Digest } from '../../shared/types';
import { api } from '../api';
import { dayTime } from '../format';
import { useSettings } from '../settings';
import { askAssistant } from '../nav';
import { Chat, Sun } from '../components/Icons';

const ORDER: MailCategory[] = ['decide', 'reply', 'fyi', 'ignore'];

/** The Gmail inbox, read and sorted by MAAI: what to decide, answer, know, or skip. */
export function MailDigest({ gmail }: { gmail: boolean }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [digest, setDigest] = useState<Digest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [showIgnored, setShowIgnored] = useState(false);

  const load = useCallback(
    (refresh: boolean) => {
      setBusy(true);
      setError('');
      api
        .mailDigest(lang, refresh)
        .then(setDigest)
        .catch((e: Error) => setError(e.message))
        .finally(() => setBusy(false));
    },
    [lang],
  );

  useEffect(() => {
    if (gmail) load(false);
  }, [gmail, load]);

  if (!gmail) return <div className="banner">{t.inboxNeedsGmail}</div>;

  // Each choice opens the assistant with the decision, so it can read the email and draft the reply.
  const decide = (uid: number, from: string, subject: string, choice: string) =>
    askAssistant(t.decidePrompt(uid, from, subject, choice));

  const groups = ORDER.map((cat) => ({
    cat,
    emails: (digest?.emails ?? []).filter((m) => (m.insight?.category ?? 'fyi') === cat),
  })).filter((g) => g.emails.length && (g.cat !== 'ignore' || showIgnored));
  const ignored = (digest?.emails ?? []).filter((m) => m.insight?.category === 'ignore').length;

  return (
    <>
      <section className="card" aria-label={t.inboxSummary}>
        <div className="between">
          <div className="card-label"><Sun size={20} />{t.inboxSummary}</div>
          <button className="btn ghost" onClick={() => load(true)} disabled={busy}>{busy ? t.reading : t.refresh}</button>
        </div>
        <p aria-live="polite">{busy && !digest ? t.readingInbox : digest?.summary || '…'}</p>
        {digest && <div className="sub">{t.lastChecked(dayTime(digest.fetchedAt, lang))} · {t.readOnlyNote}</div>}
      </section>

      {error && <div className="error" role="alert">{error}</div>}

      {groups.map(({ cat, emails }) => (
        <section key={cat} aria-label={t.mailGroups[cat]}>
          <h2 className="section-label">{t.mailGroups[cat]} · {emails.length}</h2>
          <div className="card flush">
            {emails.map((m) => {
              const ins = m.insight;
              const expanded = open === m.uid;
              return (
                <div key={m.uid} className="mail-item">
                  <button className="msg-item" onClick={() => setOpen(expanded ? null : m.uid)} aria-expanded={expanded}>
                    <span className="between" style={{ width: '100%' }}>
                      <span className="row" style={{ fontWeight: 600, minWidth: 0 }}>
                        {m.unread && <span className="dot" aria-label={t.unread} />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.fromName}</span>
                      </span>
                      <span className="row" style={{ flex: 'none' }}>
                        {ins?.priority === 'high' && <span className="badge-high">{t.highPriority}</span>}
                        <span className="sub">{dayTime(m.date, lang)}</span>
                      </span>
                    </span>
                    <span style={{ fontSize: '0.88em' }} dir="auto">{m.subject}</span>
                    <span className="sub" dir="auto">{ins?.gist ?? m.body.slice(0, 120)}</span>
                  </button>

                  {ins && cat !== 'ignore' && (
                    <div className="mail-actions">
                      <div className="sub" dir="auto"><strong>{t.maaiSuggests}</strong> {ins.suggestion}</div>
                      {ins.options.length > 0 && (
                        <div className="row wrap">
                          {ins.options.map((o, i) => (
                            <button key={o} className={`btn round ${i === 0 ? 'primary' : 'secondary'}`} onClick={() => decide(m.uid, m.fromName, m.subject, o)}>
                              {i === 0 ? `✓ ${o}` : o}
                            </button>
                          ))}
                        </div>
                      )}
                      {cat === 'reply' && (
                        <button className="btn secondary round" onClick={() => askAssistant(t.replyPrompt(m.uid, m.fromName, m.subject))}>
                          <Chat size={16} />{t.draftReplyWithMaai}
                        </button>
                      )}
                    </div>
                  )}

                  {expanded && <div className="mail-body" dir="auto">{m.body || t.noText}</div>}
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {ignored > 0 && !showIgnored && (
        <button className="btn ghost" onClick={() => setShowIgnored(true)}>{t.showIgnored(ignored)}</button>
      )}
    </>
  );
}
