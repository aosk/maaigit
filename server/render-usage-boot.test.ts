import { describe, expect, it } from 'vitest';
import { localUsage, startRenderWatch } from './render-usage';

describe('the CPU gauge after a start', () => {
  it('does not count starting up as load', async () => {
    // Starting up: a busy second before the watch begins.
    const until = Date.now() + 1000;
    let x = 0;
    while (Date.now() < until) x += Math.sqrt(x + 1);
    expect(x).toBeGreaterThan(0);
    startRenderWatch();
    // A reading taken in the same instant divides by almost no time and is noise; let a moment pass, as a real reading would.
    await new Promise((r) => setTimeout(r, 150));
    const l = localUsage();
    // CPUs: the busy second would read as about one; a loaded machine adds noise, so the line is drawn at 0.6.
    expect(l.cpu.used).toBeLessThan(0.6);
  });
});
