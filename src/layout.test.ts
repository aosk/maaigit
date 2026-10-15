import { describe, expect, it } from 'vitest';
import { detectLayout, effectiveLayout } from './layout';

describe('screen type', () => {
  it('tells a phone, a tablet or opened fold, and a computer by width', () => {
    expect(detectLayout(344)).toBe('phone'); // a fold's cover screen
    expect(detectLayout(390)).toBe('phone');
    expect(detectLayout(599)).toBe('phone');
    expect(detectLayout(600)).toBe('tablet');
    expect(detectLayout(884)).toBe('tablet'); // an opened fold
    expect(detectLayout(1023)).toBe('tablet');
    expect(detectLayout(1024)).toBe('desktop');
    expect(detectLayout(1920)).toBe('desktop');
  });

  it('follows the width on automatic, and the choice otherwise', () => {
    expect(effectiveLayout('auto', 820)).toBe('tablet');
    expect(effectiveLayout('phone', 1920)).toBe('phone');
    expect(effectiveLayout('desktop', 390)).toBe('desktop');
  });
});
