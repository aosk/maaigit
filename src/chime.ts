/**
 * MAAI's own alert sound, made with the browser's audio (no sound file): two soft, rising notes.
 * It plays while the app is open; when the app is closed the phone plays its own notification sound,
 * which a web app cannot change.
 */

let context: AudioContext | null = null;
let lastPlayed = 0;

function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    context ??= Ctor ? new Ctor() : null;
    return context;
  } catch {
    return null;
  }
}

// Phones only allow sound after the person has touched the page once: unlock it on the first touch.
if (typeof window !== 'undefined') {
  const unlock = () => {
    void audio()?.resume();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Plays the chime. Calls closer together than 4 seconds (a push and the banner for the same alert) sound once. */
export function playChime(now = Date.now()): boolean {
  if (now - lastPlayed < 4000) return false;
  const ctx = audio();
  if (!ctx || ctx.state !== 'running') return false;
  lastPlayed = now;
  const start = ctx.currentTime + 0.02;
  // E5 then A5: a calm rising fourth.
  [659.25, 880].forEach((frequency, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = start + i * 0.18;
    osc.type = 'sine';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.7);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.75);
  });
  return true;
}
