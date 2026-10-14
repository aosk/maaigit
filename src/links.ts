/**
 * Turning web addresses inside text (a calendar event's notes) into links. Only plain http(s)
 * addresses become links: "javascript:", "data:" and the like never do.
 */
const WEB_ADDRESS = /(https?:\/\/[^\s<>"')\]]+)/g;

type Piece = { text: string; link?: string };

/** The text cut into plain pieces and web addresses (each address also given as the link to open). */
export function splitLinks(text: string): Piece[] {
  return text
    .split(WEB_ADDRESS)
    .map((part, i): Piece => (i % 2 ? { text: part, link: safeWebAddress(part) } : { text: part }))
    .filter((piece) => piece.text !== '')
    .map((piece) => (piece.link === undefined ? { text: piece.text } : piece));
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
