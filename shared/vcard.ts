/**
 * Reads a contacts file (.vcf, as iCloud, an iPhone, Android or Google export it) into names, numbers,
 * emails and companies. Photos, addresses, notes and everything else are left out. Runs in the browser,
 * so only the few fields MAAI needs ever leave the device.
 */

export interface AddressCard {
  name: string;
  /** International form, digits only. */
  phones: string[];
  emails: string[];
  org?: string;
}

/** Digits in international form; Saudi numbers written the local way (05…, 011…, 5…) get 966 in front. */
export function phoneDigits(tel: string): string {
  const d = tel.replace(/\D/g, '').replace(/^00/, '');
  if (/^0\d{9}$/.test(d)) return `966${d.slice(1)}`;
  if (/^5\d{8}$/.test(d)) return `966${d}`;
  return d;
}

/** Quoted-printable text (older Android exports) back to UTF-8. */
function quotedPrintable(text: string): string {
  const bytes: number[] = [];
  const clean = text.replace(/=\r?\n/g, '');
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '=' && /^[0-9A-F]{2}$/i.test(clean.slice(i + 1, i + 3))) {
      bytes.push(parseInt(clean.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(clean[i]));
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const unescape = (value: string) => value.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();

interface Line {
  /** The property name without any "item1." group, upper case. */
  key: string;
  params: string;
  value: string;
}

/** Lines of one file, with folded lines (continued on the next line after a space) joined back. */
function lines(text: string): Line[] {
  const raw = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const joined: string[] = [];
  for (const line of raw) {
    if (/^[ \t]/.test(line) && joined.length) joined[joined.length - 1] += line.slice(1);
    // Quoted-printable values that end in "=" continue on the next line.
    else if (joined.length && /ENCODING=QUOTED-PRINTABLE/i.test(joined[joined.length - 1]) && joined[joined.length - 1].endsWith('=')) joined[joined.length - 1] = `${joined[joined.length - 1].slice(0, -1)}${line}`;
    else joined.push(line);
  }
  return joined.flatMap((line) => {
    const colon = line.indexOf(':');
    if (colon < 1) return [];
    const head = line.slice(0, colon);
    const semi = head.indexOf(';');
    const name = (semi < 0 ? head : head.slice(0, semi)).replace(/^[^.]*\./, '').toUpperCase();
    const params = semi < 0 ? '' : head.slice(semi + 1);
    let value = line.slice(colon + 1);
    if (/ENCODING=QUOTED-PRINTABLE/i.test(params)) value = quotedPrintable(value);
    return [{ key: name, params, value }];
  });
}

/** Every contact in the file that has a name and at least one number or email. */
export function parseVcards(text: string): AddressCard[] {
  const cards: AddressCard[] = [];
  let current: { fn: string; n: string; phones: string[]; emails: string[]; org: string } | null = null;
  for (const { key, value } of lines(text)) {
    if (key === 'BEGIN' && /^VCARD$/i.test(value.trim())) current = { fn: '', n: '', phones: [], emails: [], org: '' };
    else if (!current) continue;
    else if (key === 'END') {
      const fromN = current.n.split(';').map(unescape).filter(Boolean);
      // N is "family;given;middle;prefix;suffix": read as "given family".
      const name = unescape(current.fn) || [fromN[1], fromN[2], fromN[0]].filter(Boolean).join(' ') || current.org;
      const phones = [...new Set(current.phones.map(phoneDigits).filter((p) => p.length >= 8 && p.length <= 15))];
      const emails = [...new Set(current.emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
      if (name && (phones.length || emails.length)) cards.push({ name: name.slice(0, 80), phones: phones.slice(0, 5), emails: emails.slice(0, 5), ...(current.org ? { org: current.org.slice(0, 80) } : {}) });
      current = null;
    } else if (key === 'FN') current.fn = value;
    else if (key === 'N') current.n = value;
    else if (key === 'TEL') current.phones.push(value.replace(/^tel:/i, ''));
    else if (key === 'EMAIL') current.emails.push(value);
    else if (key === 'ORG') current.org = unescape(value.split(';').filter(Boolean).join(' '));
  }
  return cards;
}
