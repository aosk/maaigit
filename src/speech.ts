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
 * Starts listening; calls back with the live transcript, then once when finished
 * (with a problem if it failed). Returns a stop function.
 */
export function listen(lang: Lang, onText: (text: string) => void, onEnd: (problem?: ListenProblem) => void): () => void {
  if (!Ctor) {
    onEnd('unsupported');
    return () => {};
  }
  let finished = false;
  let problem: ListenProblem | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(safety);
    onEnd(problem);
  };
  const rec = new Ctor();
  rec.lang = voiceLang(lang);
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => onText(Array.from(e.results).map((r) => r[0].transcript).join(''));
  rec.onend = finish;
  rec.onerror = (e) => {
    // iPhone home-screen apps report "service-not-allowed": voice typing isn't offered there.
    problem = e.error === 'not-allowed' ? 'denied' : e.error === 'no-speech' || e.error === 'aborted' ? 'no-speech' : 'unsupported';
    finish();
  };
  // Some browsers never report the end; don't leave the button stuck on "listening".
  const safety = setTimeout(() => {
    try {
      rec.stop();
    } catch {
      // already stopped
    }
    finish();
  }, 15_000);
  try {
    rec.start();
  } catch {
    problem = 'unsupported';
    finish();
  }
  return () => {
    try {
      rec.stop();
    } catch {
      // already stopped
    }
  };
}
