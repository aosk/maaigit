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
