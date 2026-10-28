import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { FeedItem, InboxFeed, InboxMessage, Lang, StatusInfo, Tone } from '../../shared/types';
import { api } from '../api';
import { cachedFeed, keepFeed } from '../inboxCache';
import { isUnread, markSeen } from '../inboxSeen';
import { ago, dayHeading, dayTime, sameDay, time } from '../format';
import { askAssistant } from '../nav';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { useOnRefresh } from '../refresh';
import { Back, Bell, Chat, Check, Chevron, Mail, Refresh, Search, Send, Trash } from '../components/Icons';
import { CountBadge } from '../components/CountBadge';
import { mailtoLink } from '../components/EmailCard';

const TONES: Tone[] = ['short', 'friendly', 'formal', 'arabic'];

function Reply({ message, gmail, whatsapp, device, onBack, onChanged }: { message: InboxMessage; gmail: boolean; whatsapp: boolean; device: boolean; onBack: () => void; onChanged: () => void }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [tone, setTone] = useState<Tone>(lang === 'ar' ? 'arabic' : 'friendly');
  const [draft, setDraft] = useState('');
  const [summary, setSummary] = useState('');
  const [copied, setCopied] = useState(false);
  const drafting = useAction();
  const emailing = useAction();
  const texting = useAction();
  const [textSent, setTextSent] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const busy = drafting.busy;
  const error = drafting.error || emailing.error || texting.error;
  // WhatsApp only lets MAAI answer within 24 hours of their last message; the server checks it too.
  const byDevice = device && message.via === 'bot' && message.channel === 'whatsapp' && !message.group && Boolean(message.phone);
  const canSend = byDevice || (whatsapp && message.via === 'twilio' && Date.now() - Date.parse(message.receivedAt) < 24 * 3_600_000);
  const sendIt = () =>
    texting.run(async () => {
      await api.sendWhatsApp(message.id, draft);
      setTextSent(true);
      onChanged();
    });

  const makeDraft = (chosen: Tone) =>
    drafting.run(async () => {
      const res = await api.draft(message.id, chosen, lang);
      setDraft(res.draft);
      setSummary(res.summary);
    });

  // Draft once on open; picking a tone redrafts explicitly.
  useEffect(() => {
    void makeDraft(tone);
  }, [message.id]);

  function pickTone(next: Tone) {
    setTone(next);
    void makeDraft(next);
  }

  const waLink = `https://wa.me/${message.phone ?? ''}?text=${encodeURIComponent(draft)}`;
  const replySubject = `Re: ${message.text.slice(0, 60)}`;
  const emailIt = () =>
    emailing.run(async () => {
      if (!message.email) return;
      await api.emailReply(message.id, { to: message.email, subject: replySubject, body: draft });
      setEmailSent(true);
      onChanged();
    });

  async function sent() {
    try {
      await api.replied(message.id);
      onChanged();
    } catch {
      // Marking it as answered is a convenience: the message itself was handled elsewhere.
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      drafting.setError(t.errorGeneric);
    }
  }

  return (
    <div className="screen">
      <div className="between">
        <button className="btn ghost" onClick={onBack} style={{ paddingInline: 0 }}>
          <span style={{ display: 'inline-flex', transform: lang === 'ar' ? 'scaleX(-1)' : undefined }}><Back size={20} /></span>{t.inboxTitle}
        </button>
        <h1 style={{ fontWeight: 600, fontSize: 'inherit', margin: 0 }}>{t.replyTo(message.from)}</h1>
        <div style={{ width: 60 }} />
      </div>

      <section className="card">
        <div className="eyebrow row"><Chat size={16} />{t.sharedFrom(message.channel === 'whatsapp' ? 'WhatsApp' : message.channel, time(message.receivedAt, lang))}</div>
        <div className="quote">“{message.text}”</div>
        {summary && <div className="sub" style={{ fontSize: '0.88em' }}>{summary}</div>}
      </section>

      <div className="field">
        <label htmlFor="draft">{t.draftReply}</label>
        <textarea id="draft" value={busy ? t.drafting : draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} dir="auto" />
      </div>

      <div role="radiogroup" aria-label={t.tone} className="row wrap">
        {TONES.map((x) => (
          <button
            key={x}
            role="radio"
            aria-checked={tone === x}
            className={`btn round ${tone === x ? 'primary' : ''}`}
            style={tone === x ? undefined : { background: 'var(--surface)', border: '1px solid var(--border)' }}
            onClick={() => pickTone(x)}
            disabled={busy}
          >
            {t.tones[x]}
          </button>
        ))}
      </div>

      {error && <div className="error" role="alert">{error}</div>}

      {message.email && (
        <section className="card" aria-label={t.sendByEmail}>
          {gmail ? (
            <button className="btn primary big" onClick={emailIt} disabled={busy || !draft || emailing.busy || emailSent}>
              <Send size={20} />{emailing.busy ? t.sending : emailSent ? `✓ ${t.replied}` : `${t.sendByEmail} · ${message.email}`}
            </button>
          ) : (
            <a className="btn primary big" href={mailtoLink(message.email, replySubject, draft)} style={{ textDecoration: 'none' }}>
              {t.openMailApp}
            </a>
          )}
          <div className="sub" style={{ textAlign: 'center' }}>{gmail ? t.emailFromGmail : t.gmailNotConnected}</div>
        </section>
      )}

      <section className="card">
        {(message.via === 'twilio' || byDevice) && (
          canSend ? (
            <button className="btn primary big" onClick={sendIt} disabled={busy || !draft || texting.busy || textSent}>
              <Send size={20} />{texting.busy ? t.sending : textSent ? (byDevice ? t.queuedOnDevice : t.sentOnWhatsApp) : byDevice ? t.sendFromMyNumber : t.sendOnWhatsApp}
            </button>
          ) : (
            <div className="sub" role="note">{t.whatsappWindowClosed}</div>
          )
        )}
        <a className={`btn ${canSend ? 'secondary' : 'primary'} big`} href={waLink} target="_blank" rel="noreferrer" onClick={(e) => (busy || !draft ? e.preventDefault() : void sent())} aria-disabled={busy || !draft} style={{ textDecoration: 'none' }}>
          <Send size={20} />{t.openWhatsApp}
        </a>
        <div className="row">
          <button className="btn secondary grow" onClick={copy} disabled={busy || !draft}>{copied ? t.copied : t.copy}</button>
          <button className="btn secondary grow" onClick={sent} disabled={message.replied}>{message.replied ? t.replied : t.markReplied}</button>
        </div>
        <div className="sub" style={{ textAlign: 'center' }}>{t.whatsappNote}</div>
      </section>
    </div>
  );
}

/** How often the open Inbox looks again: the device bot delivers about once an hour. */
const RELOAD_MS = 10 * 60_000;
/** The attention card names at most this many messages. */
const ATTENTION_MAX = 3;

type StatusFilter = 'all' | 'reply' | 'unread';
type SourceFilter = 'all' | 'email' | 'whatsapp';

/** Needs a reply first, then what the sender called urgent, then what maai rates important, then the newest. */
function attentionOrder(a: FeedItem, b: FeedItem): number {
  const score = (i: FeedItem) => (i.needsReply === 'yes' ? 4 : 0) + (i.urgentSaid ? 2 : 0) + (i.priority === 'high' ? 1 : 0);
  return score(b) - score(a) || b.at.localeCompare(a.at);
}

/** One or two letters for the round picture: the first letters of the first two words. */
function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '؟';
  return (words.length > 1 && /\p{Script=Latin}/u.test(words[0]) ? words[0][0] + words[1][0] : words[0][0]).toUpperCase();
}

const dayKey = (iso: string) => new Date(iso).toDateString();

/** «اليوم», «أمس», then the date. */
function dayLabel(iso: string, now: Date, t: ReturnType<typeof useSettings>['t'], lang: Lang): string {
  if (sameDay(iso, now)) return t.dayToday;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(iso, yesterday)) return t.dayYesterday;
  return dayHeading(iso, lang);
}

/** Where to open it outside maai: the WhatsApp chat, or Gmail searched for that email. */
function sourceLink(item: FeedItem): { href: string; label: 'openInGmail' | 'openInWhatsApp' } | null {
  if (item.channel === 'whatsapp' && item.message?.phone && !item.message.group) return { href: `https://wa.me/${item.message.phone}`, label: 'openInWhatsApp' };
  if (item.source === 'gmail' && item.address) {
    const query = `from:${item.address}${item.subject ? ` subject:"${item.subject.replace(/"/g, '')}"` : ''}`;
    return { href: `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`, label: 'openInGmail' };
  }
  return null;
}

/** Every message in one list: what needs attention on top, then search, filters, and the messages by day; a message opens beside the list on a computer. */
export function Inbox() {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [status, setStatus] = useState<StatusInfo | null>(null);
  // The last Inbox shows at once; the fresh one replaces it when it arrives.
  const [feed, setFeed] = useState<InboxFeed | null>(() => cachedFeed(lang));
  const feedRef = useRef(feed);
  useEffect(() => {
    feedRef.current = feed;
  }, [feed]);
  // Only the newest request may change the screen (a slow older one must not overwrite a newer answer).
  const latest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // When Gmail could not be read, its last emails stay on screen, from this time.
  const [emailAsOf, setEmailAsOf] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [replying, setReplying] = useState<InboxMessage | null>(null);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  // Opened from a tile on «يومك» (email or WhatsApp): start on that source.
  const [source, setSource] = useState<SourceFilter>(() => {
    try {
      const view = sessionStorage.getItem('maai.inboxView');
      sessionStorage.removeItem('maai.inboxView');
      return view === 'email' || view === 'whatsapp' ? view : 'all';
    } catch {
      return 'all';
    }
  });
  const [showSummary, setShowSummary] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Read and unread live on this device; this makes the list show a change at once.
  const [, setReadTick] = useState(0);

  // `background` marks the automatic refreshes: they must not count as the user being here (else the Face ID
  // lock would never close the app while the Inbox is open).
  const load = useCallback(
    (refresh: boolean, background = false) => {
      const mine = ++latest.current;
      setBusy(true);
      api
        .inboxFeed(lang, refresh, background)
        .then((fresh) => {
          if (mine !== latest.current) return;
          const prev = feedRef.current;
          const keptMail = fresh.sources.email === 'failed' && prev ? prev.items.filter((i) => i.source === 'gmail') : [];
          const shown = keptMail.length ? { ...fresh, items: [...fresh.items, ...keptMail].sort((a, b) => b.at.localeCompare(a.at)) } : fresh;
          setEmailAsOf((asOf) => (keptMail.length ? (asOf ?? prev!.fetchedAt) : null));
          setFeed(shown);
          setFailed(false);
          if (!keptMail.length) keepFeed(lang, fresh);
        })
        .catch(() => mine === latest.current && setFailed(true))
        .finally(() => {
          if (mine !== latest.current) return;
          setBusy(false);
          setNow(Date.now());
        });
    },
    [lang],
  );
  useEffect(() => {
    load(false);
    const timer = setInterval(() => document.hidden || load(false, true), RELOAD_MS);
    const clock = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [load]);
  useOnRefresh(() => load(false));
  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
  }, []);

  const gmail = Boolean(status?.mail?.configured);
  const whatsapp = Boolean(status?.whatsapp?.configured);
  if (replying) return <Reply message={replying} gmail={gmail} whatsapp={whatsapp} device={Boolean(feed?.bot.connected)} onBack={() => setReplying(null)} onChanged={() => load(false)} />;
  if (adding) return <Messages onBack={() => { setAdding(false); load(false); }} gmail={gmail} whatsapp={whatsapp} device={Boolean(feed?.bot.connected)} />;

  const items = feed?.items ?? [];
  const has = { email: items.some((i) => i.channel === 'email') || feed?.sources.email === 'ok', whatsapp: items.some((i) => i.channel === 'whatsapp') || feed?.sources.whatsapp === 'ok' };
  const nothingConnected = feed !== null && feed.sources.email === 'off' && feed.sources.whatsapp === 'off' && items.length === 0;
  const q = query.trim().toLowerCase();
  // The source choice only counts when there is more than one source to choose from.
  const activeSource = has.email && has.whatsapp ? source : 'all';
  const filtering = q !== '' || filter !== 'all' || activeSource !== 'all';
  const shown = items.filter(
    (i) =>
      (activeSource === 'all' || i.channel === activeSource) &&
      (filter === 'all' || (filter === 'reply' ? i.needsReply !== 'no' : isUnread(i))) &&
      (!q || [i.from, i.subject, i.text, i.body].some((x) => x?.toLowerCase().includes(q))),
  );
  const attention = items.filter((i) => i.needsReply !== 'no').sort(attentionOrder);
  const opened = items.find((i) => i.key === openKey) ?? null;

  function open(item: FeedItem) {
    setOpenKey(item.key);
    markSeen(item, true);
    setReadTick((x) => x + 1);
    if (document.documentElement.dataset.layout !== 'desktop') window.scrollTo(0, 0);
  }

  function setRead(item: FeedItem, read: boolean) {
    markSeen(item, read);
    setReadTick((x) => x + 1);
  }

  async function label(item: FeedItem, needsReply: 'yes' | 'no' | null) {
    await api.labelFeedItem(item.key, needsReply);
    load(false);
  }

  const groups: { key: string; label: string; items: FeedItem[] }[] = [];
  for (const item of shown) {
    const key = dayKey(item.at);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.items.push(item);
    else groups.push({ key, label: dayLabel(item.at, new Date(now), t, lang), items: [item] });
  }

  const sourcesIn = [has.email && t.sources.email, has.whatsapp && t.sources.whatsapp].filter(Boolean).join(lang === 'ar' ? ' و' : ' and ');

  return (
    <div className={`screen inbox${opened ? ' has-detail' : ''}`}>
      <div className="inbox-list">
        <div className="inbox-head">
          <div>
            <h1 className="title">{t.inboxTitle}</h1>
            <div className="sub" aria-live="polite">{busy ? t.refreshingMessages : feed ? t.updatedAgo(ago(feed.fetchedAt, lang, now)) : ''}</div>
          </div>
          <button className="icon-btn refresh-btn" onClick={() => load(true)} disabled={busy} aria-label={t.refreshMessages} aria-busy={busy}>
            <span className={busy ? 'spinning' : undefined} style={{ display: 'inline-flex' }}><Refresh size={22} /></span>
          </button>
        </div>

        {failed && feed && <div className="banner" role="status">{t.refreshFailed(dayTime(feed.fetchedAt, lang))}</div>}
        {failed && !feed && (
          <div className="error row between" role="alert">
            <span>{t.loadFailed}</span>
            <button className="btn secondary" onClick={() => load(true)}>{t.tryAgain}</button>
          </div>
        )}
        {emailAsOf && <div className="banner" role="status">{t.sourceFailed(t.sources.email, dayTime(emailAsOf, lang))}</div>}
        {feed?.sources.whatsapp === 'stale' && <div className="banner" role="status">{t.whatsappStale}</div>}
        {feed?.bot.link && <div className="banner" role="status">{t.whatsappNeedsLink}</div>}

        {nothingConnected ? (
          <section className="card inbox-empty">
            <p>{t.notConnected}</p>
            <a className="btn primary" href="#/settings" style={{ alignSelf: 'flex-start', textDecoration: 'none' }}>{t.openConnections}</a>
          </section>
        ) : (
          <>
            <div className="search">
              <Search size={20} />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchMessages} aria-label={t.searchMessages} dir="auto" />
            </div>
            <div className="inbox-filters">
              <div className="seg" role="radiogroup" aria-label={t.filterLabel}>
                {(['all', 'reply', 'unread'] as const).map((f) => (
                  <button key={f} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>{t.filters[f]}</button>
                ))}
              </div>
              {has.email && has.whatsapp && (
                <select className="source-select" value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} aria-label={t.sourceLabel}>
                  {(['all', 'email', 'whatsapp'] as const).map((s) => <option key={s} value={s}>{t.sources[s]}</option>)}
                </select>
              )}
            </div>
            {filtering && feed && (
              <div className="sub" role="status">
                {t.resultsCount(shown.length)}
                {q && <> · {t.searchScope(feed.window.emailDays, feed.window.whatsappDays)}</>}
              </div>
            )}

            {feed && !filtering && (
              <details className="attention" open>
                <summary>
                  <span className="row" style={{ gap: 8 }}><Bell size={20} />{t.needsAttention}</span>
                  {attention.length > 0 && <CountBadge kind="chat" n={attention.length} />}
                </summary>
                {attention.length > 0 ? (
                  <ul className="attention-list">
                    {attention.slice(0, ATTENTION_MAX).map((i) => (
                      <li key={i.key}>
                        <button type="button" onClick={() => open(i)}>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <strong><bdi>{i.from}</bdi>:</strong> <bdi>{i.text}</bdi>
                            <span className="attention-tags">
                              {i.needsReply === 'maybe' && <span className="tag maybe">{t.maybeReplyTag}</span>}
                              {i.urgentSaid && <span className="tag urgent">{t.saidUrgent}</span>}
                              {i.priority === 'high' && <span className="tag">{t.maaiPriority}</span>}
                            </span>
                          </span>
                          <Chevron size={18} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="sub">{feed.analysis === 'failed' ? t.attentionFailed : feed.analysis === 'off' ? t.attentionOff : failed ? t.attentionFailed : t.attentionNone}</p>
                )}
                {attention.length > 0 && feed.analysis === 'failed' && <p className="sub">{t.attentionFailed}</p>}
                <button type="button" className="link-btn" onClick={() => setShowSummary((v) => !v)} aria-expanded={showSummary}>{showSummary ? t.hideSummary : t.fullSummary}</button>
                {showSummary && (
                  <div className="full-summary">
                    <p dir="auto">{feed.summary}</p>
                    {sourcesIn && <p className="sub">{t.summaryCovers(sourcesIn, feed.window.emailDays, feed.window.whatsappDays)}</p>}
                    {attention.length > ATTENTION_MAX && (
                      <ul className="attention-list">
                        {attention.slice(ATTENTION_MAX).map((i) => (
                          <li key={i.key}><button type="button" onClick={() => open(i)}><span style={{ flex: 1, minWidth: 0 }}><strong><bdi>{i.from}</bdi>:</strong> <bdi>{i.text}</bdi></span><Chevron size={18} /></button></li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </details>
            )}

            {!feed && busy && <div className="skeleton" aria-label={t.loading}><span /><span /><span /></div>}
            {feed && items.length === 0 && <p className="sub inbox-none">{t.emptyConnected}</p>}
            {feed && items.length > 0 && shown.length === 0 && (
              <div className="inbox-none">
                <p className="sub">{t.noResults}</p>
                <button className="btn secondary" onClick={() => { setQuery(''); setFilter('all'); setSource('all'); }}>{t.clearFilters}</button>
              </div>
            )}

            {groups.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h2 className="day-head">{g.label}</h2>
                <ul className="inbox-rows">
                  {g.items.map((item) => (
                    <li key={item.key}>
                      <FeedRow item={item} selected={item.key === openKey} onOpen={() => open(item)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <button className="btn ghost" onClick={() => setAdding(true)} style={{ alignSelf: 'center' }}>{t.addByHand}</button>
          </>
        )}
      </div>

      <div className="inbox-detail">
        {opened ? (
          <Detail
            key={opened.key}
            item={opened}
            unread={isUnread(opened)}
            onBack={() => setOpenKey(null)}
            onReply={setReplying}
            onRead={(read) => setRead(opened, read)}
            onLabel={(v) => label(opened, v)}
          />
        ) : (
          <p className="sub inbox-pick">{t.pickMessage}</p>
        )}
      </div>
    </div>
  );
}

/** One email or conversation in the list: who, when, what about, the start of it, and where it came from. */
function FeedRow({ item, selected, onOpen }: { item: FeedItem; selected: boolean; onOpen: () => void }) {
  const { t, settings } = useSettings();
  const email = item.channel === 'email';
  const unread = isUnread(item);
  return (
    <button type="button" className={`inbox-row${unread ? ' unread' : ''}`} onClick={onOpen} aria-current={selected || undefined}>
      <span className="avatar" aria-hidden="true">{initials(item.from)}</span>
      <span className="inbox-row-main">
        <span className="inbox-row-top">
          <span className="inbox-from" dir="auto">{item.from}</span>
          {item.needsReply !== 'no' && <span className={`tag${item.needsReply === 'maybe' ? ' maybe' : ' reply'}`}>{item.needsReply === 'maybe' ? t.maybeReplyTag : t.needsReplyTag}</span>}
          <span className="inbox-time">{time(item.at, settings.lang)}</span>
        </span>
        {item.subject && <span className="inbox-subject" dir="auto">{item.subject}</span>}
        <span className="inbox-preview" dir="auto">{item.text}</span>
        <span className="inbox-source">
          {email ? <Mail size={16} /> : <Chat size={16} />}
          {email ? t.tagEmail : t.tagWhatsApp}{item.message?.group ? ` · ${t.tagGroup}` : ''}{item.source === 'bot' ? ` · ${t.viaDevice}` : ''}
          {unread && <span className="dot" role="img" aria-label={t.filters.unread} />}
        </span>
      </span>
    </button>
  );
}

/** One message opened: all of it, maai's read, and what can be done with it. */
function Detail({ item, unread, onBack, onReply, onRead, onLabel }: { item: FeedItem; unread: boolean; onBack: () => void; onReply: (m: InboxMessage) => void; onRead: (read: boolean) => void; onLabel: (v: 'yes' | 'no' | null) => Promise<void> }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const { busy, error, run } = useAction();
  const link = sourceLink(item);
  const email = item.channel === 'email';
  const what = item.subject || item.text;
  const decide = (choice: string) =>
    askAssistant(item.uid !== undefined ? t.decidePrompt(item.uid, item.from, item.subject ?? '', choice) : t.msgDecidePrompt(item.from, choice));
  const reply = item.message
    ? () => onReply(item.message!)
    : item.uid !== undefined
      ? () => askAssistant(t.replyPrompt(item.uid!, item.from, item.subject ?? ''))
      : null;

  return (
    <article className="detail" aria-label={item.from}>
      <button className="btn ghost detail-back" onClick={onBack} style={{ paddingInline: 0, alignSelf: 'flex-start' }}>
        <span style={{ display: 'inline-flex', transform: lang === 'ar' ? 'scaleX(-1)' : undefined }}><Back size={20} /></span>{t.inboxTitle}
      </button>
      <header className="detail-head">
        <span className="avatar" aria-hidden="true">{initials(item.from)}</span>
        <div style={{ minWidth: 0 }}>
          <h2 className="h2" dir="auto">{item.from}</h2>
          <div className="sub">
            {email ? t.tagEmail : t.tagWhatsApp}{item.address ? <> · <span dir="ltr">{item.address}</span></> : null} · {t.receivedOn(`${dayHeading(item.at, lang)} ${time(item.at, lang)}`)}
          </div>
        </div>
      </header>
      {item.subject && <h3 className="detail-subject" dir="auto">{item.subject}</h3>}
      <div className="row wrap" style={{ gap: 6 }}>
        {item.needsReply !== 'no' && <span className={`tag${item.needsReply === 'maybe' ? ' maybe' : ' reply'}`}>{item.needsReply === 'maybe' ? t.maybeReplyTag : t.needsReplyTag}{item.labelled ? ` · ${t.classifiedByYou}` : ''}</span>}
        {item.urgentSaid && <span className="tag urgent">{t.saidUrgent}</span>}
        {item.priority === 'high' && <span className="tag">{t.maaiPriority}</span>}
      </div>

      <div className="mail-body detail-body" dir="auto">{item.body || t.noText}</div>

      {(item.intake || item.suggestion) && (
        <div className="card soft">
          {item.intake && <div className="sub" dir="auto"><strong>{t.maaiFoundOut}</strong> {item.intake}</div>}
          {item.suggestion && <div className="sub" dir="auto"><strong>{t.maaiSuggests}</strong> {item.suggestion}</div>}
          {item.options && (
            <div className="row wrap">
              {item.options.map((o, i) => (
                <button key={o} className={`btn ${i === 0 ? 'primary' : 'secondary'}`} onClick={() => decide(o)}>{i === 0 ? `✓ ${o}` : o}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="detail-actions">
        {reply && <button className="btn primary" onClick={reply}><Chat size={18} />{t.prepareReply}</button>}
        {link && <a className="btn secondary" href={link.href} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>{t[link.label]}</a>}
        <button className="btn secondary" onClick={() => askAssistant(t.taskFromMessage(item.from, what))}><Check size={18} />{t.addTask}</button>
        <button className="btn secondary" onClick={() => askAssistant(t.reminderFromMessage(item.from, what))}><Bell size={18} />{t.addReminder}</button>
      </div>

      <div className="detail-meta">
        <div className="between wrap">
          <span className="sub">{t.classifyLabel}</span>
          <div className="seg mini-seg" role="radiogroup" aria-label={t.classifyLabel}>
            <button role="radio" aria-checked={item.needsReply === 'yes'} disabled={busy} onClick={() => void run(() => onLabel('yes'))}>{t.classifyYes}</button>
            <button role="radio" aria-checked={item.needsReply === 'no'} disabled={busy} onClick={() => void run(() => onLabel('no'))}>{t.classifyNo}</button>
          </div>
        </div>
        {item.labelled && <button className="link-btn" disabled={busy} onClick={() => void run(() => onLabel(null))}>{t.classifyReset}</button>}
        {error && <div className="error" role="alert">{error}</div>}
        <div className="between wrap">
          <button className="btn ghost" style={{ paddingInline: 0 }} onClick={() => onRead(unread)}>{unread ? t.markRead : t.markUnread}</button>
          <span className="sub">{t.readHereOnly}</span>
        </div>
      </div>
    </article>
  );
}

/** Messages pasted in by hand from WhatsApp or email, each with a reply MAAI drafts (which takes over the screen). */
function Messages({ onBack, gmail, whatsapp, device }: { onBack: () => void; gmail: boolean; whatsapp: boolean; device: boolean }) {
  const { t, settings } = useSettings();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ from: '', phone: '', email: '', text: '' });
  const { error, setError, run } = useAction();

  const load = useCallback(() => {
    // Only those added by hand: delivered messages are in the main list.
    api.inbox().then((all) => setMessages(all.filter((m) => !m.via))).catch((e: Error) => setError(e.message));
  }, [setError]);
  useEffect(load, [load]);
  useOnRefresh(load);

  const current = messages.find((m) => m.id === open);
  if (current) return <Reply message={current} gmail={gmail} whatsapp={whatsapp} device={device} onBack={() => setOpen(null)} onChanged={load} />;

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const m = await api.addMessage(form);
      setForm({ from: '', phone: '', email: '', text: '' });
      load();
      setOpen(m.id);
    });
  };

  const remove = (id: string) =>
    run(async () => {
      await api.deleteMessage(id);
      load();
    });

  return (
    <div className="screen">
      <button className="btn ghost" onClick={onBack} style={{ paddingInline: 0, alignSelf: 'flex-start' }}>
        <span style={{ display: 'inline-flex', transform: settings.lang === 'ar' ? 'scaleX(-1)' : undefined }}><Back size={20} /></span>{t.inboxTitle}
      </button>
      <h1 className="title">{t.addByHand}</h1>
      {error && <div className="error" role="alert">{error}</div>}
      <section className="card flush">
        {messages.length === 0 && <div className="msg-item sub">{t.inboxEmpty}</div>}
        {messages.map((m) => (
          <div key={m.id} className="row" style={{ borderBottom: '1px solid var(--sep)', paddingInlineEnd: 8 }}>
            <button className="msg-item" style={{ borderBottom: 'none' }} onClick={() => setOpen(m.id)}>
              <span className="between" style={{ width: '100%' }}>
                <span className="row" style={{ fontWeight: 600 }}>{!m.replied && <span className="dot" aria-hidden="true" />}{m.from}</span>
                <span className="sub">{m.replied ? t.replied : time(m.receivedAt, settings.lang)}</span>
              </span>
              <span className="sub" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{m.text}</span>
            </button>
            <button className="icon-btn" style={{ background: 'transparent', color: 'var(--text2)' }} aria-label={`${t.delete}: ${m.from}`} onClick={() => remove(m.id)}>
              <Trash size={18} />
            </button>
          </div>
        ))}
      </section>

      <form className="card extra" onSubmit={add}>
        <h2 className="h2" style={{ fontSize: '1.05em' }}>{t.addMessage}</h2>
        <p className="sub">{t.addMessageHint}</p>
        <div className="field">
          <label htmlFor="m-from">{t.from}</label>
          <input id="m-from" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="m-phone">{t.phoneOptional}</label>
          <input id="m-phone" inputMode="tel" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="9665XXXXXXXX" />
        </div>
        <div className="field">
          <label htmlFor="m-email">{t.emailOptional}</label>
          <input id="m-email" type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" />
        </div>
        <div className="field">
          <label htmlFor="m-text">{t.message}</label>
          <textarea id="m-text" dir="auto" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} required />
        </div>
        <button className="btn primary big" type="submit">{t.add}</button>
      </form>
    </div>
  );
}
