import { HttpError } from './routes/http.js';
import { state } from './store.js';
import { cachedTasks } from './asana.js';

/**
 * Speech to text for the assistant's microphone, sent to a transcription service that understands Arabic and English in the
 * same sentence (the phone's own dictation cannot: it listens in one language). Works with any service that offers the
 * OpenAI-style `/audio/transcriptions` address: OpenAI, Groq and others. Off until a key is set.
 */
const KEY = process.env.STT_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
const BASE = (process.env.STT_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
const MODEL = process.env.STT_MODEL ?? 'whisper-1';

export const sttConfigured = Boolean(KEY);

/** What a recording can be: its first bytes decide, never its name or what the browser says it is. */
export function audioKind(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 16) return null;
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ext: 'webm', mime: 'audio/webm' };
  if (buf.toString('latin1', 0, 4) === 'OggS') return { ext: 'ogg', mime: 'audio/ogg' };
  if (buf.toString('latin1', 4, 8) === 'ftyp') return { ext: 'm4a', mime: 'audio/mp4' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return { ext: 'wav', mime: 'audio/wav' };
  if (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' };
  return null;
}

/**
 * A short list of the names and words the speaker is likely to use (people, projects, meetings), so the transcriber spells
 * them right. It also shows the style: Arabic and English in one sentence, which keeps English words in English letters.
 */
export function vocabularyHint(): string {
  const seen = new Set<string>(['MAAI', 'Asana', 'WhatsApp', 'Gmail']);
  const add = (text: string) => {
    for (const w of text.split(/[^\p{L}\p{N}'-]+/u)) if (w.length >= 3 && w.length <= 24 && !/^\d+$/.test(w) && seen.size < 40) seen.add(w);
  };
  for (const f of state.profile.facts) if (f.category === 'person' || f.category === 'work') add(f.text);
  for (const e of state.events.slice(0, 20)) add(e.title);
  for (const task of cachedTasks().slice(0, 15)) add(task.name);
  return `ذكّرني بموعد meeting مع Sara يوم الاثنين. Add a task في Asana. Names: ${[...seen].join(', ')}`.slice(0, 700);
}

let inFlight = 0;

export async function transcribe(audio: Buffer, fetcher: typeof fetch = fetch): Promise<string> {
  if (!sttConfigured) throw new HttpError(503, 'Smart voice is not set up. Add STT_API_KEY on Render.');
  const kind = audioKind(audio);
  if (!kind) throw new HttpError(415, 'That is not a recording MAAI can read.');
  if (inFlight >= 3) throw new HttpError(429, 'Still transcribing. One moment.');
  inFlight++;
  try {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: kind.mime }), `speech.${kind.ext}`);
    form.append('model', MODEL);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    form.append('prompt', vocabularyHint());
    const res = await fetcher(`${BASE}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: form, signal: AbortSignal.timeout(45_000) });
    if (!res.ok) {
      // The provider's message can name the key or account: log it here, say little to the app.
      console.error('Transcription failed', res.status, (await res.text().catch(() => '')).slice(0, 300));
      throw new HttpError(res.status === 401 || res.status === 403 ? 502 : 503, res.status === 401 || res.status === 403 ? 'The voice service did not accept its key. Check STT_API_KEY.' : 'The voice service could not transcribe that. Try again.');
    }
    const body = (await res.json()) as { text?: unknown };
    return typeof body.text === 'string' ? body.text.trim().slice(0, 4000) : '';
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('Transcription error', (error as Error).message);
    throw new HttpError(503, 'The voice service could not be reached. Try again.');
  } finally {
    inFlight--;
  }
}
