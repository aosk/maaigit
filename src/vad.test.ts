import { describe, expect, it } from 'vitest';
import { SpeechGate } from './vad';

/** Feeds a made-up microphone: one reading every 100 ms. */
function run(levels: number[], gate = new SpeechGate(1000, 3000, 300)) {
  return levels.map((level, i) => gate.update(level, i * 100));
}

describe('when the person has finished talking', () => {
  it('waits for speech, then stops after a pause', () => {
    const quiet = Array(5).fill(0.005);
    const speech = Array(10).fill(0.2);
    const pause = Array(12).fill(0.005);
    const out = run([...quiet, ...speech, ...pause]);
    expect(out[4]).toBe('listening');
    expect(out[8]).toBe('speaking');
    expect(out.includes('done')).toBe(true);
    expect(out.indexOf('done')).toBeGreaterThan(14 + 9); // not before the pause is a second long
  });

  it('does not take a steady noisy room for speech', () => {
    const fan = Array(40).fill(0.05);
    const out = run(fan);
    expect(out.includes('speaking')).toBe(false);
    expect(out.at(-1)).toBe('no-speech');
  });

  it('gives up when nobody says anything', () => {
    expect(run(Array(40).fill(0.001)).at(-1)).toBe('no-speech');
  });

  it('keeps going through a short pause between words', () => {
    const out = run([...Array(4).fill(0.004), ...Array(5).fill(0.3), ...Array(5).fill(0.004), ...Array(5).fill(0.3)]);
    expect(out.includes('done')).toBe(false);
  });
});
