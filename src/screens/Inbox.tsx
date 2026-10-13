import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { InboxMessage, Tone } from '../../shared/types';
import { api } from '../api';
import { time } from '../format';
import { useSettings } from '../settings';
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const makeDraft = useCallback(
    async (chosen: Tone) => {
      setBusy(true);
      setError('');
      try {
        const res = await api.draft(message.id, chosen, lang);
        setDraft(res.draft);
        setSummary(res.summary);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [message.id, lang],
  );

  useEffect(() => {
    void makeDraft(tone);
    // Draft once on open; tone changes redraft explicitly below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  function pickTone(next: Tone) {
    setTone(next);
    void makeDraft(next);
  }

  const waLink = `https://wa.me/${message.phone ?? ''}?text=${encodeURIComponent(draft)}`;
  const replySubject = `Re: ${message.text.slice(0, 60)}`;
  const [emailing, setEmailing] = useState(false);

  async function emailIt() {
    if (!message.email) return;
    setEmailing(true);
    setError('');
    try {
      await api.emailReply(message.id, { to: message.email, subject: replySubject, body: draft });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEmailing(false);
    }
  }

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
      setError(t.errorGeneric);
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
            <button className="btn primary big" onClick={emailIt} disabled={busy || !draft || emailing}>
              <Send size={20} />{emailing ? t.sending : `${t.sendByEmail} · ${message.email}`}
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

export function Inbox() {
  const { t, settings } = useSettings();
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ from: '', phone: '', email: '', text: '' });
  const [gmail, setGmail] = useState(false);
  const [gmailInbox, setGmailInbox] = useState(false);
  // Email (Gmail) first once Gmail is connected; the choice is remembered on this device.
  const [view, setView] = useState<'email' | 'messages'>(() => (sessionStorage.getItem('maai.inboxView') as 'email' | 'messages') || 'email');
  const pickView = (v: 'email' | 'messages') => {
    setView(v);
    sessionStorage.setItem('maai.inboxView', v);
  };
  useEffect(() => {
    api
      .status()
      .then((s) => {
        setGmail(Boolean(s.mail?.configured));
        setGmailInbox(Boolean(s.mail?.inbox));
      })
      .catch(() => {});
  }, []);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.inbox().then(setMessages).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const current = messages.find((m) => m.id === open);
  if (current) return <Reply message={current} gmail={gmail} onBack={() => setOpen(null)} onChanged={load} />;

  async function add(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const m = await api.addMessage(form);
      setForm({ from: '', phone: '', email: '', text: '' });
      load();
      setOpen(m.id);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    await api.deleteMessage(id);
    load();
  }

  return (
    <div className="screen">
      <h1 className="title">{t.inboxTitle}</h1>
      <div className="seg" role="radiogroup" aria-label={t.inboxTitle}>
        <button role="radio" aria-checked={view === 'email'} onClick={() => pickView('email')}>{t.emailTab}</button>
        <button role="radio" aria-checked={view === 'messages'} onClick={() => pickView('messages')}>{t.messagesTab}</button>
      </div>
      {error && <div className="error" role="alert">{error}</div>}

      {view === 'email' ? (
        <MailDigest gmail={gmailInbox} />
      ) : (
      <>
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
      </>
      )}
    </div>
  );
}
