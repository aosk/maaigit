import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('window', {});
vi.stubGlobal('navigator', { userAgent: 'test' });

describe('a picked contact as it goes into the message', () => {
  it('is the name with the number in international digits, so the assistant knows exactly who', async () => {
    const { contactText } = await import('./ContactPicker');
    expect(contactText('خالد', '+966 59 027 2442')).toBe('خالد (+966590272442)');
    expect(contactText('  Sara  ', '00966-55-111-2233')).toBe('Sara (+00966551112233)');
    expect(contactText('', '0551112233')).toBe('+0551112233 (+0551112233)');
    expect(contactText('No number', '')).toBe('No number');
  });
});
