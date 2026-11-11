/**
 * The text of an HTML email as a person sees it. A sender can hide words from the reader with CSS and still have a
 * model read them (display:none, size 0, white on white ...), so those are left out before anything reaches Claude.
 * Best effort, not a browser: it understands inline styles and a few attributes, not style sheets or classes, and a
 * determined sender can still find a way to hide text. What it stops is the common tricks. The model is also told
 * that email text is never an order, and nothing it proposes happens without the owner's tap.
 */

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
// Elements whose content is never shown as reading text.
const SKIPPED = ['script', 'style', 'head', 'title', 'template', 'noscript', 'svg', 'object', 'iframe', 'textarea', 'select'];
const BLOCK = new Set(['p', 'div', 'li', 'tr', 'table', 'ul', 'ol', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

const decode = (text: string) =>
  text.replace(/&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z]+));/gi, (all, dec: string, hex: string, name: string) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? all;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });

const WHITE = /^(?:#f{3}|#f{6}|#f{8}|white|rgba?\(\s*255\s*,\s*255\s*,\s*255\b.*\)|hsl\(\s*\d+\s*,\s*\d+%\s*,\s*100%.*\))$/i;
const ZERO = /^[+-]?0*\.?0*(?:px|pt|em|rem|%|ex|vh|vw)?$/i;
// Anything this small is not read by a person either.
const TINY = /^[+-]?0*\.?\d{0,3}(?:px|pt)?$/i;

function parseStyle(style: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of style.replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const i = part.indexOf(':');
    if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/!important/i, '').trim().toLowerCase();
  }
  return out;
}

interface Look { hidden: boolean; bg: string }

/** Whether this element's own attributes hide it, and the background it sets (white when none is known). */
function look(name: string, attrs: Record<string, string>, parentBg: string): Look {
  const s = parseStyle(attrs.style ?? '');
  const bg = s['background-color'] ?? s.background?.split(/\s+/).find((w) => WHITE.test(w) || w.startsWith('#') || w.startsWith('rgb')) ?? attrs.bgcolor?.toLowerCase() ?? parentBg;
  const color = s.color ?? attrs.color?.toLowerCase();
  const num = (v: string | undefined) => v !== undefined && ZERO.test(v);
  const clipped = (s.overflow ?? '').startsWith('hidden') || (s['overflow-x'] ?? '') === 'hidden' || (s['overflow-y'] ?? '') === 'hidden';
  const hidden =
    'hidden' in attrs ||
    // A collapsed <details> shows only its summary: the rest is not on screen (its summary is dropped too, which is safe).
    (name === 'details' && !('open' in attrs)) ||
    (s.clip !== undefined && /rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)/.test(s.clip)) ||
    (s['clip-path'] !== undefined && /inset\(\s*(?:50|100)%|circle\(\s*0/.test(s['clip-path'])) ||
    attrs['aria-hidden'] === 'true' ||
    s.display === 'none' ||
    s.visibility === 'hidden' || s.visibility === 'collapse' ||
    (s['font-size'] !== undefined && TINY.test(s['font-size'])) ||
    (s.font !== undefined && /^(?:[\w\s-]*\s)?0(?:px|pt|em|%)?\//.test(s.font)) ||
    (s.opacity !== undefined && Number(s.opacity) === 0) ||
    ((num(s.height) || num(s['max-height']) || num(s.width) || num(s['max-width'])) && clipped) ||
    (s['text-indent'] !== undefined && /^-\d{3,}/.test(s['text-indent'])) ||
    (/^(?:absolute|fixed)$/.test(s.position ?? '') && [s.left, s.top, s.right].some((v) => v !== undefined && /^-\d{3,}/.test(v))) ||
    (color !== undefined && WHITE.test(color) && WHITE.test(bg));
  return { hidden, bg: WHITE.test(bg) || bg.startsWith('#') || bg.startsWith('rgb') || bg === 'transparent' ? bg : parentBg };
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

export function visibleText(html: string): string {
  const out: string[] = [];
  const stack: { name: string; hidden: boolean; bg: string }[] = [];
  let hiddenDepth = 0;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0 || lt > i) {
      const text = html.slice(i, lt < 0 ? undefined : lt);
      if (!hiddenDepth) out.push(decode(text));
      if (lt < 0) break;
      i = lt;
    }
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const tag = /^<(\/?)([a-z][a-z0-9:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>?/i.exec(html.slice(i, i + 20_000));
    if (!tag) {
      // "<!doctype", "<?xml", or a lone "<" in text
      const end = html.indexOf('>', i);
      if (/^<[!?]/.test(html.slice(i, i + 2)) && end > 0) i = end + 1;
      else {
        if (!hiddenDepth) out.push('<');
        i += 1;
      }
      continue;
    }
    i += tag[0].length;
    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();
    if (!closing && SKIPPED.includes(name)) {
      const end = html.toLowerCase().indexOf(`</${name}`, i);
      const close = end < 0 ? -1 : html.indexOf('>', end);
      i = close < 0 ? html.length : close + 1;
      continue;
    }
    if (BLOCK.has(name) || name === 'br') out.push('\n');
    if (closing) {
      const at = stack.map((e) => e.name).lastIndexOf(name);
      if (at < 0) continue;
      for (const gone of stack.splice(at)) if (gone.hidden) hiddenDepth -= 1;
      continue;
    }
    if (VOID.has(name) || tag[0].endsWith('/>')) continue;
    const l = look(name, parseAttrs(tag[3]), stack.at(-1)?.bg ?? 'white');
    stack.push({ name, hidden: l.hidden, bg: l.bg });
    if (l.hidden) hiddenDepth += 1;
  }
  return out.join('').replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
