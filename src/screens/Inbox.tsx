import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { InboxMessage, StatusInfo, Tone } from '../../shared/types';
import { api } from '../api';
import { time } from '../format';
import { useSettings } from '../settings';
import { useAction } from '../useAction';
import { useOnRefresh } from '../refresh';
import { Back, Chat, Send, Trash } from '../components/Icons';
import { mailtoLink } from '../components/EmailCard';
import { MailDigest } from './MailDigest';

const TONES: Tone[] = ['short', 'friendly', 'formal', 'arabic'];

function Reply({ message, gmail, onBack, onChanged }: { message: InboxMessage; gmail: boolean; onBack: () => void; onChanged: () => void }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [tone, setTone] = useState<Tone>(lang === 'ar' ? 'arabic' : 'friendly');
  const [draft, setDraft] = useState('');
  const [summary, setSummary] = useState('');
  const [copied, setCopied] = useState(false);
  const drafting = useAction();
  const emailing = useAction();
  const busy = drafting.busy;
  const error = drafting.error || emailing.error;

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
      onChanged();
    });

  async function sent() {
    await api.replied(message.id);
    onChanged();
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
        <div style={{ fontWeight: 600 }}>{t.replyTo(message.from)}</div>
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
            <button className="btn primary big" onClick={emailIt} disabled={busy || !draft || emailing.busy}>
              <Send size={20} />{emailing.busy ? t.sending : `${t.sendByEmail} · ${message.email}`}
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
        <a className="btn primary big" href={waLink} target="_blank" rel="noreferrer" onClick={sent} aria-disabled={busy || !draft} style={{ textDecoration: 'none' }}>
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

type View = 'email' | 'messages';
const VIEW_KEY = 'maai.inboxView';

/** Two inboxes: Gmail, read and sorted by MAAI, and messages the user pasted in from WhatsApp. */
export function Inbox() {
  const { t } = useSettings();
  const [status, setStatus] = useState<StatusInfo | null>(null);
  // Email first; the choice is remembered for this visit.
  const [view, setView] = useState<View>(() => (sessionStorage.getItem(VIEW_KEY) as View | null) ?? 'email');
  const pickView = (v: View) => {
    setView(v);
    sessionStorage.setItem(VIEW_KEY, v);
  };
  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
  }, []);

  const header = (
    <>
      <h1 className="title">{t.inboxTitle}</h1>
      <div className="seg" role="radiogroup" aria-label={t.inboxTitle}>
        <button role="radio" aria-checked={view === 'email'} onClick={() => pickView('email')}>{t.emailTab}</button>
        <button role="radio" aria-checked={view === 'messages'} onClick={() => pickView('messages')}>{t.messagesTab}</button>
      </div>
    </>
  );
  if (view === 'messages') return <Messages header={header} gmail={Boolean(status?.mail?.configured)} />;
  return (
    <div className="screen">
      {header}
      <MailDigest gmail={Boolean(status?.mail?.inbox)} />
    </div>
  );
}

/** Messages pasted in from WhatsApp or email, each with a reply MAAI drafts (which takes over the screen). */
function Messages({ header, gmail }: { header: ReactNode; gmail: boolean }) {
  const { t, settings } = useSettings();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ from: '', phone: '', email: '', text: '' });
  const { error, setError, run } = useAction();

  const load = useCallback(() => {
    api.inbox().then(setMessages).catch((e: Error) => setError(e.message));
  }, [setError]);
  useEffect(load, [load]);
  useOnRefresh(load);

  const current = messages.find((m) => m.id === open);
  if (current) return <Reply message={current} gmail={gmail} onBack={() => setOpen(null)} onChanged={load} />;

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
      {header}
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
