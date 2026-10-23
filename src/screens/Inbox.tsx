import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { FeedItem, InboxFeed, InboxMessage, StatusInfo, Tone } from '../../shared/types';
import { api } from '../api';
import { cachedFeed, keepFeed } from '../inboxCache';
import { dayTime, time } from '../format';
import { askAssistant } from '../nav';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { useOnRefresh } from '../refresh';
import { Back, Chat, Send, Sun, Trash } from '../components/Icons';
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

/** One list: Gmail and every message people sent, newest first, each tagged Email or WhatsApp. */
export function Inbox() {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [status, setStatus] = useState<StatusInfo | null>(null);
  // The last Inbox shows at once; the fresh one replaces it when it arrives.
  const [feed, setFeed] = useState<InboxFeed | null>(() => cachedFeed(lang));
  // Only the newest request may change the screen (a slow older one must not overwrite a newer answer).
  const latest = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [replying, setReplying] = useState<InboxMessage | null>(null);
  const [adding, setAdding] = useState(false);

  // `background` marks the automatic refreshes: they must not count as the user being here (else the Face ID
  // lock would never close the app while the Inbox is open).
  const load = useCallback(
    (refresh: boolean, background = false) => {
      const mine = ++latest.current;
      setBusy(true);
      setError('');
      api
        .inboxFeed(lang, refresh, background)
        .then((fresh) => {
          if (mine !== latest.current) return;
          setFeed(fresh);
          keepFeed(lang, fresh);
        })
        .catch((e: Error) => mine === latest.current && setError(e.message))
        .finally(() => mine === latest.current && setBusy(false));
    },
    [lang],
  );
  useEffect(() => {
    load(false);
    const timer = setInterval(() => document.hidden || load(false, true), RELOAD_MS);
    return () => clearInterval(timer);
  }, [load]);
  useOnRefresh(() => load(false));
  // While WhatsApp waits for a linking code, look again often: WhatsApp makes a new one every 3 minutes.
  const linking = Boolean(feed?.bot?.link);
  useEffect(() => {
    if (!linking) return;
    const timer = setInterval(() => document.hidden || load(false, true), 15_000);
    return () => clearInterval(timer);
  }, [linking, load]);
  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
  }, []);

  const gmail = Boolean(status?.mail?.configured);
  const whatsapp = Boolean(status?.whatsapp?.configured);
  if (replying) return <Reply message={replying} gmail={gmail} whatsapp={whatsapp} device={Boolean(feed?.bot.connected)} onBack={() => setReplying(null)} onChanged={() => load(false)} />;
  if (adding) return <Messages onBack={() => { setAdding(false); load(false); }} gmail={gmail} whatsapp={whatsapp} device={Boolean(feed?.bot.connected)} />;

  const bot = feed?.bot;
  const botLine = !bot ? '' : !bot.connected ? t.botOffLine : bot.lastSync ? t.botLine(dayTime(bot.lastSync, lang)) : t.botNoSync;

  return (
    <div className="screen">
      <h1 className="title">{t.inboxTitle}</h1>

      <section className="card" aria-label={t.feedSummary}>
        <div className="between">
          <div className="card-label"><Sun size={20} />{t.feedSummary}</div>
          <button className="btn ghost" onClick={() => load(true)} disabled={busy}>{busy ? t.reading : t.refresh}</button>
        </div>
        <p aria-live="polite" dir="auto">{busy && !feed ? t.readingInbox : feed?.summary || '…'}</p>
        {feed && <div className="sub">{busy ? t.refreshing : t.lastChecked(dayTime(feed.fetchedAt, lang))}{botLine ? ` · ${botLine}` : ''}</div>}
      </section>

      {bot?.stale && <div className="banner" role="status">{t.botStale}</div>}
      {bot?.link && (
        <div className="banner" role="status">
          {bot.link.code ? t.botLinkCode : t.botLinkQr}
          {bot.link.code && <div dir="ltr" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 28, letterSpacing: 4, marginTop: 6, userSelect: 'all' }}>{bot.link.code.slice(0, 4)}-{bot.link.code.slice(4)}</div>}
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}

      <section className="card flush" aria-label={t.inboxTitle}>
        {feed && feed.items.length === 0 && <div className="msg-item sub">{t.feedEmpty}</div>}
        {feed?.items.map((item) => (
          <FeedRow key={item.key} item={item} expanded={open === item.key} onToggle={() => setOpen(open === item.key ? null : item.key)} onReply={setReplying} />
        ))}
      </section>

      <button className="btn ghost" onClick={() => setAdding(true)}>{t.addByHand}</button>
    </div>
  );
}

/** One email or conversation: tagged with where it came from; tap to read it with MAAI's suggestion. */
function FeedRow({ item, expanded, onToggle, onReply }: { item: FeedItem; expanded: boolean; onToggle: () => void; onReply: (m: InboxMessage) => void }) {
  const { t, settings } = useSettings();
  const email = item.channel === 'email';
  const decide = (choice: string) =>
    askAssistant(item.uid !== undefined ? t.decidePrompt(item.uid, item.from, item.subject ?? '', choice) : t.msgDecidePrompt(item.from, choice));
  return (
    <div className="mail-item" style={item.handled && !item.waiting ? { opacity: 0.75 } : undefined}>
      <button className="msg-item" onClick={onToggle} aria-expanded={expanded}>
        <span className="between" style={{ width: '100%' }}>
          <span className="row" style={{ fontWeight: 600, minWidth: 0 }}>
            {item.waiting && <span className="dot" aria-hidden="true" />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} dir="auto">{item.from}</span>
          </span>
          <span className="row" style={{ flex: 'none' }}>
            {item.priority === 'high' && <span className="badge-high">{t.highPriority}</span>}
            <span className={`tag-chip${email ? '' : ' whatsapp'}`}>{email ? t.tagEmail : t.tagWhatsApp}{item.message?.group ? ` · ${t.tagGroup}` : ''}</span>
            <span className="sub">{dayTime(item.at, settings.lang)}</span>
          </span>
        </span>
        {item.subject && <span style={{ fontSize: '0.88em' }} dir="auto">{item.subject}</span>}
        <span className="sub" dir="auto">{item.text}{item.source === 'bot' ? ` · ${t.viaDevice}` : ''}</span>
      </button>

      {expanded && (
        <>
          <div className="mail-body" dir="auto">{item.body || t.noText}</div>
          <div className="mail-actions">
            {item.intake && <div className="sub" dir="auto"><strong>{t.maaiFoundOut}</strong> {item.intake}</div>}
            {item.suggestion && <div className="sub" dir="auto"><strong>{t.maaiSuggests}</strong> {item.suggestion}</div>}
            {item.options && (
              <div className="row wrap">
                {item.options.map((o, i) => (
                  <button key={o} className={`btn round ${i === 0 ? 'primary' : 'secondary'}`} onClick={() => decide(o)}>{i === 0 ? `✓ ${o}` : o}</button>
                ))}
              </div>
            )}
            {item.message ? (
              <button className="btn secondary round" onClick={() => onReply(item.message!)}><Chat size={16} />{t.replyToThread}</button>
            ) : item.uid !== undefined ? (
              <button className="btn secondary round" onClick={() => askAssistant(t.replyPrompt(item.uid!, item.from, item.subject ?? ''))}><Chat size={16} />{t.draftReplyWithMaai}</button>
            ) : null}
          </div>
        </>
      )}
    </div>
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
