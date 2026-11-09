import { describe, expect, it } from 'vitest';
import { localUsage, startRenderWatch } from './render-usage';

describe('the CPU gauge after a start', () => {
  it('does not count starting up as load', () => {
    // Starting up: a busy second before the watch begins.
    const until = Date.now() + 1000;
    let x = 0;
    while (Date.now() < until) x += Math.sqrt(x + 1);
    expect(x).toBeGreaterThan(0);
    startRenderWatch();
    const l = localUsage();
    expect(l.cpu.used).toBeLessThan(0.3); // CPUs: the busy second would read as about one
  });
});
