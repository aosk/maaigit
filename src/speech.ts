import type { Lang } from '../shared/types';

import { assembleHeard, cleanForSpeech, pickVoice, rankVoices, scriptOf, sentences, type VoiceInfo } from './voice';

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
let unlocked = false;

/**
 * iPhone Safari speaks only after speech was first started from a tap. A reply arrives seconds after the tap (after the
 * server answers), so without this it is silently dropped. Call from a tap: it speaks nothing, once, and unlocks the voice.
 */
/**
 * Resolves once the silent "unlock" phrase is over (at once when it was said before). On the iPhone, speaking and
 * listening share one audio channel: a microphone opened while that phrase is still "playing" hears nothing, which
 * is why the very first tap on the microphone used to fail. Wait for this before listening.
 */
let unlocking: Promise<void> | null = null;

export function unlockSpeech(): Promise<void> {
  // Asked again while the phrase is still being said (the "talk" shortcut, then the microphone): the same wait.
  if (unlocking) return unlocking;
  if (unlocked || !('speechSynthesis' in window)) return Promise.resolve();
  unlocked = true;
  unlocking = new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // Never left waiting: some browsers do not report the end of an empty phrase.
    setTimeout(finish, 700);
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.onend = finish;
      u.onerror = finish;
      window.speechSynthesis.speak(u);
    } catch {
      unlocked = false;
      finish();
    }
  }).finally(() => {
    unlocking = null;
  });
  return unlocking;
}

/** When something was last being read aloud (0 = never). */
let lastSpokeAt = 0;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves when the microphone can hear: nothing is being read aloud, and the phone has had a moment to hand the
 * sound channel back. On the iPhone a microphone opened while a reply is still being read (or in the instant after it
 * is cut off) hears nothing, which is why speaking to the assistant a second time, over its spoken answer, went deaf.
 * Stops whatever is being read. Never waits more than about two seconds.
 */
export async function speechQuiet(): Promise<void> {
  if (!('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  const wasSpeaking = synth.speaking || synth.pending || (lastSpokeAt > 0 && Date.now() - lastSpokeAt < 1500);
  // Whatever is being read stops at once (the user is about to speak).
  session++;
  synth.cancel();
  // The very first time, the silent unlock phrase is said: the phone needs the same moment to let go after it.
  const firstTime = !unlocked;
  await unlockSpeech();
  if (!wasSpeaking && !firstTime) return;
  for (let waited = 0; waited < 1500 && (synth.speaking || synth.pending); waited += 50) await pause(50);
  // The phone lets go of the speaker a moment after it says it has stopped.
  await pause(400);
}

/** Queues sentences to be read aloud in this session, each in the voice of its own language. */
function say(parts: string[], mine: number, onEnd?: () => void) {
  if (!parts.length) return onEnd?.();
  void installedVoices().then((voices) => {
    if (mine !== session) return; // stopped or replaced while the voices were loading
    const all = voices as (SpeechSynthesisVoice & VoiceInfo)[];
    parts.forEach((part, i) => {
      // A sentence written mostly in the other language is read in that language's voice (an English sentence in an
      // Arabic reply is not read with an Arabic accent).
      const partLang = scriptOf(part);
      const voice = pickVoice(all, partLang, chosen[partLang]);
      const utterance = new SpeechSynthesisUtterance(part);
      utterance.lang = voice?.lang ?? voiceLang(partLang);
      if (voice) utterance.voice = voice;
      // A touch slower than the default sounds calmer and less hurried.
      utterance.rate = slowSpeech ? 0.8 : 0.95;
      utterance.pitch = 1;
      if (i === parts.length - 1) utterance.onend = () => mine === session && onEnd?.();
      utterance.onerror = (e) => {
        // Stopping on purpose is not an error to report twice.
        if (mine === session && e.error !== 'canceled' && e.error !== 'interrupted') onEnd?.();
      };
      utterance.onstart = () => (lastSpokeAt = Date.now());
      const ended = utterance.onend;
      utterance.onend = (e) => {
        lastSpokeAt = Date.now();
        ended?.call(utterance, e);
      };
      lastSpokeAt = Date.now();
      window.speechSynthesis.speak(utterance);
    });
  });
}

let slowSpeech = false;

/** Reads `text` aloud, a sentence at a time, in the best voice installed (or the one chosen in Settings). */
export function speak(text: string, lang: Lang, slow: boolean, onEnd?: () => void) {
  if (!('speechSynthesis' in window)) return onEnd?.();
  window.speechSynthesis.cancel();
  const mine = ++session;
  slowSpeech = slow;
  say(sentences(cleanForSpeech(text, lang)), mine, onEnd);
}

/** Where a finished sentence ends in text still arriving: after . ! ? ؟ or a line break, followed by more text. */
const SENTENCE_END = /[.!?؟۔…\n](?=\s)/g;

/**
 * Reads a reply aloud while it is still being written: each finished sentence is spoken as soon as it arrives, so the
 * answer starts within a second or two instead of after the whole reply. `push` takes each new piece of text, `end`
 * reads what is left; `spoke` says whether anything was read, so the caller does not read the whole reply again.
 */
export function speechStream(lang: Lang, slow: boolean) {
  const can = 'speechSynthesis' in window;
  if (can) window.speechSynthesis.cancel();
  const mine = can ? ++session : session;
  slowSpeech = slow;
  let buffer = '';
  let spoke = false;
  const flush = (text: string) => {
    const parts = sentences(cleanForSpeech(text, lang));
    if (!can || !parts.length || mine !== session) return;
    spoke = true;
    say(parts, mine);
  };
  return {
    push(piece: string) {
      buffer += piece;
      let cut = -1;
      for (const m of buffer.matchAll(SENTENCE_END)) cut = m.index + 1;
      // Wait for a sentence of some length, so the voice does not stop after every short word.
      if (cut >= 24) {
        flush(buffer.slice(0, cut));
        buffer = buffer.slice(cut);
      }
    },
    end() {
      if (buffer.trim()) flush(buffer);
      buffer = '';
    },
    get spoke() {
      return spoke;
    },
    /** Whether this is still the voice playing (not stopped or replaced). */
    get current() {
      return mine === session;
    },
  };
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
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

const Ctor = (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

export const canListen = Boolean(Ctor);
const ANDROID = /Android/i.test(navigator.userAgent);

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
  /** `why` is the browser's own word for what went wrong (network, audio-capture and so on), when it gave one. */
  onEnd: (problem?: ListenProblem, why?: string, trace?: string) => void,
  /** `onOpen` is called when the phone has really opened the microphone (which can take seconds after the tap). */
  opts: { silenceMs?: number; onOpen?: () => void } = {},
): () => void {
  if (!Ctor) {
    onEnd('unsupported');
    return () => {};
  }
  const silenceMs = opts.silenceMs ?? 2500;
  let finished = false;
  let stopping = false;
  let problem: ListenProblem | undefined;
  let why: string | undefined;
  let kept = ''; // finished phrases from earlier rounds
  let current = ''; // what this round has heard so far
  let heardAnything = false;
  let rec: Recognition | null = null;
  let silence: ReturnType<typeof setTimeout> | undefined;
  const limit = setTimeout(() => stop(), 120_000);
  const began = Date.now();
  // What the phone reported, for finding out why nothing was heard: when listening started, when the microphone
  // really opened, whether any sound and any speech were noticed, how many rounds. Times and yes/no only.
  const seen = { start: -1, audio: -1, sound: false, speech: false, rounds: 0 };
  const giveUp = () => {
    if (!heardAnything) {
      problem = 'no-speech';
      stop();
    }
  };
  // Give up waiting for the first word after 8 seconds of quiet, counted from when the microphone really opened
  // (the phone can take several seconds to open it); 15 seconds after the tap whatever happens.
  let firstWord: ReturnType<typeof setTimeout> | undefined = setTimeout(giveUp, 15_000);

  const text = () => `${kept} ${current}`.replace(/\s+/g, ' ').trim();

  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(limit);
    clearTimeout(silence);
    clearTimeout(firstWord);
    const trace = `start=${seen.start} audio=${seen.audio} sound=${seen.sound ? 1 : 0} speech=${seen.speech ? 1 : 0} rounds=${seen.rounds} ms=${Date.now() - began} spoke=${lastSpokeAt ? Date.now() - lastSpokeAt : -1}${why ? ` err=${why}` : ''}`;
    onEnd(heardAnything ? undefined : problem ?? 'no-speech', heardAnything ? undefined : why, heardAnything ? undefined : trace);
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
    // Android's recogniser, when left listening, reports the whole sentence again in every result. Asking for one
    // sentence at a time (and restarting, below) avoids that; the iPhone and computers are fine as they are.
    r.continuous = !ANDROID;
    seen.rounds += 1;
    r.onstart = () => {
      if (seen.start < 0) seen.start = Date.now() - began;
      // A browser that never says the microphone opened: taken as open a moment after listening started.
      setTimeout(() => !finished && seen.audio < 0 && opts.onOpen?.(), 2500);
    };
    r.onaudiostart = () => {
      if (seen.audio >= 0) return;
      seen.audio = Date.now() - began;
      opts.onOpen?.();
      if (!heardAnything) {
        clearTimeout(firstWord);
        firstWord = setTimeout(giveUp, 8000);
      }
    };
    r.onsoundstart = () => (seen.sound = true);
    r.onspeechstart = () => (seen.speech = true);
    r.onresult = (e) => {
      current = assembleHeard(Array.from(e.results).map((res) => ({ text: res[0].transcript, final: res.isFinal })));
      if (current.trim()) {
        if (!heardAnything) opts.onOpen?.();
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
      // "no-speech" and "aborted" are the ordinary ends of a quiet round; anything else is worth telling the user.
      if (e.error && e.error !== 'no-speech' && e.error !== 'aborted') why = String(e.error).slice(0, 40);
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
