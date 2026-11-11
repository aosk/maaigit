/**
 * Turning web addresses inside text (a calendar event's notes) into links. Only plain http(s)
 * addresses become links: "javascript:", "data:" and the like never do.
 */
const WEB_ADDRESS = /(https?:\/\/[^\s<>"')\]]+)/g;

type Piece = { text: string; link?: string; host?: string };

/** The text cut into plain pieces and web addresses (each address also given as the link to open). */
export function splitLinks(text: string): Piece[] {
  return text
    .split(WEB_ADDRESS)
    .map((part, i): Piece => (i % 2 ? { text: part, link: safeWebAddress(part) } : { text: part }))
    .filter((piece) => piece.text !== '')
    .map((piece) => (piece.link === undefined ? { text: piece.text } : { ...piece, host: realHost(piece.link) }));
}

/** The address if it really is an http(s) one, else undefined. */
export function safeWebAddress(candidate: string): string | undefined {
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Characters that reorder or hide text around them (embeddings, overrides, isolates, directional marks).
 * Removed from names and link text before showing them, so a stranger's text cannot rearrange its neighbours.
 */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
export const stripBidi = (text: string): string => text.replace(BIDI_CONTROLS, '');

/**
 * The host the link really goes to, as the browser reads it: look-alike letters show as "xn--…" and an address
 * written "bank.com@evil.example" shows "evil.example". Shown beside the link's own text, which can say anything.
 */
export function realHost(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return '';
  }
}
