import { describe, expect, it } from 'vitest';
import { parseVcards, phoneDigits } from './vcard';

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
