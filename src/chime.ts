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

// Phones only allow sound after the person has touched the page once. The output used to be opened on that first
// touch and then stayed open for good; it is now opened only by the first touch while chimes are switched on, and
// let go of whenever the microphone listens.
if (typeof window !== 'undefined') {
  const unlock = () => {
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    if (wanted()) void audio()?.resume();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Whether the user has chimes switched on (read from the saved settings, so nothing is opened for someone who has them off). */
function wanted(): boolean {
  try {
    return (JSON.parse(localStorage.getItem('maai.settings') ?? '{}') as { sound?: boolean }).sound !== false;
  } catch {
    return true;
  }
}

/**
 * Lets go of the phone's sound output while the microphone listens. An open sound output (even a silent one) and the
 * microphone share one channel on the iPhone, and the microphone can then be handed silence. Returns the state the
 * output was in, for finding out what happened ("none" when no output was ever opened).
 */
export async function quietSound(): Promise<string> {
  const before = context?.state ?? 'none';
  try {
    if (context && context.state !== 'suspended' && context.state !== 'closed') await context.suspend();
  } catch {
    // nothing to let go of
  }
  return before;
}

/** Plays the chime. Calls closer together than 4 seconds (a push and the banner for the same alert) sound once. */
export function playChime(now = Date.now()): boolean {
  if (now - lastPlayed < 4000) return false;
  const ctx = audio();
  if (!ctx) return false;
  // Let go of while the microphone listened (see quietSound): woken for this chime; it sounds from the next one on.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  if (ctx.state !== 'running') return false;
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
