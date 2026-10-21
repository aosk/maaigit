import { describe, expect, it } from 'vitest';
import { phoneDigits } from './contacts';

describe('picked phone numbers', () => {
  it('become international digits', () => {
    expect(phoneDigits('050 123 4567')).toBe('966501234567');
    expect(phoneDigits('+966 50 123 4567')).toBe('966501234567');
    expect(phoneDigits('00966501234567')).toBe('966501234567');
    expect(phoneDigits('+1 (415) 555-0100')).toBe('14155550100');
  });
});
