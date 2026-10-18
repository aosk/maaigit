import type { Lang } from '../shared/types';

/**
 * Choosing and preparing a voice for reading aloud. The phone's built-in voices vary a lot: the small
 * "compact" ones sound robotic, while the downloadable "Enhanced" and "Premium" ones sound human. These
 * pure helpers pick the best one installed and break text up so it is read with natural pauses.
 */

export interface VoiceInfo {
  name: string;
  voiceURI: string;
  lang: string;
  localService?: boolean;
}

export type Quality = 'premium' | 'enhanced' | 'natural' | 'standard' | 'basic';

/** Joke and effect voices that come with iPhones and Macs: never a good choice for reading a day aloud. */
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|princess|ralph|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

export function qualityOf(voice: VoiceInfo): Quality {
  const text = `${voice.name} ${voice.voiceURI}`;
  if (/premium/i.test(text)) return 'premium';
  if (/enhanced/i.test(text)) return 'enhanced';
  if (/natural|neural|online|siri/i.test(text)) return 'natural';
  if (/compact/i.test(text)) return 'basic';
  return 'standard';
}

const QUALITY_SCORE: Record<Quality, number> = { premium: 60, natural: 55, enhanced: 45, standard: 20, basic: 0 };

/** Voices known to sound good for each language, as a small tie-breaker. */
const FAVOURITES: Record<Lang, RegExp> = {
  ar: /maged|majed|tarik|laila|naayf|hamed|zariyah|salma|shakir/i,
  en: /ava|zoe|serena|samantha|daniel|oliver|stephanie|allison|susan|karen|moira|tessa|libby|sonia|jenny|aria|guy/i,
};

const matchesLang = (voice: VoiceInfo, lang: Lang) => voice.lang.toLowerCase().replace('_', '-').startsWith(lang);

/** How good a voice is for reading `lang`; higher is better. */
export function scoreVoice(voice: VoiceInfo, lang: Lang): number {
  if (!matchesLang(voice, lang) || NOVELTY.test(voice.name)) return -1;
  let score = QUALITY_SCORE[qualityOf(voice)];
  if (FAVOURITES[lang].test(voice.name)) score += 10;
  // The home region first: Saudi Arabic, then British or American English.
  const region = voice.lang.toLowerCase().replace('_', '-');
  if (lang === 'ar' && region === 'ar-sa') score += 8;
  if (lang === 'en' && (region === 'en-gb' || region === 'en-us')) score += 4;
  // A voice that is already on the phone starts at once and works offline.
  if (voice.localService) score += 2;
  return score;
}

/** Usable voices for a language, best first. */
export function rankVoices<T extends VoiceInfo>(voices: T[], lang: Lang): T[] {
  return voices
    .map((voice) => ({ voice, score: scoreVoice(voice, lang) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.voice.name.localeCompare(b.voice.name))
    .map((x) => x.voice);
}

/** The voice to use: the one the person picked if it is still installed, otherwise the best available. */
export function pickVoice<T extends VoiceInfo>(voices: T[], lang: Lang, chosenURI?: string): T | undefined {
  const ranked = rankVoices(voices, lang);
  return ranked.find((v) => v.voiceURI === chosenURI) ?? ranked[0];
}

// ---------- The text ----------

/** Words as they should be spoken: no emoji, markdown marks or web addresses read out letter by letter. */
export function cleanForSpeech(text: string, lang: Lang): string {
  return text
    .replace(/https?:\/\/\S+/gi, lang === 'ar' ? 'رابط' : 'link')
    .replace(/[*_`#>~|]+/g, ' ')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\s*[\r\n]+\s*/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

/**
 * Splits text into sentences. Each one is spoken on its own, so the voice pauses where a person would,
 * and nothing is long enough for the phone to cut off (iPhones stop long passages after about 15 seconds).
 */
export function sentences(text: string, maxLength = 200): string[] {
  const parts = text.match(/[^.!?؟۔…]+[.!?؟۔…]*/g) ?? [text];
  const out: string[] = [];
  for (const raw of parts) {
    let part = raw.trim();
    if (!part) continue;
    // A very long sentence is cut at a comma or a space rather than mid-word.
    while (part.length > maxLength) {
      const cut = Math.max(part.lastIndexOf(',', maxLength), part.lastIndexOf('،', maxLength), part.lastIndexOf(' ', maxLength));
      const at = cut > maxLength / 2 ? cut + 1 : maxLength;
      out.push(part.slice(0, at).trim());
      part = part.slice(at).trim();
    }
    if (part) out.push(part);
  }
  return out;
}

// ---------- What the microphone heard ----------

export interface Heard {
  text: string;
  final: boolean;
}

const words = (text: string) => text.trim().toLowerCase().split(/\s+/).filter(Boolean);

/** Edit distance between two words (small words only, so the plain method is fine). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

const near = (x: string, y: string) => x === y || distance(x, y) <= Math.max(1, Math.floor(Math.min(x.length, y.length) * 0.3));

/** True when `next` is a longer or corrected version of the same sentence as `prev`: every word they share a place in is the same or a near miss. */
function sameSentence(prev: string, next: string): boolean {
  const a = words(prev);
  const b = words(next);
  const n = Math.min(a.length, b.length);
  if (n === 0) return false;
  for (let i = 0; i < n; i++) if (!near(a[i], b[i])) return false;
  return true;
}

/** "no no no no no" → "no": a recogniser stuck on a word. Up to three in a row are real speech; more are not. */
export function collapseRepeats(text: string): string {
  const out: string[] = [];
  let run = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    run = out.length && out[out.length - 1].toLowerCase() === word.toLowerCase() ? run + 1 : 1;
    if (run <= 3) out.push(word);
  }
  const joined = out.join(' ');
  // Stuck on one word 4 or more times: keep one.
  return text.split(/\s+/).filter(Boolean).length > out.length ? joined.replace(/\b(\S+)(?:\s+\1\b){2,}/gi, '$1') : joined;
}

/**
 * The sentence the person said, from the list a speech recogniser reports.
 * On Android the list repeats itself: each entry is the whole sentence so far ("hello", "hello how", "hello how are"),
 * and adding them up says the first word dozens of times. Entries that grow the previous one replace it; entries that
 * are genuinely new sentences are added after it.
 */
export function assembleHeard(items: Heard[]): string {
  const kept: string[] = [];
  for (const { text } of items) {
    const t = text.trim();
    if (!t) continue;
    const last = kept[kept.length - 1];
    if (last !== undefined && sameSentence(last, t)) {
      // The same sentence again: keep the longer, or the newer when they are as long (the recogniser corrected itself).
      if (t.length >= last.length || words(t).length >= words(last).length) kept[kept.length - 1] = t;
    } else kept.push(t);
  }
  return collapseRepeats(kept.join(' '));
}

/** Which script a piece of text is mostly written in. Arabic letters count as Arabic; everything else is English. */
export function scriptOf(text: string): Lang {
  let arabic = 0;
  let latin = 0;
  for (const ch of text) {
    if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(ch)) arabic++;
    else if (/[A-Za-z]/.test(ch)) latin++;
  }
  if (!arabic && !latin) return 'en';
  return arabic >= latin ? 'ar' : 'en';
}
