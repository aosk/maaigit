import { describe, expect, it } from 'vitest';
import { devDeny, devOrigins } from './devserver';

describe('local dev server', () => {
  it('denies the data folder wherever it is, and secrets', () => {
    const deny = devDeny('/home/me/.maai');
    expect(deny).toContain('/home/me/.maai/**');
    expect(deny).toContain('**/data*/**');
    expect(deny).toContain('**/.env*');
  });
});

describe('the origins the local Vite server answers', () => {
  it('are this app on its own port, and nobody else', () => {
    const ok = devOrigins(5173);
    expect(ok.test('http://localhost:5173')).toBe(true);
    expect(ok.test('https://127.0.0.1:5173')).toBe(true);
    expect(ok.test('http://localhost:9999')).toBe(false);
    expect(ok.test('http://localhost:51731')).toBe(false);
    expect(ok.test('http://evil.example:5173')).toBe(false);
    expect(ok.test('http://localhost.evil.example:5173')).toBe(false);
  });
});
