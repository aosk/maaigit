import { randomUUID } from 'node:crypto';
import type { Lang } from '../shared/types.js';
import { botConnected, queueCommand } from './bot.js';
import { state } from './store.js';

/**
 * What the user says to the assistant in the app, written out. The app records the sound itself and sends it here;
 * MAAI hands it to the device bot, which writes it out on the user's own computer (the same speech model that
 * writes out WhatsApp voice notes) and sends the words back. The recording is held in memory for that moment only:
 * never saved, never sent to an outside service.
 */

/** How long the bot has to write a recording out before the app is told to type instead. */
const WAIT_MS = 45_000;
/** 60 seconds of 16-bit sound at 16,000 samples a second, and its header. */
export const MAX_WAV_BYTES = 60 * 16_000 * 2 + 44;
/** The bot asks for commands every 25 seconds or so: silent for longer than this, it is taken as away. */
const BOT_AWAY_MS = 90_000;
const AT_ONCE = 3;

type HeardWhy = 'bot-away' | 'not-ready' | 'busy' | 'bad-audio' | 'empty' | 'timeout' | 'error';
type Heard = { text: string } | { why: HeardWhy };

const waiting = new Map<string, { audio: Buffer; lang: Lang; done: (out: Heard) => void; timer: ReturnType<typeof setTimeout> }>();

/** Whether the sound is what the app sends: a plain WAV, one channel, 16-bit, 16,000 samples a second. */
export function plainWav(data: Buffer): boolean {
  if (data.length < 44 + 3200 || data.length > MAX_WAV_BYTES) return false; // under a tenth of a second says nothing
  if (data.toString('latin1', 0, 4) !== 'RIFF' || data.toString('latin1', 8, 12) !== 'WAVE' || data.toString('latin1', 12, 16) !== 'fmt ') return false;
  return data.readUInt16LE(20) === 1 && data.readUInt16LE(22) === 1 && data.readUInt32LE(24) === 16_000 && data.readUInt16LE(34) === 16;
}

/** Whether what is said in the app can be written out right now: the bot is there and its speech model is not off. */
export function canHear(now = Date.now()): boolean {
  const { lastSeen, voice } = state.bot;
  if (!botConnected() || !lastSeen || now - Date.parse(lastSeen) > BOT_AWAY_MS) return false;
  return voice?.state !== 'off' && voice?.state !== 'installing';
}

/** Hands a recording to the bot and waits for its words. Always answers: with the words, or with why not. */
export function hear(audio: Buffer, lang: Lang, now = Date.now()): Promise<Heard> {
  if (!plainWav(audio)) return Promise.resolve({ why: 'bad-audio' });
  if (!canHear(now)) return Promise.resolve({ why: botConnected() && state.bot.voice?.state ? 'not-ready' : 'bot-away' });
  if (waiting.size >= AT_ONCE) return Promise.resolve({ why: 'busy' });
  const id = randomUUID();
  return new Promise((resolve) => {
    const done = (out: Heard) => {
      const w = waiting.get(id);
      if (!w) return;
      clearTimeout(w.timer);
      waiting.delete(id);
      resolve(out);
    };
    const timer = setTimeout(() => done({ why: 'timeout' }), WAIT_MS);
    timer.unref?.();
    waiting.set(id, { audio, lang, done, timer });
    try {
      queueCommand({ kind: 'stt', text: id, automatic: true }, now);
    } catch {
      done({ why: 'bot-away' });
    }
  });
}

/** The bot comes for the recording it was told about. Given once. */
export function audioFor(id: string): { audio: Buffer; lang: Lang } | null {
  const w = waiting.get(id);
  if (!w || !w.audio.length) return null;
  const out = { audio: w.audio, lang: w.lang };
  w.audio = Buffer.alloc(0);
  return out;
}

/** The bot's answer: the words, or (no words) why not. False when MAAI was not waiting for it. */
export function heard(id: string, text: string, why?: string): boolean {
  const w = waiting.get(id);
  if (!w) return false;
  const words = text.replace(/\s+/g, ' ').trim().slice(0, 2000);
  w.done(words ? { text: words } : { why: why === 'not-ready' || why === 'empty' ? why : 'error' });
  return true;
}

/** For the tests: forget what is being waited for. */
export function resetStt(): void {
  for (const w of waiting.values()) clearTimeout(w.timer);
  waiting.clear();
}
