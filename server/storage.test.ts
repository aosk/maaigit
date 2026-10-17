import { describe, expect, it } from 'vitest';
import { dataIsPersistent } from './storage';

describe('is the saved data kept across updates?', () => {
  it('is, when the data folder is on a mounted disk (a different device from the container root)', () => {
    expect(dataIsPersistent('/var/data', (p) => ({ dev: p === '/' ? 1 : 2 }))).toBe(true);
  });

  it('is not, when the folder is on the same device as the container root (erased at every deploy)', () => {
    expect(dataIsPersistent('/opt/render/project/src/data', () => ({ dev: 7 }))).toBe(false);
  });

  it('is not, when the folder cannot be read at all', () => {
    expect(
      dataIsPersistent('/nope', () => {
        throw new Error('ENOENT');
      }),
    ).toBe(false);
  });
});
