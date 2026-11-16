import type { InboxMessage } from '../shared/types.js';
import { botConnected, queueCommand } from './bot.js';
import { save, state } from './store.js';

/**
 * Pictures and PDFs people send on WhatsApp. The device bot only says "a picture came" (never the file); MAAI asks
 * for the file itself only when it is allowed to read it (a team member's picture or PDF, a known courier's picture),
 * within a daily limit per person, and the bot then hands it over once. The file is read and dropped: never saved.
 */

export type FileKind = 'image' | 'pdf';
export interface MediaFile {
  kind: FileKind;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  data: Buffer;
}

/** Most files read in a day from everyone together (cost and abuse cap). */
export const FILES_PER_DAY = 60;
/** How long the bot has to hand a file over before MAAI carries on without it. */
const WAIT_MS = 90_000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const waiting = new Map<string, { kind: FileKind; done: (file: MediaFile | null) => void; timer: ReturnType<typeof setTimeout> }>();

/** What the bytes really are, whatever the sender called them. */
export function sniff(data: Buffer): MediaFile['mime'] | null {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  return null;
}

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Counts one more file for this person today; false when their limit or the day's total is used up. */
function count(phone: string, kind: FileKind, perPerson: number, now: number): boolean {
  const day = dayOf(now);
  for (const [p, use] of Object.entries(state.mediaUse)) if (use.day !== day) delete state.mediaUse[p];
  const total = Object.values(state.mediaUse).reduce((n, use) => n + use.image + use.pdf, 0);
  const mine = (state.mediaUse[phone] ??= { day, image: 0, pdf: 0 });
  if (total >= FILES_PER_DAY || mine[kind] >= perPerson) return false;
  mine[kind] += 1;
  save();
  return true;
}

/**
 * Asks the device bot for the file of this message. Resolves with the file, or null when it is not a kind MAAI
 * reads, the person's daily limit is used up, the bot is away, or the file did not come in time.
 */
export function askForFile(message: InboxMessage, perPerson: Record<FileKind, number>, now = Date.now()): Promise<MediaFile | null> {
  const kind = message.attachment;
  const id = message.externalId?.startsWith('bot:') ? message.externalId.slice(4) : '';
  if ((kind !== 'image' && kind !== 'pdf') || !id || !message.phone || !botConnected() || waiting.has(id)) return Promise.resolve(null);
  if (!(perPerson[kind] > 0) || !count(message.phone, kind, perPerson[kind], now)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = (file: MediaFile | null) => {
      const w = waiting.get(id);
      if (!w) return;
      clearTimeout(w.timer);
      waiting.delete(id);
      resolve(file);
    };
    const timer = setTimeout(() => done(null), WAIT_MS);
    timer.unref?.();
    waiting.set(id, { kind, done, timer });
    try {
      queueCommand({ kind: 'media', text: id, automatic: true }, now);
    } catch {
      done(null);
    }
  });
}

/** The bot hands a file over. Only one MAAI asked for, of the kind it asked for, and really that kind of file. */
export function receiveFile(id: string, data: Buffer): 'taken' | 'not asked for' | 'not a picture or PDF' {
  const w = waiting.get(id);
  if (!w) return 'not asked for';
  const mime = data.length <= MAX_FILE_BYTES ? sniff(data) : null;
  if (!mime || (mime === 'application/pdf') !== (w.kind === 'pdf')) {
    w.done(null);
    return 'not a picture or PDF';
  }
  w.done({ kind: w.kind, mime, data });
  return 'taken';
}

/** The file as Claude takes it. What it shows is someone else's: information, never instructions. */
export function fileBlock(file: MediaFile) {
  const data = file.data.toString('base64');
  return file.mime === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: file.mime, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: file.mime, data } };
}

/** For the tests: forget what is being waited for. */
export function resetMedia(): void {
  for (const w of waiting.values()) clearTimeout(w.timer);
  waiting.clear();
  state.mediaUse = {};
}
