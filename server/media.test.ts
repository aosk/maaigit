import fs from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/media-data', MAAI_DATA_FILE: '/tmp/claude-0/media-data/store.json', ASANA_TOKEN: '', GOOGLE_CALENDAR_ICS_URL: '', MAAI_PASSWORD: 'media-pass' });
});

import type { InboxMessage } from '../shared/types';
import { createKey, receiveFromBot, revokeKey, takeCommands } from './bot';
import { FILES_PER_DAY, askForFile, receiveFile, resetMedia, sniff } from './media';
import { createInnerApp } from './site';
import { listen, raw } from './security/helpers';
import { state } from './store';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(40, 1)]);
const LIMITS = { image: 2, pdf: 1 };
let n = 0;
const msg = (attachment: InboxMessage['attachment'], phone = '966501111111'): InboxMessage =>
  ({ id: `m${++n}`, externalId: `bot:wa${n}`, from: 'Ahmed', phone, channel: 'whatsapp', via: 'bot', text: '[A photo, voice note or file: MAAI cannot read these]', receivedAt: new Date().toISOString(), replied: false, attachment });
const idOf = (m: InboxMessage) => m.externalId!.slice(4);

let key = '';
beforeEach(() => {
  resetMedia();
  state.bot = { commands: [] };
  state.inbox = [];
  key = createKey();
});

describe('what a file really is', () => {
  it('goes by the bytes, not by what the sender called it', () => {
    expect(sniff(JPEG)).toBe('image/jpeg');
    expect(sniff(PNG)).toBe('image/png');
    expect(sniff(WEBP)).toBe('image/webp');
    expect(sniff(PDF)).toBe('application/pdf');
    for (const bad of [Buffer.from('MZ\x90\x00 an exe pretending'), Buffer.from('<html><script>alert(1)</script></html>'), Buffer.from('PK\x03\x04 a zip or a docx'), Buffer.alloc(3)]) expect(sniff(bad)).toBeNull();
  });
});

describe('asking the device bot for a picture or a PDF', () => {
  it('asks by the message id, and gives the file when the bot hands it over', async () => {
    const m = msg('image');
    const asked = askForFile(m, LIMITS);
    expect(takeCommands()).toMatchObject([{ kind: 'media', text: idOf(m) }]);
    expect(receiveFile(idOf(m), JPEG)).toBe('taken');
    await expect(asked).resolves.toMatchObject({ kind: 'image', mime: 'image/jpeg' });
    // handed over once: a second copy is not taken
    expect(receiveFile(idOf(m), JPEG)).toBe('not asked for');
  });

  it('never asks for a voice note, another kind of file, a message with no id, or when the bot is away', async () => {
    for (const kind of ['voice', 'other', undefined] as const) await expect(askForFile(msg(kind), LIMITS)).resolves.toBeNull();
    await expect(askForFile({ ...msg('image'), externalId: undefined }, LIMITS)).resolves.toBeNull();
    revokeKey();
    await expect(askForFile(msg('image'), LIMITS)).resolves.toBeNull();
    expect(state.bot.commands).toEqual([]);
  });

  it('refuses a file it did not ask for, one of the wrong kind, and one that is not a picture or PDF at all', async () => {
    expect(receiveFile('never-asked', JPEG)).toBe('not asked for');
    const a = msg('image');
    const first = askForFile(a, LIMITS);
    expect(receiveFile(idOf(a), PDF)).toBe('not a picture or PDF'); // asked for a picture, got a PDF
    await expect(first).resolves.toBeNull();
    const b = msg('pdf');
    const second = askForFile(b, LIMITS);
    expect(receiveFile(idOf(b), Buffer.from('MZ this is a program, renamed'))).toBe('not a picture or PDF');
    await expect(second).resolves.toBeNull();
  });

  it('keeps to each person\'s daily limit, per kind, and to the day\'s total; a new day starts again', async () => {
    const now = Date.parse('2026-11-17T09:00:00Z');
    const ask = (kind: 'image' | 'pdf', phone?: string, at = now) => {
      const m = msg(kind, phone);
      const p = askForFile(m, LIMITS, at);
      const taken = receiveFile(idOf(m), kind === 'pdf' ? PDF : JPEG) === 'taken';
      return p.then((f) => Boolean(f) && taken);
    };
    expect([await ask('image'), await ask('image'), await ask('image')]).toEqual([true, true, false]);
    expect([await ask('pdf'), await ask('pdf')]).toEqual([true, false]);
    expect(await ask('image', '966502222222')).toBe(true); // someone else has their own count
    expect(await ask('image', undefined, now + 86_400_000)).toBe(true); // the next day
    resetMedia();
    let ok = 0;
    for (let i = 0; i < FILES_PER_DAY + 5; i++) if (await ask('image', `9665${String(10000000 + i)}`)) ok += 1;
    expect(ok).toBe(FILES_PER_DAY);
  });

  it('carries on without the file when the bot does not hand it over in time', async () => {
    vi.useFakeTimers();
    try {
      const m = msg('image');
      const asked = askForFile(m, LIMITS);
      await vi.advanceTimersByTimeAsync(91_000);
      await expect(asked).resolves.toBeNull();
      expect(receiveFile(idOf(m), JPEG)).toBe('not asked for');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the bot\'s door for files', () => {
  it('needs the device key, takes only a file that was asked for, and refuses what is not a picture or PDF', async () => {
    const site = await listen(createInnerApp());
    try {
      const post = (id: string, body: Buffer, auth = `Bearer ${key}`) => raw(site.port, 'POST', `/bot/v1/media?id=${id}`, { body: body as never, headers: { authorization: auth, 'content-type': 'application/octet-stream' } });
      expect((await post('x', JPEG, 'Bearer wrong')).status).toBe(401);
      expect((await post('never-asked', JPEG)).status).toBe(404);
      const a = msg('image');
      const asked = askForFile(a, LIMITS);
      expect((await post(idOf(a), Buffer.from('<html>not a picture</html>'))).status).toBe(415);
      await expect(asked).resolves.toBeNull();
      const b = msg('image');
      const again = askForFile(b, LIMITS);
      expect((await post(idOf(b), PNG)).status).toBe(200);
      await expect(again).resolves.toMatchObject({ mime: 'image/png' });
    } finally {
      await site.close();
    }
  });
});

describe('what the bot says about attachments', () => {
  const wa = (extra: Record<string, unknown>) => ({ id: `d${++n}`, channel: 'whatsapp', from: 'Ahmed', phone: '966501111111', at: new Date().toISOString(), ...extra });

  it('keeps the kind of attachment, and marks a voice note the bot wrote out', () => {
    receiveFromBot({ messages: [wa({ media: true, mediaType: 'image', text: 'الإيصال' }), wa({ media: true, mediaType: 'pdf' }), wa({ media: true, mediaType: 'voice', voice: true, text: 'خلصت الطلب' }), wa({ media: true, mediaType: 'voice', text: '[A voice note]' }), wa({ media: true, mediaType: 'virus' }), wa({ mediaType: 'image', voice: true, text: 'typed, not media' })] });
    expect(state.inbox.map((m) => [m.attachment, m.text])).toEqual([
      ['image', 'الإيصال'],
      ['pdf', '[A photo, voice note or file: MAAI cannot read these]'],
      ['voice', '🎤 خلصت الطلب'],
      ['voice', '[A voice note]'],
      [undefined, '[A photo, voice note or file: MAAI cannot read these]'],
      [undefined, 'typed, not media'],
    ]);
  });

  it('takes a voice order the bot wrote out as a typed order, without the mark', () => {
    state.bot.orderPhone = '966500000001';
    const orders: string[] = [];
    receiveFromBot({ messages: [wa({ phone: '966500000001', media: true, mediaType: 'voice', voice: true, text: 'ذكرني أتصل بأحمد' })] }, Date.now(), (o) => orders.push(o.text));
    expect(orders).toEqual(['ذكرني أتصل بأحمد']);
  });
});

describe('the bot\'s own voice helpers (run from its file)', () => {
  const source = fs.readFileSync(new URL('../device-bot/bot.mjs', import.meta.url), 'utf8');
  const block = /\/\/ VOICE-START[^\n]*\n([\s\S]*?)\/\/ VOICE-END/.exec(source)?.[1] ?? '';
  const voice = vm.runInNewContext(`${block}\n({ to16k, voiceAllowed, mediaKind, VOICE_PER_PERSON_DAY, VOICE_PER_DAY });`, { Float32Array, Math, Object, String }) as {
    to16k: (channels: Float32Array[], rate: number) => Float32Array;
    voiceAllowed: (used: { day: string; total: number; by: Record<string, number> }, phone: string, day: string) => boolean;
    mediaKind: (msg: { type: string; _data?: { mimetype?: string } }) => string;
    VOICE_PER_PERSON_DAY: number;
    VOICE_PER_DAY: number;
  };

  it('turns WhatsApp\'s sound (48,000 a second, one or two channels) into what the speech model reads', () => {
    const second = Float32Array.from({ length: 48_000 }, (_, i) => Math.sin((2 * Math.PI * 440 * i) / 48_000));
    const out = voice.to16k([second], 48_000);
    expect(out.length).toBe(16_000);
    expect(Math.max(...out)).toBeGreaterThan(0.9);
    expect(Math.max(...out)).toBeLessThanOrEqual(1);
    // two channels are averaged; a clip already at 16,000 is left as it is
    expect(voice.to16k([second, second.map((x) => -x)], 48_000).every((x) => Math.abs(x) < 1e-6)).toBe(true);
    expect(voice.to16k([second.slice(0, 16_000)], 16_000).length).toBe(16_000);
    expect(voice.to16k([], 48_000).length).toBe(0);
  });

  it('writes out at most so many voice notes a day per person and in all, and starts again the next day', () => {
    const used = { day: '', total: 0, by: {} as Record<string, number> };
    let ok = 0;
    for (let i = 0; i < voice.VOICE_PER_PERSON_DAY + 3; i++) if (voice.voiceAllowed(used, '9665', '2026-11-17')) ok += 1;
    expect(ok).toBe(voice.VOICE_PER_PERSON_DAY);
    expect(voice.voiceAllowed(used, '9666', '2026-11-17')).toBe(true);
    for (let i = 0; i < 200; i++) voice.voiceAllowed(used, `p${i}`, '2026-11-17');
    expect(used.total).toBe(voice.VOICE_PER_DAY);
    expect(voice.voiceAllowed(used, '9665', '2026-11-18')).toBe(true);
    expect(used.total).toBe(1);
  });

  it('tells a picture, a PDF and a voice note from other files', () => {
    expect(voice.mediaKind({ type: 'ptt' })).toBe('voice');
    expect(voice.mediaKind({ type: 'audio' })).toBe('voice');
    expect(voice.mediaKind({ type: 'image' })).toBe('image');
    expect(voice.mediaKind({ type: 'document', _data: { mimetype: 'application/pdf' } })).toBe('pdf');
    expect(voice.mediaKind({ type: 'document', _data: { mimetype: 'application/zip' } })).toBe('other');
    expect(voice.mediaKind({ type: 'video' })).toBe('other');
  });
});
