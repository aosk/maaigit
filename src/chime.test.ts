import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A phone's sound output that records what was asked of it. */
function output(settings: Record<string, unknown> | null) {
  const made: { state: string; suspended: number; resumed: number }[] = [];
  class Ctx {
    state = 'suspended';
    suspended = 0;
    resumed = 0;
    currentTime = 0;
    destination = {};
    constructor() {
      made.push(this);
    }
    resume() {
      this.resumed += 1;
      this.state = 'running';
      return Promise.resolve();
    }
    suspend() {
      this.suspended += 1;
      this.state = 'suspended';
      return Promise.resolve();
    }
    createOscillator() {
      return { type: '', frequency: { value: 0 }, connect: () => ({ connect: () => {} }), start() {}, stop() {} };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => {} };
    }
  }
  const listeners: Record<string, () => void> = {};
  vi.stubGlobal('window', { AudioContext: Ctx, addEventListener: (name: string, f: () => void) => (listeners[name] = f), removeEventListener: () => {} });
  vi.stubGlobal('localStorage', { getItem: () => (settings ? JSON.stringify(settings) : null) });
  return { made, touch: () => listeners.pointerdown?.() };
}

describe('the app\'s own sound and the microphone', () => {
  it('lets go of the sound output while the microphone listens, and says what state it was in', async () => {
    const phone = output({ sound: true });
    const { quietSound, playChime } = await import('./chime');
    expect(await quietSound()).toBe('none'); // nothing was ever opened: nothing to let go of
    phone.touch();
    expect(phone.made).toHaveLength(1);
    expect(phone.made[0].state).toBe('running');
    expect(await quietSound()).toBe('running');
    expect(phone.made[0].state).toBe('suspended');
    expect(await quietSound()).toBe('suspended');
    expect(phone.made[0].suspended).toBe(1);
    // a chime wakes it again when one is really wanted
    playChime(10_000);
    expect(phone.made[0].resumed).toBe(2);
  });

  it('never opens the sound output for someone who has chimes switched off', async () => {
    const phone = output({ sound: false });
    await import('./chime');
    phone.touch();
    expect(phone.made).toHaveLength(0);
  });
});
