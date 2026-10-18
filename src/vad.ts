/**
 * Decides, from the microphone's loudness, when the person has started and finished talking. It learns how noisy the room
 * is in the first moments, so a fan or a car does not count as speech, and stops after a pause.
 */
export type Gate = 'listening' | 'speaking' | 'done' | 'no-speech';

export class SpeechGate {
  private t0: number | undefined;
  private quiet: number[] = [];
  private lastLoud = 0;
  private started = false;

  constructor(
    private readonly silenceMs = 2200,
    private readonly noSpeechMs = 8000,
    private readonly warmupMs = 400,
  ) {}

  /** `level` is the loudness from 0 to 1; `now` is a clock in milliseconds. */
  update(level: number, now: number): Gate {
    this.t0 ??= now;
    if (now - this.t0 < this.warmupMs && !this.started) {
      this.quiet.push(level);
      return 'listening';
    }
    const baseline = this.quiet.length ? this.quiet.reduce((a, b) => a + b, 0) / this.quiet.length : 0;
    const threshold = Math.max(0.02, baseline * 3);
    if (level > threshold) {
      this.started = true;
      this.lastLoud = now;
    }
    if (this.started) return now - this.lastLoud >= this.silenceMs ? 'done' : 'speaking';
    return now - this.t0 >= this.noSpeechMs ? 'no-speech' : 'listening';
  }
}
