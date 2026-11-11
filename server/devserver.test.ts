import { describe, expect, it } from 'vitest';
import { devDeny } from './devserver';

describe('local dev server', () => {
  it('denies the data folder wherever it is, and secrets', () => {
    const deny = devDeny('/home/me/.maai');
    expect(deny).toContain('/home/me/.maai/**');
    expect(deny).toContain('**/data*/**');
    expect(deny).toContain('**/.env*');
  });
});
