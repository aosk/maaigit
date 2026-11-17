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

/**
 * An outside speech service, used first when its key is set (so voice works with the computer off). Either
 * GROQ_API_KEY or OPENAI_API_KEY: both take the same request. With a key set, the recording does leave MAAI for that
 * service; without one it never does.
 */
function cloud(): { url: string; key: string; model: string } | null {
  const groq = process.env.GROQ_API_KEY?.trim();
  if (groq) return { url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: groq, model: process.env.STT_MODEL?.trim() || 'whisper-large-v3-turbo' };
  const openai = process.env.OPENAI_API_KEY?.trim();
  if (openai) return { url: 'https://api.openai.com/v1/audio/transcriptions', key: openai, model: process.env.STT_MODEL?.trim() || 'whisper-1' };
  return null;
}

/** The words from the outside service, or null when it failed (the bot is tried next). `ask` is fetch, swapped in tests. */
async function hearCloud(audio: Buffer, lang: Lang, ask: typeof fetch = fetch): Promise<string | null> {
  const service = cloud();
  if (!service) return null;
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'said.wav');
    form.append('model', service.model);
    form.append('language', lang);
    form.append('response_format', 'json');
    const res = await ask(service.url, { method: 'POST', headers: { authorization: `Bearer ${service.key}` }, body: form, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.log(`Hear: the speech service answered ${res.status}`);
      return null;
    }
    const text = ((await res.json()) as { text?: unknown }).text;
    return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 2000) : null;
  } catch (error) {
    console.log(`Hear: the speech service failed (${(error as Error).name})`);
    return null;
  }
}

/** The bot is there and its speech model is not off. */
function botCanHear(now: number): boolean {
  const { lastSeen, voice } = state.bot;
  if (!botConnected() || !lastSeen || now - Date.parse(lastSeen) > BOT_AWAY_MS) return false;
  return voice?.state !== 'off' && voice?.state !== 'installing';
}

/** Whether what is said in the app can be written out right now: by the outside service, or by the bot. */
export function canHear(now = Date.now()): boolean {
  return Boolean(cloud()) || botCanHear(now);
}

/** Hands a recording to the bot and waits for its words. Always answers: with the words, or with why not. */
export async function hear(audio: Buffer, lang: Lang, now = Date.now(), ask: typeof fetch = fetch): Promise<Heard> {
  if (!plainWav(audio)) return { why: 'bad-audio' };
  if (cloud()) {
    const text = await hearCloud(audio, lang, ask);
    if (text) return { text };
    if (text === '') return { why: 'empty' };
    if (!botCanHear(now)) return { why: 'error' };
  }
  return hearBot(audio, lang, now);
}

function hearBot(audio: Buffer, lang: Lang, now: number): Promise<Heard> {
  if (!botCanHear(now)) return Promise.resolve({ why: botConnected() && state.bot.voice?.state ? 'not-ready' : 'bot-away' });
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
