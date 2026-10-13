import type { Lang } from '../shared/types';

const voiceLang = (lang: Lang) => (lang === 'ar' ? 'ar-SA' : 'en-GB');

export function speak(text: string, lang: Lang, slow: boolean, onEnd?: () => void) {
  if (!('speechSynthesis' in window)) return onEnd?.();
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = voiceLang(lang);
  utterance.rate = slow ? 0.8 : 1;
  utterance.onend = () => onEnd?.();
  utterance.onerror = () => onEnd?.();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

// The Web Speech API is not in TypeScript's DOM types yet; this is the slice MAAI uses.
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

const Ctor = (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

export const canListen = Boolean(Ctor);

/** Why listening stopped early: no voice support, the microphone was refused, or nothing was heard. */
export type ListenProblem = 'unsupported' | 'denied' | 'no-speech';

/**
 * Listens until the user stops talking (a pause of `silenceMs` after they last
 * spoke), or taps stop, or two minutes pass. Browsers end recognition on their
 * own after a short pause, so MAAI quietly restarts it and keeps what was said.
 * Calls back with the full transcript so far, then once when finished.
 */
export function listen(
  lang: Lang,
  onText: (text: string) => void,
  onEnd: (problem?: ListenProblem) => void,
  opts: { silenceMs?: number } = {},
): () => void {
  if (!Ctor) {
    onEnd('unsupported');
    return () => {};
  }
  const silenceMs = opts.silenceMs ?? 2500;
  let finished = false;
  let stopping = false;
  let problem: ListenProblem | undefined;
  let kept = ''; // finished phrases from earlier rounds
  let current = ''; // what this round has heard so far
  let heardAnything = false;
  let rec: Recognition | null = null;
  let silence: ReturnType<typeof setTimeout> | undefined;
  const limit = setTimeout(() => stop(), 120_000);
  // Give up waiting for the first word after 8 seconds of quiet.
  let firstWord: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    if (!heardAnything) {
      problem = 'no-speech';
      stop();
    }
  }, 8000);

  const text = () => `${kept} ${current}`.replace(/\s+/g, ' ').trim();

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(limit);
    clearTimeout(silence);
    clearTimeout(firstWord);
    onEnd(heardAnything ? undefined : problem ?? 'no-speech');
  }

  function stop() {
    stopping = true;
    try {
      rec?.stop();
    } catch {
      // already stopped
    }
    // Some browsers never fire "end" after stop(); don't hang.
    setTimeout(finish, 600);
  }

  let startedAt = 0;
  function round() {
    startedAt = Date.now();
    const r = new Ctor!();
    rec = r;
    r.lang = voiceLang(lang);
    r.interimResults = true;
    r.continuous = true;
    r.onresult = (e) => {
      current = Array.from(e.results).map((res) => res[0].transcript).join('');
      if (current.trim()) {
        heardAnything = true;
        clearTimeout(firstWord);
        firstWord = undefined;
        onText(text());
        // Each new word resets the pause timer.
        clearTimeout(silence);
        silence = setTimeout(stop, silenceMs);
      }
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        // iPhone home-screen apps report "service-not-allowed": voice typing isn't offered there.
        problem = e.error === 'not-allowed' ? 'denied' : 'unsupported';
        stopping = true;
      }
    };
    r.onend = () => {
      kept = text();
      current = '';
      if (stopping || finished) return finish();
      // The browser stopped on its own (a short pause): keep listening. If it gave up
      // almost at once, wait a moment first so it doesn't spin.
      const restart = () => {
        if (stopping || finished) return finish();
        try {
          round();
        } catch {
          finish();
        }
      };
      if (Date.now() - startedAt < 1000) setTimeout(restart, 400);
      else restart();
    };
    r.start();
  }

  try {
    round();
  } catch {
    problem = 'unsupported';
    finish();
  }
  return stop;
}
