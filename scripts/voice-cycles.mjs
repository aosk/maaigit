// Speaks to the assistant several times in a row on a phone-like stand-in, and reports each time whether the
// microphone heard. The stand-in models what an iPhone does: ONE sound channel shared by the speaker and the
// microphone (a microphone opened while something is being read, or within 300 ms of it being cut off, hears
// nothing), and one listening session at a time.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
const [port, speakReplies, cycles, tapAfterMs] = [process.argv[2], process.argv[3] === 'on', Number(process.argv[4] ?? 6), Number(process.argv[5] ?? 300)];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addInitScript(() => {
  const log = (window.__log = []);
  const chan = { speakingUntil: 0, releasedAt: 0, queue: 0, listening: null };
  const now = () => performance.now();
  const speakerBusy = () => chan.queue > 0 || now() - chan.releasedAt < 300;
  Object.defineProperty(window, 'speechSynthesis', { value: {
    get speaking() { return chan.queue > 0; },
    get pending() { return false; },
    speak(u) {
      if (!u.text.trim() || u.volume === 0) { setTimeout(() => u.onend?.({}), 120); chan.queue++; setTimeout(() => { chan.queue = Math.max(0, chan.queue - 1); chan.releasedAt = now(); }, 120); return; }
      chan.queue++;
      const mine = (chan.gen ??= 0);
      setTimeout(() => u.onstart?.({}), 10);
      setTimeout(() => { if (mine !== chan.gen) return; chan.queue = Math.max(0, chan.queue - 1); chan.releasedAt = now(); u.onend?.({}); }, Math.min(6000, 600 + u.text.length * 60));
    },
    cancel() { if (chan.queue > 0) { chan.gen = (chan.gen ?? 0) + 1; chan.queue = 0; chan.releasedAt = now(); } },
    getVoices: () => [{ name: 'Maged', lang: 'ar-SA', localService: true, default: true, voiceURI: 'Maged' }, { name: 'Daniel', lang: 'en-GB', localService: true, default: false, voiceURI: 'Daniel' }], addEventListener() {}, removeEventListener() {},
  } });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.volume = 1; } };
  class Rec {
    start() {
      if (chan.listening && chan.listening !== this) { log.push('DEAF (another listening session still open)'); this.deaf = true; }
      else if (speakerBusy()) { log.push('DEAF (the speaker still held the sound channel)'); this.deaf = true; }
      else log.push('heard');
      chan.listening = this;
      if (!this.deaf) this.t = setTimeout(() => this.onresult?.({ results: [Object.assign([{ transcript: 'ذكرني أتصل بأحمد الساعة خمسة' }], { isFinal: true })] }), 500);
    }
    stop() { clearTimeout(this.t); setTimeout(() => { if (chan.listening === this) chan.listening = null; this.onend?.(); }, 200); }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = Rec;
});
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto(`http://localhost:${port}/#/assistant`);
await p.evaluate((speak) => { const s = JSON.parse(localStorage.getItem('maai.settings') || '{}'); s.lang = 'ar'; s.toggles = { ...(s.toggles ?? {}), speakReplies: speak, captions: true }; localStorage.setItem('maai.settings', JSON.stringify(s)); }, speakReplies);
await p.reload(); await p.waitForTimeout(2500);
const mic = p.locator('form.composer button.mic');
const answers = () => p.locator('.bubble.assistant:not(.working)').count();
const out = [];
for (let i = 1; i <= cycles; i++) {
  const before = await answers();
  const logged = await p.evaluate(() => window.__log.length);
  await mic.click();
  // Either an answer arrives (it heard and the order ran), or the "did not hear" note shows.
  let result = 'no answer';
  for (let t = 0; t < 140; t++) {
    await p.waitForTimeout(100);
    if ((await answers()) > before) { result = 'order done'; break; }
    const hint = await p.locator('.composer-hint').innerText();
    if (/ما سمعت|لم أسمع/.test(hint)) { result = 'DID NOT HEAR'; break; }
  }
  const what = (await p.evaluate((n) => window.__log.slice(n), logged)).join(', ');
  out.push(`  ${i}. ${result.padEnd(13)} | microphone: ${what || 'never opened'}`);
  // The user speaks again shortly after the answer appears (while it is being read aloud, if reading is on).
  await p.waitForTimeout(tapAfterMs);
}
console.log(out.join('\n'));
console.log(`  heard ${out.filter((l) => l.includes('order done')).length} of ${cycles}${errs.length ? ` | page errors: ${errs.join(' | ')}` : ''}`);
await b.close();
