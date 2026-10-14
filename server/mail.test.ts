import { describe, expect, it } from "vitest";
import { isEmail } from './mail';

describe('email addresses', () => {
  it('accepts normal addresses', () => {
    expect(isEmail('ahmed@example.com')).toBe(true);
    expect(isEmail(' sara.al-harbi@company.com.sa ')).toBe(true);
  });
  it('rejects anything that is not one address', () => {
    for (const bad of ['', 'Ahmed', 'ahmed@', '@example.com', 'a@b', 'a@b.com, c@d.com', 'Ahmed <a@b.com>']) {
      expect(isEmail(bad)).toBe(false);
    }
  });
});
