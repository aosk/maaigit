import { describe, expect, it } from 'vitest';
import { Ear, clip, loudness, to16k, wav } from './recorder';

/** Feeds an ear pieces of 85 ms (what a phone gives), each at the given loudness, until it decides. */
function run(ear: Ear, parts: [ms: number, rms: number][]): { verdict: string; at: number } {
  let at = 0;
  for (const [ms, rms] of parts) {
    for (let t = 0; t < ms; t += 85) {
      at += 85;
      const v = ear.feed(rms, 85);
      if (v !== 'wait') return { verdict: v, at };
    }
  }
  return { verdict: 'wait', at };
}

describe('finding the end of what was said', () => {
  it('ends after the pause that follows speech, not before', () => {
    const ear = new Ear(2500);
    const out = run(ear, [[500, 0.004], [3000, 0.12], [4000, 0.004]]);
    expect(out.verdict).toBe('done');
    expect(out.at).toBeGreaterThanOrEqual(500 + 3000 + 2500);
    expect(out.at).toBeLessThan(500 + 3000 + 2500 + 200);
    expect(ear.first).toBeGreaterThan(300);
    expect(ear.first).toBeLessThan(700);
  });

  it('keeps going through the short pauses inside a sentence', () => {
    const ear = new Ear(2500);
    expect(run(ear, [[400, 0.003], [1500, 0.1], [1200, 0.003], [1500, 0.1], [900, 0.003]]).verdict).toBe('wait');
  });

  it('gives up after 8 seconds of quiet, and a knock on the table is not speech', () => {
    const ear = new Ear(2500);
    const out = run(ear, [[2000, 0.004], [85, 0.4], [9000, 0.004]]);
    expect(out.verdict).toBe('silent');
    expect(ear.first).toBe(-1);
    expect(out.at).toBeGreaterThanOrEqual(8000);
  });

  it('hears speech over a noisy room, and the same speech every time it is used again', () => {
    for (let use = 0; use < 5; use++) {
      const ear = new Ear(2500);
      expect(run(ear, [[400, 0.015], [2000, 0.09], [3000, 0.015]]).verdict).toBe('done');
    }
  });

  it('hears someone who starts talking the instant the microphone opens', () => {
    const ear = new Ear(2500);
    expect(run(ear, [[2500, 0.15], [3000, 0.004]]).verdict).toBe('done');
    expect(ear.first).toBeLessThan(200);
  });

  it('never records for more than about a minute', () => {
    const ear = new Ear(2500);
    const out = run(ear, [[70_000, 0.1]]);
    expect(out.verdict).toBe('done');
    expect(out.at).toBeLessThanOrEqual(55_100);
  });
});

describe('the recording that is sent', () => {
  const tone = (n: number, rate: number) => Float32Array.from({ length: n }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 300 * i) / rate));

  it('is brought to 16,000 samples a second whatever the phone records at', () => {
    expect(to16k(tone(48_000, 48_000), 48_000).length).toBe(16_000);
    expect(to16k(tone(44_100, 44_100), 44_100).length).toBe(16_000);
    const same = tone(16_000, 16_000);
    expect(to16k(same, 16_000)).toBe(same);
    expect(loudness(to16k(tone(48_000, 48_000), 48_000))).toBeGreaterThan(0.3);
  });

  it('is a plain WAV: one channel, 16-bit, 16,000 a second', () => {
    const file = new DataView(wav(Float32Array.from([0, 1, -1, 2, -2, 0.5])));
    const text = (at: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => file.getUint8(at + i)));
    expect([text(0, 4), text(8, 8), text(36, 4)]).toEqual(['RIFF', 'WAVEfmt ', 'data']);
    expect([file.getUint16(20, true), file.getUint16(22, true), file.getUint32(24, true), file.getUint16(34, true)]).toEqual([1, 1, 16_000, 16]);
    expect(file.byteLength).toBe(44 + 12);
    expect(file.getUint32(4, true)).toBe(36 + 12);
    // too loud is held at the limit, not wrapped round
    expect([1, 2, 3, 4].map((i) => file.getInt16(44 + i * 2, true))).toEqual([32767, -32768, 32767, -32768]);
  });

  it('starts a little before the first word and drops the quiet before that', () => {
    const rate = 48_000;
    const chunks = [new Float32Array(rate * 2), tone(rate, rate)]; // two quiet seconds, one of speech
    const out = clip(chunks, rate, 2000);
    expect(out.length).toBe(Math.floor(1.4 * 16_000)); // 400 ms before the word, then the word
    expect(loudness(out.subarray(0, 6000))).toBeLessThan(0.01);
    expect(loudness(out.subarray(6400))).toBeGreaterThan(0.3);
    // speech from the very start: everything is kept
    expect(clip(chunks, rate, 100).length).toBe(3 * 16_000);
  });
});
