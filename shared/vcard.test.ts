import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER, filterCards, isServiceNumber, parseVcards, phoneDigits } from './vcard';

const ICLOUD = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:العتيبي;خالد;;;',
  'FN:خالد العتيبي',
  'ORG:Ministry of Justice;',
  'item1.TEL;type=pref:+966 50 123 4567',
  'TEL;type=WORK;type=VOICE:011 234 5678',
  'EMAIL;type=INTERNET;type=WORK:Khalid@Example.com',
  'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD',
  ' /2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAx',
  'NOTE:Met at the conference\\, 2024',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Smith;Sara;;;',
  'TEL;type=CELL:0559876543',
  'END:VCARD',
  'BEGIN:VCARD',
  'VERSION:3.0',
  'FN:No way to reach',
  'END:VCARD',
].join('\r\n');

// An older Android export: vCard 2.1, names in quoted-printable UTF-8, a long line folded.
const ANDROID = [
  'BEGIN:VCARD',
  'VERSION:2.1',
  'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=D8=A3=D8=AD=D9=85=D8=AF',
  'TEL;CELL:0501111111',
  'EMAIL;HOME:ahmed@exam',
  ' ple.com',
  'END:VCARD',
].join('\n');

describe('contacts files', () => {
  it('reads iCloud cards: name, numbers in international form, emails, company; drops photos and notes', () => {
    expect(parseVcards(ICLOUD)).toEqual([
      { name: 'خالد العتيبي', phones: ['966501234567', '966112345678'], emails: ['khalid@example.com'], org: 'Ministry of Justice' },
      { name: 'Sara Smith', phones: ['966559876543'], emails: [] },
    ]);
  });

  it('reads older Android exports (quoted-printable Arabic, folded lines)', () => {
    expect(parseVcards(ANDROID)).toEqual([{ name: 'أحمد', phones: ['966501111111'], emails: ['ahmed@example.com'] }]);
  });

  it('turns local Saudi numbers into international ones', () => {
    expect(phoneDigits('0501234567')).toBe('966501234567');
    expect(phoneDigits('501234567')).toBe('966501234567');
    expect(phoneDigits('011 234 5678')).toBe('966112345678');
    expect(phoneDigits('+44 20 7946 0958')).toBe('442079460958');
  });

  it('ignores anything that is not a contacts file', () => {
    expect(parseVcards('hello\nworld')).toEqual([]);
  });
});

describe('filtering contacts before an import', () => {
  const card = (name: string, phones: string[], emails: string[] = []) => ({ name, phones, emails });
  const off = { saudiMobileOnly: false, dedupe: false, dropServices: false, dropEmailOnly: false };

  it('knows service numbers: toll-free, unified, short codes, and anything too short', () => {
    expect(['8001234567', '966800123456', '920012345', '19911', '1234']).toSatisfy((list: string[]) => list.every(isServiceNumber));
    expect(isServiceNumber('966501234567')).toBe(false);
    expect(isServiceNumber('966112345678')).toBe(false);
  });

  it('by default drops repeated and service numbers, keeping the first name for a number', () => {
    const kept = filterCards([card('أحمد', ['966501234567']), card('Ahmed work', ['966501234567']), card('STC', ['900']), card('Bank', ['920012345'])], DEFAULT_FILTER);
    expect(kept.map((c) => c.name)).toEqual(['أحمد']);
  });

  it('keeps only Saudi mobiles when asked, and a card with none left goes, email and all', () => {
    const kept = filterCards([card('سارة', ['966551112222', '442071234567'], ['s@x.com']), card('London', ['442071234567'], ['l@x.com']), card('Mail only', [], ['m@x.com'])], { ...off, saudiMobileOnly: true });
    expect(kept).toEqual([card('سارة', ['966551112222'], ['s@x.com'])]);
  });

  it('keeps email-only contacts unless told to leave them out', () => {
    const cards = [card('Mail only', [], ['m@x.com'])];
    expect(filterCards(cards, off)).toHaveLength(1);
    expect(filterCards(cards, { ...off, dropEmailOnly: true })).toHaveLength(0);
  });

  it('keeps extra fields on each card (the review screen tracks rows by them)', () => {
    expect(filterCards([{ ...card('x', ['966501234567']), index: 7 }], DEFAULT_FILTER)[0].index).toBe(7);
  });
});
