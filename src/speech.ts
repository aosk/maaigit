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

/** Starts listening; calls back with the live transcript and once more when done. Returns a stop function. */
export function listen(lang: Lang, onText: (text: string, final: boolean) => void, onEnd: () => void): () => void {
  if (!Ctor) {
    onEnd();
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = voiceLang(lang);
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    const results = Array.from(e.results);
    const text = results.map((r) => r[0].transcript).join('');
    onText(text, results.every((r) => r.isFinal));
  };
  rec.onend = onEnd;
  rec.onerror = () => onEnd();
  rec.start();
  return () => rec.stop();
}
