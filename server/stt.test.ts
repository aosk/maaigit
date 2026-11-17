import fs from 'node:fs';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/stt-data', MAAI_DATA_FILE: '/tmp/claude-0/stt-data/store.json', ASANA_TOKEN: '', GOOGLE_CALENDAR_ICS_URL: '', MAAI_PASSWORD: '' });
});

import { createKey, seen, takeCommands } from './bot';
import { createInnerApp } from './site';
import { listen } from './security/helpers';
import { status } from './status';
import { state } from './store';
import { MAX_WAV_BYTES, audioFor, canHear, hear, heard, plainWav, resetStt } from './stt';

/** A WAV as the app makes it: `seconds` of a quiet tone. */
function wavOf(seconds: number, rate = 16_000, channels = 1): Buffer {
  const n = Math.floor(seconds * rate);
  const out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0, 'latin1');
  out.writeUInt32LE(36 + n * 2, 4);
  out.write('WAVEfmt ', 8, 'latin1');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2 * channels, 28);
  out.writeUInt16LE(2 * channels, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36, 'latin1');
  out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 300 * i) / rate)), 44 + i * 2);
  return out;
}
const idOf = () => takeCommands().find((c) => c.kind === 'stt')!.text;

let key = '';
beforeEach(() => {
  resetStt();
  state.bot = { commands: [] };
  key = createKey();
  seen('test bot');
});
afterEach(() => vi.useRealTimers());

describe('what the app may send to be written out', () => {
  it('is only the plain recording the app makes, of a sensible length', () => {
    expect(plainWav(wavOf(2))).toBe(true);
    expect(plainWav(wavOf(2, 48_000))).toBe(false);
    expect(plainWav(wavOf(2, 16_000, 2))).toBe(false);
    expect(plainWav(wavOf(0.05))).toBe(false);
    expect(plainWav(Buffer.concat([wavOf(59), Buffer.alloc(40_000)]))).toBe(false);
    expect(plainWav(Buffer.from('<html>not sound</html>'.repeat(200)))).toBe(false);
    expect(MAX_WAV_BYTES).toBeLessThan(2_000_000);
  });
});

describe('writing out what was said in the app', () => {
  it('hands the recording to the bot once and gives back its words, time after time', async () => {
    for (const said of ['ذكرني أتصل بأحمد', 'وش عندي اليوم', 'add a meeting tomorrow at 5']) {
      const sound = wavOf(3);
      const waiting = hear(sound, 'ar');
      const id = idOf();
      const got = audioFor(id);
      expect(got?.lang).toBe('ar');
      expect(got?.audio.equals(sound)).toBe(true);
      expect(audioFor(id)).toBeNull(); // given once
      expect(heard(id, `  ${said}  `)).toBe(true);
      await expect(waiting).resolves.toEqual({ text: said });
      expect(heard(id, 'again')).toBe(false); // not waited for any more
    }
    // the words themselves are never kept with the command
    expect(JSON.stringify(state.bot.commands)).not.toContain('أحمد');
  });

  it('says why when there are no words', async () => {
    await expect(hear(Buffer.from('nope'), 'ar')).resolves.toEqual({ why: 'bad-audio' });
    const quiet = hear(wavOf(2), 'en');
    heard(idOf(), '', 'empty');
    await expect(quiet).resolves.toEqual({ why: 'empty' });
    const broke = hear(wavOf(2), 'en');
    heard(idOf(), '', 'something else');
    await expect(broke).resolves.toEqual({ why: 'error' });
  });

  it('does not wait for a bot that is away, off, or still setting up', async () => {
    expect(canHear()).toBe(true);
    expect(status().voiceIn).toBe(true);
    state.bot.voice = { state: 'off', detail: 'VOICE_TEXT=off', wrote: 0, failed: 0 };
    expect(canHear()).toBe(false);
    await expect(hear(wavOf(2), 'ar')).resolves.toEqual({ why: 'not-ready' });
    state.bot.voice = { state: 'ready', detail: '', wrote: 3, failed: 0 };
    expect(canHear(Date.now() + 5 * 60_000)).toBe(false); // silent for five minutes
    await expect(hear(wavOf(2), 'ar', Date.now() + 5 * 60_000)).resolves.toMatchObject({ why: expect.stringMatching(/not-ready|bot-away/) });
    state.bot = { commands: [] };
    expect(canHear()).toBe(false);
    expect(status().voiceIn).toBe(false);
  });

  it('gives up on a bot that took the recording and never answered, and takes only a few at once', async () => {
    vi.useFakeTimers();
    const slow = hear(wavOf(2), 'ar');
    const more = [hear(wavOf(2), 'ar'), hear(wavOf(2), 'ar')];
    await expect(hear(wavOf(2), 'ar')).resolves.toEqual({ why: 'busy' });
    vi.advanceTimersByTime(46_000);
    await expect(slow).resolves.toEqual({ why: 'timeout' });
    await Promise.all(more);
    const next = hear(wavOf(2), 'ar'); // there is room again
    expect(takeCommands().some((c) => c.kind === 'stt')).toBe(true);
    vi.advanceTimersByTime(46_000);
    await expect(next).resolves.toEqual({ why: 'timeout' });
  });
});

describe('the doors: the app sends a recording, the bot fetches it and answers', () => {
  it('goes all the way round, three times in a row, and the bot\'s door needs the device key', async () => {
    const site = await listen(createInnerApp());
    const url = `http://127.0.0.1:${site.port}`;
    const bot = { authorization: `Bearer ${key}` };
    try {
      expect((await fetch(`${url}/bot/v1/stt?id=x`, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
      expect((await fetch(`${url}/bot/v1/stt?id=never`, { headers: bot })).status).toBe(404);
      for (const said of ['الأولى', 'الثانية', 'الثالثة']) {
        const sound = wavOf(2);
        const asked = fetch(`${url}/api/chat/hear?lang=ar`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: new Uint8Array(sound) });
        // the bot: waits for its command, fetches the sound, answers with the words
        const cmds = (await (await fetch(`${url}/bot/v1/commands?wait=5`, { headers: bot })).json()) as { commands: { kind: string; text: string }[] };
        const id = cmds.commands.find((c) => c.kind === 'stt')!.text;
        const audio = await fetch(`${url}/bot/v1/stt?id=${id}`, { headers: bot });
        expect(audio.headers.get('x-maai-lang')).toBe('ar');
        expect(Buffer.from(await audio.arrayBuffer()).equals(sound)).toBe(true);
        expect((await fetch(`${url}/bot/v1/stt`, { method: 'POST', headers: { ...bot, 'content-type': 'application/json' }, body: JSON.stringify({ id, text: said }) })).status).toBe(200);
        const res = await asked;
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ text: said });
      }
      const bad = await fetch(`${url}/api/chat/hear?lang=ar`, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: new Uint8Array(Buffer.from('not sound')) });
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ why: 'bad-audio' });
    } finally {
      await site.close();
    }
  });
});

describe('the bot reads the app\'s recording (run from its file)', () => {
  const source = fs.readFileSync(new URL('../device-bot/bot.mjs', import.meta.url), 'utf8');
  const block = /\/\/ VOICE-START[^\n]*\n([\s\S]*?)\/\/ VOICE-END/.exec(source)?.[1] ?? '';
  const { wavSamples } = vm.runInNewContext(`${block}\n({ wavSamples });`, { Float32Array, DataView, Math, Object, String }) as { wavSamples: (bytes: Uint8Array) => Float32Array | null };

  it('as sound between -1 and 1, and refuses anything else', () => {
    const out = wavSamples(new Uint8Array(wavOf(1)));
    expect(out?.length).toBe(16_000);
    expect(Math.max(...out!)).toBeGreaterThan(0.2);
    expect(Math.max(...out!)).toBeLessThan(0.3);
    expect(wavSamples(new Uint8Array(wavOf(1, 48_000)))).toBeNull();
    expect(wavSamples(new Uint8Array(wavOf(1, 16_000, 2)))).toBeNull();
    expect(wavSamples(new Uint8Array(Buffer.from('RIFFxxxxWAVE')))).toBeNull();
    expect(wavSamples(new Uint8Array(Buffer.from('<html>hello</html>'.repeat(10))))).toBeNull();
  });
});
