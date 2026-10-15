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
