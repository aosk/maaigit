import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatTurn, Lang, Proposal, StatusInfo } from '../../shared/types';
import { api } from '../api';
import { useSettings } from '../settings';
import { canListen, listen, speak, stopSpeaking, type ListenProblem } from '../speech';
import { canRecord, record } from '../recorder';
import { FileText, Mic, Paperclip, Plus, Send } from '../components/Icons';
import { AttachError, prepare, type AttachKind } from '../attach';
import { takeArrival } from '../nav';
import { Logo } from '../components/Logo';
import { ProposalCard } from '../components/ProposalCard';
import { WorkingBubble, addEvent, emptyProgress, type Progress } from '../components/WorkingBubble';

interface Pending {
  key: number;
  name: string;
  kind: AttachKind;
  preview?: string;
  status: 'uploading' | 'ready';
  id?: string;
}

let pendingKey = 0;

export function Assistant() {
  const { t, settings, update } = useSettings();
  const lang = settings.lang;
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const stopRef = useRef<() => void>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [voiceNote, setVoiceNote] = useState('');
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  // What the long-lived callbacks (dictation, a streamed reply, an upload) must see now, not as it was when they started.
  const alive = useRef(true);
  const busyRef = useRef(false);
  const pendingRef = useRef<Pending[]>([]);
  const turnsRef = useRef<ChatTurn[]>([]);
  const abortRef = useRef<AbortController>();
  const previews = useRef(new Set<string>());
  busyRef.current = busy;
  pendingRef.current = pending;
  turnsRef.current = turns;

  useEffect(() => {
    alive.current = true;
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
      alive.current = false;
      abortRef.current?.abort();
      stopRef.current?.();
      stopSpeaking();
      for (const url of previews.current) URL.revokeObjectURL(url);
      previews.current.clear();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: settings.toggles.reduceMotion ? 'auto' : 'smooth', block: 'end' });
  }, [turns, busy, settings.toggles.reduceMotion]);

  async function attach(list: FileList | null) {
    if (!list) return;
    setError('');
    for (const file of Array.from(list)) {
      const key = ++pendingKey;
      try {
        const ready = await prepare(file);
        if (!alive.current) return;
        const preview = ready.kind === 'image' ? URL.createObjectURL(ready.blob) : undefined;
        if (preview) previews.current.add(preview);
        setPending((ps) => [...ps, { key, name: ready.name, kind: ready.kind, preview, status: 'uploading' }]);
        try {
          const info = await api.upload(ready.blob, ready.name);
          if (alive.current) setPending((ps) => ps.map((p) => (p.key === key ? { ...p, status: 'ready', id: info.id } : p)));
        } catch (e) {
          if (preview) forgetPreview(preview);
          if (!alive.current) return;
          setPending((ps) => ps.filter((p) => p.key !== key));
          setError(t.attachFailed((e as Error).message));
        }
      } catch (e) {
        const err = e as Error;
        if (!alive.current) return;
        setError(err instanceof AttachError ? (err.reason === 'too-big' ? t.attachTooBig : t.attachNotSupported) : t.attachFailed(err.message));
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  function forgetPreview(url: string) {
    URL.revokeObjectURL(url);
    previews.current.delete(url);
  }

  function removePending(key: number) {
    const gone = pendingRef.current.find((p) => p.key === key);
    if (gone?.preview) forgetPreview(gone.preview);
    setPending((ps) => ps.filter((p) => p.key !== key));
  }

  // The microphone listens for the app's language (the ع / EN button at the top changes it); the voice service, when on, understands both at once.
  const dictLang: Lang = lang;
  const smart = Boolean(status?.voice?.smart) && canRecord;

  async function send(text: string, voice?: Lang) {
    if (busyRef.current || !alive.current) return;
    const waiting = pendingRef.current;
    if (waiting.some((p) => p.status === 'uploading')) return setError(t.attachWaiting);
    const files = waiting.filter((p) => p.id);
    const message = text.trim() || (files.length ? t.attachDefaultPrompt : '');
    if (!message) return;
    busyRef.current = true;
    setInput('');
    setError('');
    setBusy(true);
    const shown = text.trim() || (files.length ? '' : message);
    const base = turnsRef.current.length;
    setTurns((ts) => [...ts, { role: 'user', text: shown, attachments: files.length ? files.map((f) => ({ name: f.name, kind: f.kind })) : undefined }]);
    setPending([]);
    setProgress(emptyProgress());
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await api.send(message, lang, (e) => alive.current && setProgress((p) => addEvent(p, e)), files.map((f) => f.id!), abort.signal, voice);
      for (const f of files) if (f.preview) forgetPreview(f.preview);
      if (!alive.current) return;
      setProposals((ps) => ({ ...ps, ...Object.fromEntries(res.proposals.map((p) => [p.id, p])) }));
      setTurns((ts) => [...ts, { role: 'assistant', text: res.reply, proposalIds: res.proposals.map((p) => p.id) }]);
      if (settings.toggles.speakReplies) speak(res.reply, lang, settings.toggles.slow);
    } catch (e) {
      if (!alive.current) return;
      // The connection may have dropped after MAAI finished: ask the server before telling the user it failed.
      const saved = await api.chat().catch(() => null);
      if (!alive.current) return;
      if (saved && saved.turns.length >= base + 2) {
        setTurns(saved.turns);
        setProposals(Object.fromEntries(saved.proposals.map((p) => [p.id, p])));
        for (const f of files) if (f.preview) forgetPreview(f.preview);
      } else {
        setTurns((ts) => ts.slice(0, -1));
        setInput(text.trim());
        setPending(files);
        setError((e as Error).message || t.errorGeneric);
      }
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  /** What the person said, once it is words: sent at once, or left in the box to check first. */
  function heardWords(words: string) {
    if (!words.trim()) return typeInstead('no-speech');
    if (settings.toggles.reviewVoice) {
      setInput(words);
      inputRef.current?.focus();
    } else void send(words, smart ? undefined : dictLang);
  }

  function toggleMic() {
    if (live) {
      stopRef.current?.();
      return;
    }
    stopSpeaking();
    setVoiceNote('');
    if (smart) return listenSmart();
    if (!canListen) return typeInstead('unsupported');
    setLive(true);
    let heard = '';
    stopRef.current = listen(
      dictLang,
      (text) => {
        heard = text;
        setInput(text);
      },
      (problem) => {
        if (!alive.current) return; // the screen was left while listening: nothing is sent
        setLive(false);
        if (heard) heardWords(heard);
        else if (problem) typeInstead(problem);
      },
      { silenceMs: settings.toggles.longListen ? 5000 : 2500 },
    );
  }

  /** Records, then has the voice service write it down: Arabic and English can be mixed in one sentence. */
  function listenSmart() {
    setLive(true);
    stopRef.current = record({
      silenceMs: settings.toggles.longListen ? 4500 : 2200,
      onDone: (audio, problem) => {
        if (!alive.current) return;
        setLive(false);
        if (!audio) return typeInstead(problem === 'denied' ? 'denied' : problem === 'unsupported' ? 'unsupported' : 'no-speech');
        setTranscribing(true);
        api
          .transcribe(audio)
          .then((words) => alive.current && heardWords(words))
          .catch((e: Error) => alive.current && setVoiceNote(t.voiceFailed(e.message)))
          .finally(() => alive.current && setTranscribing(false));
      },
    });
  }

  /** When the browser can't listen, open the keyboard: its own microphone key works everywhere. */
  function typeInstead(problem: ListenProblem) {
    setVoiceNote(problem === 'denied' ? t.micDenied : problem === 'no-speech' ? t.noSpeech : t.voiceUnsupported);
    inputRef.current?.focus();
  }

  async function newChat() {
    try {
      await api.resetChat();
      setTurns([]);
      setProposals({});
      setError('');
    } catch (e) {
      setError((e as Error).message || t.errorGeneric);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  return (
    <div className="chat-screen">
      <h1 className="sr-only">{t.assistant}</h1>
      <div className="chat-head">
        <button className="btn ghost" onClick={newChat} disabled={busy}><Plus size={18} />{t.newChat}</button>
        <div className="row" style={{ fontWeight: 600, color: 'var(--tint-text)', gap: 6 }}><Logo size={22} /><span style={{ color: 'var(--text)' }}>{t.appName}</span></div>
        <button className="icon-btn" aria-label={`${lang === 'ar' ? 'EN' : 'ع'} — ${t.switchLanguage}`} onClick={() => update({ lang: lang === 'ar' ? 'en' : 'ar' })}>
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
              <div className={`bubble ${turn.role}`}>
                {turn.attachments?.map((a, k) => (
                  <span key={k} className="file-chip"><FileText size={16} />{a.name}</span>
                ))}
                {turn.text}
              </div>
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
          {transcribing ? t.transcribing : live ? t.listening : voiceNote || t.tapToSpeak}
        </div>
        {pending.length > 0 && (
          <ul className="attachments" aria-label={t.attach}>
            {pending.map((p) => (
              <li key={p.key} className={`file-chip${p.status === 'uploading' ? ' wait' : ''}`}>
                {p.preview ? <img src={p.preview} alt="" /> : <FileText size={16} />}
                <span className="file-name">{p.status === 'uploading' ? t.attachPreparing : p.name}</span>
                <button type="button" className="file-x" aria-label={t.attachRemove(p.name)} onClick={() => removePending(p.key)}>×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="composer-row">
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => void attach(e.target.files)} />
          <button type="button" className="attach" aria-label={t.attach} onClick={() => fileRef.current?.click()} disabled={busy}><Paperclip size={22} /></button>
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
          {(input.trim() || pending.some((p) => p.id)) && !live ? (
            <button type="submit" className="mic" aria-label={t.send} disabled={busy}><Send size={22} /></button>
          ) : (
            <button
              type="button"
              className={`mic${live ? ' live' : ''}`}
              aria-label={live ? t.stopListening : t.startListening}
              aria-pressed={live}
              onClick={toggleMic}
              disabled={busy || transcribing}
            >
              <Mic size={26} />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
