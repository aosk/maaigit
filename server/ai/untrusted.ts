import { randomBytes } from 'node:crypto';

/**
 * Words written by other people (an email, a calendar invite, an Asana comment) are handed to Claude
 * inside tags such as <email_content> and <context>, with an instruction that they are information,
 * never orders. That only holds if the text cannot close the tag itself and carry on as if it were
 * outside it, so any tag-like opening or closing of our own tags is defused here.
 */

// Invisible characters can sit inside a tag name or after the "<" and still be read as a tag by a model.
const JUNK = String.raw`[\s\p{Cc}\p{Cf}]*`;
// Our own fences plus the structural names models know from their own formats (tool results, turns, thinking).
const NAMES = 'email_content|asana_task|news_item|device_output|about_the_user|context|message|user_message|untrusted|system|assistant|user|human|instructions?|tool_result|tool_use|tool_call|function_results?|function_calls?|invoke|thinking|document|documents|antml\\S*';
// "<" and its look-alikes (full-width, angle quotes) are all defused, so "＜/system＞" cannot pass either.
const OUR_TAGS = new RegExp(String.raw`[<＜〈](?=${JUNK}\/?${JUNK}(?:${NAMES})(?![\p{L}\p{N}]))`, 'giu');
// A chat-turn marker at the start of a line ("Human: ...") is how some prompt formats switch speakers.
const TURN_MARKER = /^([ \t]*)(human|assistant)([ \t]*):/gim;

export const neutralize = (text: string): string =>
  text
    .replace(/\0/g, '')
    .replace(OUR_TAGS, '‹')
    .replace(TURN_MARKER, '$1$2 ‹›$3:');

// Characters that change what a line looks like without being visible: all of "format" (Cf: zero-width, bidi
// overrides and isolates U+202A-202E / U+2066-2069, LRM/RLM, soft hyphen, tag characters, BOM) except ZWNJ and ZWJ.
// ZWNJ (U+200C) is needed to spell Persian and some Arabic-script words correctly, and ZWJ (U+200D) joins emoji and
// Indic letters, so a real name can contain them. They hide nothing visible on their own; runs of them are collapsed.
const INVISIBLE = /(?![‌‍])[\p{Cf}]/gu;
// Line and paragraph separators and every control character (NUL, tab, CR, LF, NEL ...) become a plain space.
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/** Removes the invisible and direction-changing characters, keeping line breaks and everything visible. */
export const stripInvisible = (text: string): string => text.replace(INVISIBLE, '');

/**
 * Text written by a stranger (a sender's name, a subject, a message) made safe to print as ONE visible line:
 * no line breaks (so it cannot forge extra lines in an approval message or a context list), no control, bidi or
 * zero-width characters (so it cannot reorder or hide text), and at most `max` characters. Letters, digits,
 * spaces and punctuation of any language are kept.
 */
export function cleanText(text: unknown, max = 100): string {
  if (typeof text !== 'string') return '';
  const one = text
    .replace(INVISIBLE, '')
    .replace(BREAKS, ' ')
    .replace(/[‌‍]{2,}/g, '‌')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(one);
  return chars.length > max ? `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…` : one;
}

/** cleanText, then defused like any text from other people: what goes into the assistant's context. */
export const untrustedLine = (text: unknown, max = 100): string => neutralize(cleanText(text, max));

// Only this server process knows it, so no email or message can repeat it to close the fence.
const FENCE_ID = randomBytes(6).toString('hex');

/** Wraps lines that other people wrote in an explicit fence, so a forged "SYSTEM NOTE" cannot pass as the app's own context. */
export const untrustedBlock = (source: string, lines: string[]): string =>
  `<untrusted source="${source}" id="${FENCE_ID}">\n${lines.join('\n')}\n</untrusted>`;
