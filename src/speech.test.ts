import { afterEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for the phone's speech: records what would be read aloud. */
function fakeSpeech() {
  const spoken: string[] = [];
  const synth = { speak: (u: { text: string }) => spoken.push(u.text), cancel: vi.fn(), getVoices: () => [{ name: 'Maged', lang: 'ar-SA' }, { name: 'Daniel', lang: 'en-GB' }], addEventListener: vi.fn() };
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; voice: unknown; rate = 1; pitch = 1; onend: unknown; onerror: unknown; constructor(public text: string) {} });
  return spoken;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('reading a reply aloud while it arrives', () => {
  it('speaks each finished sentence at once, and the rest at the end', async () => {
    const spoken = fakeSpeech();
    const { speechStream } = await import('./speech');
    const s = speechStream('ar', false);
    s.push('محفظتك اليوم مرتفعة بنسبة واحد ');
    await flush();
    expect(spoken).toEqual([]);
    s.push('بالمئة تقريباً. وعندك سهم');
    await flush();
    expect(spoken).toEqual(['محفظتك اليوم مرتفعة بنسبة واحد بالمئة تقريباً.']);
    s.push(' واحد في الراجحي');
    s.end();
    await flush();
    expect(spoken).toEqual(['محفظتك اليوم مرتفعة بنسبة واحد بالمئة تقريباً.', 'وعندك سهم واحد في الراجحي']);
    expect(s.spoke).toBe(true);
  });

  it('does not cut a number like 25.50, and stops when something else is spoken', async () => {
    const spoken = fakeSpeech();
    const { speechStream, stopSpeaking } = await import('./speech');
    const s = speechStream('en', false);
    s.push('Al Rajhi closed at 25.50 today, a little');
    await flush();
    expect(spoken).toEqual([]);
    stopSpeaking();
    s.push(' higher. More words follow here.');
    s.end();
    await flush();
    expect(spoken).toEqual([]);
    expect(s.current).toBe(false);
  });
});

describe('the microphone waits for the phone\'s speaker', () => {
  /** A speech stand-in whose silent phrase ends only when the test says so. */
  function slowSpeech() {
    const said: { onend?: () => void; onerror?: () => void; text: string }[] = [];
    vi.stubGlobal('window', { speechSynthesis: { speak: (u: (typeof said)[number]) => said.push(u), cancel: vi.fn(), getVoices: () => [], addEventListener: vi.fn() } });
    vi.stubGlobal('SpeechSynthesisUtterance', class { volume = 1; onend?: () => void; onerror?: () => void; constructor(public text: string) {} });
    return said;
  }

  it('is not opened until the silent unlock phrase is over, and a second ask shares the same wait', async () => {
    const said = slowSpeech();
    const { unlockSpeech } = await import('./speech');
    let first = false;
    let second = false;
    void unlockSpeech().then(() => (first = true));
    void unlockSpeech().then(() => (second = true)); // the "talk" shortcut, then the microphone button
    await flush();
    expect(said).toHaveLength(1); // said once
    expect([first, second]).toEqual([false, false]);
    said[0].onend!();
    await flush();
    expect([first, second]).toEqual([true, true]);
    // Later taps do not wait, and say nothing more.
    let later = false;
    void unlockSpeech().then(() => (later = true));
    await flush();
    expect(later).toBe(true);
    expect(said).toHaveLength(1);
  });

  it('never waits for ever when the phone does not say the phrase ended', async () => {
    vi.useFakeTimers();
    try {
      slowSpeech();
      const { unlockSpeech } = await import('./speech');
      let ready = false;
      void unlockSpeech().then(() => (ready = true));
      await vi.advanceTimersByTimeAsync(699);
      expect(ready).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait at all where nothing can be read aloud', async () => {
    vi.stubGlobal('window', {});
    const { unlockSpeech } = await import('./speech');
    let ready = false;
    void unlockSpeech().then(() => (ready = true));
    await flush();
    expect(ready).toBe(true);
  });
});

describe('speaking to the assistant again, over its spoken answer', () => {
  /** A phone that is (or is not) reading something aloud, and takes a moment to stop after being told to. */
  function phone(speaking: boolean, stopsAfterMs = 200) {
    const synth = {
      speaking,
      pending: false,
      cancelled: 0,
      speak: vi.fn(),
      cancel() {
        synth.cancelled += 1;
        setTimeout(() => (synth.speaking = false), stopsAfterMs);
      },
      getVoices: () => [],
      addEventListener: vi.fn(),
    };
    vi.stubGlobal('window', { speechSynthesis: synth });
    vi.stubGlobal('SpeechSynthesisUtterance', class { volume = 1; onend?: () => void; onerror?: () => void; constructor(public text: string) { setTimeout(() => this.onend?.(), 0); } });
    return synth;
  }

  it('stops the reading, and opens the microphone only once the phone has gone quiet and let go of the speaker', async () => {
    vi.useFakeTimers();
    try {
      const synth = phone(true, 200);
      const { speechQuiet } = await import('./speech');
      let ready = false;
      void speechQuiet().then(() => (ready = true));
      await vi.advanceTimersByTimeAsync(10);
      expect(synth.cancelled).toBe(1);
      await vi.advanceTimersByTimeAsync(300); // it has stopped, but only just
      expect(ready).toBe(false);
      await vi.advanceTimersByTimeAsync(400);
      expect(ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits a moment the first time only, not at all afterwards when nothing is being read, and never much more than two seconds', async () => {
    vi.useFakeTimers();
    try {
      phone(false);
      const first = await import('./speech');
      // The very first time the silent unlock phrase is said, so there is one short wait…
      let opened = false;
      void first.speechQuiet().then(() => (opened = true));
      await vi.advanceTimersByTimeAsync(200);
      expect(opened).toBe(false);
      await vi.advanceTimersByTimeAsync(400);
      expect(opened).toBe(true);
      // …and after that, with nothing being read, none at all.
      let ready = false;
      void first.speechQuiet().then(() => (ready = true));
      await vi.advanceTimersByTimeAsync(20);
      expect(ready).toBe(true);
      vi.resetModules();
      phone(true, 60_000); // a phone that never says it stopped
      const second = await import('./speech');
      let late = false;
      void second.speechQuiet().then(() => (late = true));
      await vi.advanceTimersByTimeAsync(2700);
      expect(late).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('listening: when the microphone really opens, and why nothing was heard', () => {
  /** A recogniser the test drives by hand. */
  function recogniser() {
    const made: { onstart?: () => void; onaudiostart?: () => void; onsoundstart?: () => void; onspeechstart?: () => void; onend?: () => void; onerror?: (e: { error: string }) => void; onresult?: (e: unknown) => void; stopped: boolean }[] = [];
    class Rec {
      stopped = false;
      constructor() {
        made.push(this);
      }
      start() {}
      stop() {
        this.stopped = true;
        setTimeout(() => (this as unknown as { onend?: () => void }).onend?.(), 10);
      }
    }
    vi.stubGlobal('window', { SpeechRecognition: Rec });
    vi.stubGlobal('navigator', { userAgent: 'iPhone' });
    return made;
  }

  it('waits 8 seconds for the first word from when the microphone opened, not from the tap, and says so once it is open', async () => {
    vi.useFakeTimers();
    try {
      const made = recogniser();
      const { listen } = await import('./speech');
      const ended: unknown[][] = [];
      let opened = 0;
      listen('ar', () => {}, (...a) => ended.push(a), { onOpen: () => (opened += 1) });
      made[0].onstart!();
      await vi.advanceTimersByTimeAsync(4500); // the phone takes 4.5 seconds to open the microphone
      expect(opened).toBe(1); // (taken as open 2.5 s after listening started, since the phone had not said)
      made[0].onaudiostart!();
      await vi.advanceTimersByTimeAsync(7000); // 11.5 s after the tap: the old limit of 8 s would have given up
      expect(ended).toEqual([]);
      await vi.advanceTimersByTimeAsync(2000);
      expect(ended).toHaveLength(1);
      expect(ended[0][0]).toBe('no-speech');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports what the phone noticed, in times and yes/no only: here the microphone opened and heard sound, but no words came', async () => {
    vi.useFakeTimers();
    try {
      const made = recogniser();
      const { listen } = await import('./speech');
      const ended: unknown[][] = [];
      listen('ar', () => {}, (...a) => ended.push(a));
      made[0].onstart!();
      await vi.advanceTimersByTimeAsync(1000);
      made[0].onaudiostart!();
      made[0].onsoundstart!();
      made[0].onerror!({ error: 'network' });
      await vi.advanceTimersByTimeAsync(9000);
      const [problem, why, trace] = ended[0] as [string, string, string];
      expect(problem).toBe('no-speech');
      expect(why).toBe('network');
      expect(trace).toMatch(/^ok=0 start=0 audio=1000 sound=1 speech=0 rounds=1 ms=\d+ spoke=-1 err=network$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives the trace when words were heard too (marked ok), so a good listen can be compared with a deaf one', async () => {
    vi.useFakeTimers();
    try {
      const made = recogniser();
      const { listen } = await import('./speech');
      const ended: unknown[][] = [];
      listen('ar', () => {}, (...a) => ended.push(a));
      made[0].onaudiostart!();
      made[0].onresult!({ results: [Object.assign([{ transcript: 'ذكرني' }], { isFinal: true })] });
      await vi.advanceTimersByTimeAsync(4000);
      expect(ended[0].slice(0, 2)).toEqual([undefined, undefined]);
      expect(ended[0][2]).toMatch(/^ok=1 start=-1 audio=0 sound=0 speech=0 rounds=1 ms=\d+ spoke=-1$/);
    } finally {
      vi.useRealTimers();
    }
  });
});
