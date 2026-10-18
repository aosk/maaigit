import { SpeechGate } from './vad';

/** Whether this browser can record the microphone. */
export const canRecord = typeof window !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder !== 'undefined';

export type RecordProblem = 'denied' | 'no-speech' | 'unsupported';

/** The best format this browser can record: Android makes webm, an iPhone makes mp4. */
function pickMime(): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
}

/**
 * Records the microphone until the person stops talking (or taps stop, or two minutes pass), then hands over the
 * recording. Returns a function that stops it. `onLevel` is called with the loudness (0 to 1) for a live indicator.
 */
export function record(opts: {
  silenceMs: number;
  onLevel?: (level: number) => void;
  onDone: (audio: Blob | null, problem?: RecordProblem) => void;
}): () => void {
  let stopped = false;
  let stopNow: () => void = () => {
    stopped = true;
  };

  void (async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (error) {
      if (!stopped) opts.onDone(null, (error as DOMException).name === 'NotAllowedError' ? 'denied' : 'unsupported');
      return;
    }
    if (stopped) {
      stream.getTracks().forEach((t) => t.stop());
      opts.onDone(null, 'no-speech');
      return;
    }

    const mime = pickMime();
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    audioContext.createMediaStreamSource(stream).connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    const gate = new SpeechGate(opts.silenceMs);
    let heardSpeech = false;
    let result: 'done' | 'no-speech' | 'tapped' | 'limit' = 'done';

    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const s of samples) sum += ((s - 128) / 128) ** 2;
      const level = Math.sqrt(sum / samples.length);
      opts.onLevel?.(level);
      const state = gate.update(level, performance.now());
      if (state === 'speaking') heardSpeech = true;
      if (state === 'done') finish('done');
      if (state === 'no-speech') finish('no-speech');
    }, 100);
    const limit = setTimeout(() => finish('limit'), 120_000);

    function finish(why: typeof result) {
      if (recorder.state === 'inactive') return;
      result = why;
      clearInterval(timer);
      clearTimeout(limit);
      recorder.stop();
    }

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      void audioContext.close().catch(() => {});
      if (result === 'no-speech' || (!heardSpeech && result !== 'tapped')) return opts.onDone(null, 'no-speech');
      opts.onDone(new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' }));
    };
    stopNow = () => finish('tapped');
    if (stopped) return finish('tapped');
    recorder.start();
  })();

  return () => {
    stopped = true;
    stopNow();
  };
}
