import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatTurn, Proposal, StatusInfo } from '../../shared/types';
import { api } from '../api';
import { dayTime } from '../format';
import { useSettings } from '../settings';
import { canListen, listen, speak, stopSpeaking } from '../speech';
import { Bell, Calendar, Mic, Plus, Send } from '../components/Icons';
import { PROMPT_KEY } from '../App';

function ProposalCard({ proposal, onChange }: { proposal: Proposal; onChange: (p: Proposal) => void }) {
  const { t, settings } = useSettings();
  const lang = settings.lang;
  const [picked, setPicked] = useState(proposal.kind === 'meeting' ? proposal.chosen ?? proposal.options[0]?.start : undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const done = proposal.status !== 'pending';

  async function act(kind: 'approve' | 'cancel') {
    setBusy(true);
    setError('');
    try {
      onChange(kind === 'approve' ? await api.approve(proposal.id, picked) : await api.cancel(proposal.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const repeatLabel = { once: t.repeatOnce, daily: t.repeatDaily, weekly: t.repeatWeekly };

  return (
    <section className={`card approval${done ? ' done' : ''}`} aria-label={proposal.title}>
      <div className="card-label">
        {proposal.kind === 'meeting' ? <Calendar size={18} /> : <Bell size={18} />}
        {proposal.kind === 'meeting' ? t.needsApproval : t.newReminder}
      </div>
      <div style={{ fontWeight: 600 }}>
        {proposal.title}
        {proposal.kind === 'meeting' && ` · ${t.minutesShort(proposal.minutes)}`}
      </div>

      {proposal.kind === 'meeting' ? (
        <>
          <div role="radiogroup" aria-label={t.timeOptions} className="chips">
            {proposal.options.map((o) => (
              <button
                key={o.start}
                role="radio"
                aria-checked={picked === o.start}
                className="option"
                disabled={done}
                onClick={() => setPicked(o.start)}
              >
                <span>{dayTime(o.start, lang)}</span>
                <span className="sub">{o.note}</span>
              </button>
            ))}
          </div>
          <div className="sub">{t.inviteNote(proposal.attendeeEmail)}</div>
        </>
      ) : (
        <div>
          <div className="kv"><span>{t.time}</span><span>{proposal.at ? dayTime(proposal.at, lang) : proposal.when}</span></div>
          <div className="kv"><span>{t.repeat}</span><span>{repeatLabel[proposal.repeat]}</span></div>
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      {done ? (
        <div className={`status-tag ${proposal.status}`} role="status">
          {proposal.status === 'approved' ? `✓ ${t.approved}` : t.cancelled}
          {proposal.kind === 'meeting' && proposal.chosen ? ` · ${dayTime(proposal.chosen, lang)}` : ''}
        </div>
      ) : (
        <>
          <div className="row">
            <button className="btn primary big" style={{ flex: 2 }} disabled={busy} onClick={() => act('approve')}>
              {proposal.kind === 'meeting' ? t.approveSend : t.approve}
            </button>
            <button className="btn danger big grow" disabled={busy} onClick={() => act('cancel')}>{t.cancel}</button>
          </div>
        </>
      )}
    </section>
  );
}

export function Assistant() {
  const { t, settings, update } = useSettings();
  const lang = settings.lang;
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const stopRef = useRef<() => void>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    api
      .chat()
      .then((c) => {
        setTurns(c.turns);
        setProposals(Object.fromEntries(c.proposals.map((p) => [p.id, p])));
        const queued = sessionStorage.getItem(PROMPT_KEY);
        sessionStorage.removeItem(PROMPT_KEY);
        if (queued) void send(queued);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      stopRef.current?.();
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: settings.toggles.reduceMotion ? 'auto' : 'smooth', block: 'end' });
  }, [turns, busy, settings.toggles.reduceMotion]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setError('');
    setBusy(true);
    setTurns((ts) => [...ts, { role: 'user', text: message }]);
    try {
      const res = await api.send(message, lang);
      setProposals((ps) => ({ ...ps, ...Object.fromEntries(res.proposals.map((p) => [p.id, p])) }));
      setTurns((ts) => [...ts, { role: 'assistant', text: res.reply, proposalIds: res.proposals.map((p) => p.id) }]);
      if (settings.toggles.speakReplies) speak(res.reply, lang, settings.toggles.slow);
    } catch (e) {
      setTurns((ts) => ts.slice(0, -1));
      setInput(message);
      setError((e as Error).message || t.errorGeneric);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    if (live) {
      stopRef.current?.();
      return;
    }
    stopSpeaking();
    setLive(true);
    let heard = '';
    stopRef.current = listen(
      lang,
      (text) => {
        heard = text;
        setInput(text);
      },
      () => {
        setLive(false);
        if (heard) void send(heard);
      },
    );
  }

  async function newChat() {
    await api.resetChat();
    setTurns([]);
    setProposals({});
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="chat-screen">
      <div className="chat-head">
        <button className="btn ghost" onClick={newChat} disabled={busy}><Plus size={18} />{t.newChat}</button>
        <div style={{ fontWeight: 600 }}>{t.appName}</div>
        <button className="icon-btn" aria-label={t.switchLanguage} onClick={() => update({ lang: lang === 'ar' ? 'en' : 'ar' })}>
          {lang === 'ar' ? 'EN' : 'ع'}
        </button>
      </div>

      <div className="chat-log" aria-live="polite">
        {status && !status.aiConfigured && <div className="banner">{t.demoBanner}</div>}

        {turns.length === 0 && (
          <div className="chips">
            <p className="sub" style={{ fontSize: '0.9em' }}>{t.chatEmpty}</p>
            {t.examples.map((ex) => (
              <button key={ex} className="chip" onClick={() => send(ex)}>{ex}</button>
            ))}
          </div>
        )}

        {turns.map((turn, i) => (
          <div key={i} style={{ display: 'contents' }}>
            {(turn.role === 'user' || settings.toggles.captions || !settings.toggles.speakReplies) && (
              <div className={`bubble ${turn.role}`}>{turn.text}</div>
            )}
            {turn.proposalIds?.map((pid) =>
              proposals[pid] ? (
                <ProposalCard key={pid} proposal={proposals[pid]} onChange={(p) => setProposals((ps) => ({ ...ps, [p.id]: p }))} />
              ) : null,
            )}
          </div>
        ))}

        {busy && <div className="bubble assistant pending">{t.thinking}</div>}
        {error && <div className="error" role="alert">{error}</div>}
        <div ref={endRef} className="chat-end" />
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <div className="composer-hint" aria-live="polite">
          {live ? t.listening : canListen ? t.tapToSpeak : t.voiceUnsupported}
        </div>
        <div className="composer-row">
          <label htmlFor="chat-input" className="sr-only">{t.typeMessage}</label>
          <input
            id="chat-input"
            value={input}
            placeholder={t.typeMessage}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            autoComplete="off"
          />
          {input.trim() && !live ? (
            <button type="submit" className="mic" aria-label={t.send} disabled={busy}><Send size={22} /></button>
          ) : (
            <button
              type="button"
              className={`mic${live ? ' live' : ''}`}
              aria-label={live ? t.stopListening : t.startListening}
              aria-pressed={live}
              onClick={toggleMic}
              disabled={busy || !canListen}
            >
              <Mic size={26} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
