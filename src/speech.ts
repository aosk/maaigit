import type { Lang } from '../shared/types';

import { cleanForSpeech, pickVoice, rankVoices, sentences, type VoiceInfo } from './voice';

const voiceLang = (lang: Lang) => (lang === 'ar' ? 'ar-SA' : 'en-GB');

/** The voices the person picked in Settings, by language (set from the settings). */
let chosen: Partial<Record<Lang, string>> = {};
export function setChosenVoices(voices: Partial<Record<Lang, string>>) {
  chosen = voices;
}

/** The phone's voices. They load a moment after the page does, so wait for them (but not for long). */
function installedVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!('speechSynthesis' in window)) return Promise.resolve([]);
  const now = window.speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

/** The voices for a language, best first, as the person sees them in Settings. */
export async function voiceChoices(lang: Lang): Promise<SpeechSynthesisVoice[]> {
  return rankVoices(await installedVoices(), lang);
}

let session = 0;

/** Reads `text` aloud, a sentence at a time, in the best voice installed (or the one chosen in Settings). */
export function speak(text: string, lang: Lang, slow: boolean, onEnd?: () => void) {
  if (!('speechSynthesis' in window)) return onEnd?.();
  window.speechSynthesis.cancel();
  const mine = ++session;
  const parts = sentences(cleanForSpeech(text, lang));
  if (!parts.length) return onEnd?.();

  void installedVoices().then((voices) => {
    if (mine !== session) return; // stopped or replaced while the voices were loading
    const voice = pickVoice(voices as (SpeechSynthesisVoice & VoiceInfo)[], lang, chosen[lang]);
    parts.forEach((part, i) => {
      const utterance = new SpeechSynthesisUtterance(part);
      utterance.lang = voice?.lang ?? voiceLang(lang);
      if (voice) utterance.voice = voice;
      // A touch slower than the default sounds calmer and less hurried.
      utterance.rate = slow ? 0.8 : 0.95;
      utterance.pitch = 1;
      if (i === parts.length - 1) utterance.onend = () => mine === session && onEnd?.();
      utterance.onerror = (e) => {
        // Stopping on purpose is not an error to report twice.
        if (mine === session && e.error !== 'canceled' && e.error !== 'interrupted') onEnd?.();
      };
      window.speechSynthesis.speak(utterance);
    });
  });
}

export function stopSpeaking() {
  session++;
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
