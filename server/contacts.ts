import type { ContactCount } from '../shared/types.js';
import type { AddressCard } from '../shared/vcard.js';
import { audit, save, state } from './store.js';

/**
 * The user's contacts, from two places: the file they imported (names, numbers, emails, companies) and the
 * names and numbers the device bot reads from WhatsApp. Searched together, each person once.
 */

/** Most contacts kept from one import. */
const MAX_CARDS = 10_000;

export class ContactsError extends Error {}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\p{Cc}|[<>]/gu, ' ').trim().slice(0, max) : '');

/** Replaces the imported contacts with these (already read from the file in the browser), checked field by field. */
export function importCards(raw: unknown, now = new Date()): number {
  if (!Array.isArray(raw)) throw new ContactsError('Send the contacts as a list.');
  if (raw.length > MAX_CARDS) throw new ContactsError(`At most ${MAX_CARDS} contacts.`);
  const cards: AddressCard[] = [];
  for (const item of raw) {
    const c = (item ?? {}) as Record<string, unknown>;
    const name = text(c.name, 80);
    const phones = (Array.isArray(c.phones) ? c.phones : []).map((p) => text(p, 20).replace(/\D/g, '')).filter((p) => p.length >= 8 && p.length <= 15).slice(0, 5);
    const emails = (Array.isArray(c.emails) ? c.emails : []).map((e) => text(e, 200).toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 5);
    const org = text(c.org, 80);
    if (name && (phones.length || emails.length)) cards.push({ name, phones, emails, ...(org ? { org } : {}) });
  }
  if (!cards.length) throw new ContactsError('No contacts with a name and a number or email were found in the file.');
  state.addressBook = { cards, importedAt: now.toISOString() };
  audit(`Imported ${cards.length} contacts`, 'User', 'done');
  save();
  return cards.length;
}

export function clearCards(): void {
  state.addressBook = { cards: [] };
  audit('Removed the imported contacts', 'User', 'done');
  save();
}

export const contactCount = (): ContactCount => ({ imported: state.addressBook.cards.length, importedAt: state.addressBook.importedAt, fromWhatsApp: state.contacts.length });

/** Arabic and English names compared loosely: no diacritics, one form of alef, taa marbuta and yaa, any case. */
const fold = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}|ـ/gu, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase()
    .trim();

/** Everyone the user knows, each once: imported cards first, then WhatsApp contacts not already in them. */
function everyone(): AddressCard[] {
  const known = new Set(state.addressBook.cards.flatMap((c) => c.phones));
  return [...state.addressBook.cards, ...state.contacts.filter((c) => !known.has(c.phone)).map((c) => ({ name: c.name, phones: [c.phone], emails: [] }))];
}

/** Contacts whose name (or company) contains every word of the query, best first. */
export function findContacts(query: string, limit = 8): AddressCard[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return everyone()
    .map((c) => ({ c, name: fold(c.name), all: fold(`${c.name} ${c.org ?? ''}`) }))
    .filter(({ all }) => words.every((w) => all.includes(w)))
    .sort((a, b) => Number(b.name.startsWith(words[0])) - Number(a.name.startsWith(words[0])) || a.name.length - b.name.length)
    .slice(0, limit)
    .map(({ c }) => c);
}
