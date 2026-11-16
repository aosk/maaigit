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
