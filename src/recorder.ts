/**
 * Records what the user says, in the app itself. The phone's own speech recogniser (used before) opens the microphone
 * and then hears nothing on a second or third use on the iPhone; a plain recording does not have that fault. The sound
 * is recorded here, its level shown live (so the person sees they are heard), the end of speech is found by the level,
 * and the recording is sent to MAAI to be written out (see server/stt.ts).
 */

/** Finds where speech starts and ends from the loudness of each small piece of sound. */
export class Ear {
  private t = 0;
  private floorSum = 0;
  private floorN = 0;
  private loudRun = 0;
  private lastLoud = 0;
  /** When speech began (ms from the start), or -1 while none was heard. */
  first = -1;
  peak = 0;

  constructor(
    private readonly silenceMs: number,
    private readonly giveUpMs = 8000,
    private readonly maxMs = 55_000,
  ) {}

  /** The quiet of the room (from the first moment), which speech must clearly rise above. */
  get floor(): number {
    return this.floorN ? Math.min(0.02, this.floorSum / this.floorN) : 0;
  }

  /** `rms` is the loudness (0 to 1) of a piece lasting `ms`. Answers what to do next. */
  feed(rms: number, ms: number): 'wait' | 'done' | 'silent' {
    this.t += ms;
    this.peak = Math.max(this.peak, rms);
    if (this.t <= 300) {
      this.floorSum += rms;
      this.floorN += 1;
    }
    const loud = rms > Math.max(0.012, this.floor * 3);
    if (loud) {
      this.loudRun += ms;
      // A click or a knock is short; speech stays loud for longer.
      if (this.loudRun >= 120) {
        if (this.first < 0) this.first = Math.max(0, this.t - this.loudRun);
        this.lastLoud = this.t;
      }
    } else this.loudRun = 0;
    if (this.first >= 0 && this.t - this.lastLoud >= this.silenceMs) return 'done';
    if (this.first < 0 && this.t >= this.giveUpMs) return 'silent';
    return this.t >= this.maxMs ? 'done' : 'wait';
  }
}

/** How loud a piece of sound is (root mean square, 0 to 1). */
export function loudness(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

/** The sound at 16,000 samples a second, which is what the speech model reads. */
export function to16k(samples: Float32Array, rate: number): Float32Array {
  if (rate === 16_000) return samples;
  const out = new Float32Array(Math.floor((samples.length * 16_000) / rate));
  const step = rate / 16_000;
  for (let i = 0; i < out.length; i++) {
    // The mean of the samples each new one stands for (a plain low-pass, enough for speech).
    const from = Math.floor(i * step);
    const to = Math.min(samples.length, Math.max(from + 1, Math.floor((i + 1) * step)));
    let sum = 0;
    for (let j = from; j < to; j++) sum += samples[j];
    out[i] = sum / (to - from);
  }
  return out;
}

/** A plain WAV file: one channel, 16-bit, 16,000 samples a second. */
export function wav(samples: Float32Array): ArrayBuffer {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)); };
  text(0, 'RIFF');
  out.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true); // plain samples
  out.setUint16(22, 1, true); // one channel
  out.setUint32(24, 16_000, true);
  out.setUint32(28, 32_000, true);
  out.setUint16(32, 2, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    out.setInt16(44 + i * 2, Math.round(x < 0 ? x * 32768 : x * 32767), true);
  }
  return out.buffer;
}

/** The part of a recording worth sending: from just before speech began to the end, at 16,000 a second. */
export function clip(chunks: Float32Array[], rate: number, firstMs: number): Float32Array {
  const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.length;
  }
  // A little before the first word is kept: its first sound is quiet.
  const from = firstMs > 400 ? Math.floor(((firstMs - 400) * rate) / 1000) : 0;
  return to16k(all.subarray(Math.min(from, all.length)), rate);
}

type AudioCtor = typeof AudioContext;
const Ctx: AudioCtor | undefined = typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;

/** Whether this browser can record (a microphone it will hand over, and a way to read the sound). */
export const canRecord = Boolean(Ctx) && typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';

type RecordProblem = 'unsupported' | 'denied' | 'no-speech';
type Recorded = { audio: ArrayBuffer; trace: string } | { problem: RecordProblem; trace: string };

/**
 * Records until the person stops talking (a pause of `silenceMs`), taps stop (call the returned function), or says
 * nothing for 8 seconds. Must be called from a tap: the phone opens the sound only then. `onLevel` gets the loudness
 * (0 to 1) about ten times a second; `onOpen` is called when sound really starts arriving.
 */
export function record(onLevel: (level: number) => void, onEnd: (out: Recorded) => void, opts: { silenceMs?: number; onOpen?: () => void } = {}): () => void {
  const began = Date.now();
  const ear = new Ear(opts.silenceMs ?? 2500);
  const chunks: Float32Array[] = [];
  let ctx: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let node: ScriptProcessorNode | undefined;
  let opened = -1;
  let finished = false;

  const finish = (how: 'done' | 'silent' | 'stop' | RecordProblem, err = '') => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    try {
      if (node) node.onaudioprocess = null;
      node?.disconnect();
      stream?.getTracks().forEach((track) => track.stop());
      // The microphone and the sound are let go of at once, so the reply can be read aloud at full volume.
      void ctx?.close().catch(() => {});
    } catch {
      // already closed
    }
    const rate = ctx?.sampleRate ?? 0;
    const ms = Math.round((chunks.reduce((n, c) => n + c.length, 0) / (rate || 1)) * 1000);
    const trace = `rec=1 end=${how} rate=${rate} open=${opened} first=${Math.round(ear.first)} len=${ms} peak=${Math.round(ear.peak * 1000)} floor=${Math.round(ear.floor * 1000)} ms=${Date.now() - began}${err ? ` err=${err}` : ''}`;
    if (how === 'unsupported' || how === 'denied' || how === 'no-speech') return onEnd({ problem: how, trace });
    // Stopped by hand before speech was noticed: still sent when there was clearly some sound (quiet speech).
    const worth = ear.first >= 0 || (how === 'stop' && ear.peak > 0.02 && ms > 500);
    if (how === 'silent' || !worth) return onEnd({ problem: 'no-speech', trace });
    onEnd({ audio: wav(clip(chunks, rate, ear.first)), trace });
  };

  // A microphone that was handed over but sends no sound (seen on phones in a call): do not wait for ever.
  const watchdog = setTimeout(() => opened < 0 && finish('unsupported', 'no-sound'), 7000);

  if (!Ctx || !canRecord) {
    finish('unsupported', 'no-api');
    return () => {};
  }
  try {
    ctx = new Ctx();
    void ctx.resume().catch(() => {});
  } catch {
    finish('unsupported', 'no-context');
    return () => {};
  }
  navigator.mediaDevices
    .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    .then((got) => {
      stream = got;
      if (finished || !ctx) return got.getTracks().forEach((track) => track.stop());
      const source = ctx.createMediaStreamSource(got);
      // The older way of reading sound: every phone browser has it, and it needs no extra file.
      node = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain();
      mute.gain.value = 0; // read, never played back
      let lastShown = 0;
      node.onaudioprocess = (e) => {
        if (finished) return;
        const piece = new Float32Array(e.inputBuffer.getChannelData(0));
        if (opened < 0) {
          opened = Date.now() - began;
          opts.onOpen?.();
        }
        chunks.push(piece);
        const level = loudness(piece);
        if (Date.now() - lastShown > 90) {
          lastShown = Date.now();
          onLevel(Math.min(1, level * 6));
        }
        const next = ear.feed(level, (piece.length / e.inputBuffer.sampleRate) * 1000);
        if (next !== 'wait') finish(next);
      };
      source.connect(node);
      node.connect(mute);
      mute.connect(ctx.destination);
      got.getTracks().forEach((track) => track.addEventListener('ended', () => finish(ear.first >= 0 ? 'done' : 'no-speech', 'track-ended')));
    })
    .catch((error: Error) => finish(error.name === 'NotAllowedError' || error.name === 'SecurityError' ? 'denied' : 'unsupported', (error.name || 'error').replace(/[^a-z]/gi, '').slice(0, 24)));

  return () => finish('stop');
}
