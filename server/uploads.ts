import { randomBytes } from 'node:crypto';
import type { UploadInfo } from '../shared/types.js';
import { HttpError } from './routes/http.js';

/**
 * Photos and PDFs the user attaches in the assistant. They wait here, in memory only, until the next chat
 * message picks them up (once), or 30 minutes pass. They are never written to disk and never kept in the
 * saved conversation: Claude reads them (including the text in them) and the answer is what is kept.
 */

const TTL_MS = 30 * 60_000;
const MAX_FILES = 12;
const MAX_TOTAL = 40 * 1024 * 1024;
const MAX_PER_MESSAGE = 4;
const LIMIT = { image: 5 * 1024 * 1024, pdf: 10 * 1024 * 1024 };

interface Upload extends UploadInfo {
  mime: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'application/pdf';
  data: Buffer;
  at: number;
}

export type { Upload };
const held = new Map<string, Upload>();

/** What a file really is, from its first bytes (the name and the type the browser claims prove nothing). */
export function sniff(data: Buffer): { kind: 'image' | 'pdf'; mime: Upload['mime'] } | null {
  if (data.length < 12) return null;
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', mime: 'image/png' };
  if (data.subarray(0, 4).toString('latin1') === 'GIF8') return { kind: 'image', mime: 'image/gif' };
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (data.subarray(0, 5).toString('latin1') === '%PDF-') return { kind: 'pdf', mime: 'application/pdf' };
  return null;
}

/** A name safe to show and to hand to Claude: no paths, control characters or tag-like text. */
export function cleanName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f​-‏‪-‮<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned || 'file';
}

function sweep(now: number) {
  for (const [id, u] of held) if (now - u.at > TTL_MS) held.delete(id);
}

export function saveUpload(data: Buffer, name: string, now = Date.now()): UploadInfo {
  sweep(now);
  const type = sniff(data);
  if (!type) throw new HttpError(415, 'Only photos (JPEG, PNG, WebP, GIF) and PDF documents can be attached.');
  if (data.length > LIMIT[type.kind]) throw new HttpError(413, type.kind === 'pdf' ? 'That PDF is larger than 10 MB.' : 'That photo is larger than 5 MB.');
  const total = [...held.values()].reduce((a, u) => a + u.data.length, 0);
  if (held.size >= MAX_FILES || total + data.length > MAX_TOTAL) throw new HttpError(429, 'Too many files waiting. Send your message first, then attach more.');
  const id = randomBytes(9).toString('base64url');
  const upload: Upload = { id, name: cleanName(name), kind: type.kind, mime: type.mime, bytes: data.length, data, at: now };
  held.set(id, upload);
  return { id, name: upload.name, kind: upload.kind, bytes: upload.bytes };
}

/** The files for a chat message. An id that is unknown or has expired is an error the person can act on. They stay held until `releaseUploads`, so a failed message can be sent again. */
export function takeUploads(ids: unknown, now = Date.now()): Upload[] {
  sweep(now);
  if (ids === undefined || (Array.isArray(ids) && ids.length === 0)) return [];
  if (!Array.isArray(ids) || ids.length > MAX_PER_MESSAGE || ids.some((i) => typeof i !== 'string')) throw new HttpError(400, `You can attach up to ${MAX_PER_MESSAGE} files to a message.`);
  const found = (ids as string[]).map((id) => held.get(id));
  if (found.some((u) => !u)) throw new HttpError(410, 'An attached file expired. Attach it again.');
  return found as Upload[];
}

/** Lets go of files once their message has been answered. */
export function releaseUploads(files: { id: string }[]) {
  for (const f of files) held.delete(f.id);
}

/** For tests. */
export const heldCount = () => held.size;
export function forgetUploads() {
  held.clear();
}
