import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatTurn, Proposal, StatusInfo } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { canListen, listen, speak, stopSpeaking, type ListenProblem } from '../speech';
import { Mic, Plus, Send } from '../components/Icons';
import { takeArrival } from '../nav';
import { Logo } from '../components/Logo';
import { ProposalCard } from '../components/ProposalCard';
import { WorkingBubble, addEvent, emptyProgress, type Progress } from '../components/WorkingBubble';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [voiceNote, setVoiceNote] = useState('');
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
    api
      .chat()
      .then((c) => {
        setTurns(c.turns);
        setProposals(Object.fromEntries(c.proposals.map((p) => [p.id, p])));
        const arrival = takeArrival();
        if (arrival.prompt) void send(arrival.prompt);
        else if (arrival.listen) toggleMic();
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
    setProgress(emptyProgress());
    try {
      const res = await api.send(message, lang, (e) => setProgress((p) => addEvent(p, e)));
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
    setVoiceNote('');
    if (!canListen) return typeInstead('unsupported');
    setLive(true);
    let heard = '';
    stopRef.current = listen(
      lang,
      (text) => {
        heard = text;
        setInput(text);
      },
      (problem) => {
        setLive(false);
        if (heard) void send(heard);
        else if (problem) typeInstead(problem);
      },
      { silenceMs: settings.toggles.longListen ? 5000 : 2500 },
    );
  }

  /** When the browser can't listen, open the keyboard: its own microphone key works everywhere. */
  function typeInstead(problem: ListenProblem) {
    setVoiceNote(problem === 'denied' ? t.micDenied : problem === 'no-speech' ? t.noSpeech : t.voiceUnsupported);
    inputRef.current?.focus();
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
        <div className="row" style={{ fontWeight: 600, color: 'var(--tint-text)', gap: 6 }}><Logo size={22} /><span style={{ color: 'var(--text)' }}>{t.appName}</span></div>
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
                <ProposalCard key={pid} proposal={proposals[pid]} gmail={Boolean(status?.mail?.configured)} onChange={(p) => setProposals((ps) => ({ ...ps, [p.id]: p }))} />
              ) : null,
            )}
          </div>
        ))}

        {busy && <WorkingBubble progress={progress} />}
        {error && <div className="error" role="alert">{error}</div>}
        <div ref={endRef} className="chat-end" />
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <div className="composer-hint" aria-live="polite">
          {live ? t.listening : voiceNote || t.tapToSpeak}
        </div>
        <div className="composer-row">
          <label htmlFor="chat-input" className="sr-only">{t.typeMessage}</label>
          <input
            id="chat-input"
            ref={inputRef}
            enterKeyHint="send"
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
              disabled={busy}
            >
              <Mic size={26} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
