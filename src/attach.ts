/**
 * Getting a photo or PDF ready to send to the assistant. A phone photo is several megabytes, far more than
 * is needed to read it, so images are shrunk (the longest side to 1800 pixels) and sent as JPEG; PDFs go as they are.
 */

export type AttachKind = 'image' | 'pdf';

export class AttachError extends Error {
  constructor(readonly reason: 'unsupported' | 'too-big') {
    super(reason);
  }
}

const MAX_SIDE = 1800;
const MAX_PDF = 10 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;

/** The size to scale to: never bigger than the original, longest side at most `max`. */
function fitSize(width: number, height: number, max = MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

export async function prepare(file: File): Promise<{ blob: Blob; name: string; kind: AttachKind }> {
  if (isPdf(file)) {
    if (file.size > MAX_PDF) throw new AttachError('too-big');
    return { blob: file.type === 'application/pdf' ? file : new Blob([file], { type: 'application/pdf' }), name: file.name, kind: 'pdf' };
  }
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name)) throw new AttachError('unsupported');

  const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
  try {
    // "from-image" turns a sideways phone photo upright, as the person saw it.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = fitSize(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    ctx.fillStyle = '#fff'; // a transparent PNG would turn black as a JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('no jpeg');
    return { blob, name: `${base}.jpg`, kind: 'image' };
  } catch {
    // The browser could not decode it: send the original if it is a kind and size the server accepts.
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.type) && file.size <= MAX_IMAGE) return { blob: file, name: file.name, kind: 'image' };
    throw new AttachError('unsupported');
  }
}
