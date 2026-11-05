import { describe, expect, it } from 'vitest';
import { REFERENCE, referenceFor } from './reference';

describe('the reference disclosures', () => {
  it('shows a disclosure only from the day after it was published, never before (no look-ahead)', () => {
    const results = (now: string) => referenceFor(['2222'], new Date(now)).map((e) => e.date);
    expect(results('2026-11-03T15:00:00+03:00')).not.toContain('2026-11-03'); // the day itself: not yet
    expect(results('2026-11-04T00:00:00+03:00')).toContain('2026-11-03');
    expect(results('2026-08-18T12:00:00+03:00')).toEqual([]);
  });

  it('keeps market-wide items for every stock, and only the asked stocks otherwise', () => {
    const got = referenceFor(['1120'], new Date('2026-11-05T10:00:00+03:00'));
    expect(got.every((e) => e.symbols.length === 0 || e.symbols.includes('1120'))).toBe(true);
    expect(got.some((e) => e.symbols.length === 0)).toBe(true); // the rate decision
    expect(got.map((e) => e.date)).toEqual([...got.map((e) => e.date)].sort().reverse());
  });

  it('lets old disclosures go after 120 days', () => {
    expect(referenceFor(['2222'], new Date('2027-03-30T10:00:00+03:00')).map((e) => e.date)).not.toContain('2026-08-18');
  });

  it('holds only dated, sourced records with figures', () => {
    for (const e of REFERENCE) {
      expect(e.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.source).toMatch(/^https:\/\//);
      expect(e.facts.length).toBeGreaterThan(0);
    }
  });
});
