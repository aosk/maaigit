import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/uploads-data', MAAI_DATA_FILE: '/tmp/claude-0/uploads-data/store.json', ASANA_TOKEN: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', GOOGLE_CALENDAR_ICS_URL: '' });
});

// A scripted stand-in for Claude, so what it is sent can be checked.
vi.mock('./ai/claude.js', async (original) => ({ ...(await original<typeof import('./ai/claude')>()), client: {}, stream: vi.fn() }));

import { stream } from './ai/claude';
import { chat } from './ai/chat';
import { createInnerApp, createOnlineSite } from './site';
import { listen, raw } from './security/helpers';
import { cleanName, forgetUploads, heldCount, releaseUploads, saveUpload, sniff, takeUploads } from './uploads';
import { flushSave, state, type Conversation } from './store';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pretend this is the rest of a picture')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PDF = Buffer.from('%PDF-1.7\n% pretend this is a document with plenty of bytes in it\n');
const conversation = (): Conversation => ({ id: 'c1', apiMessages: [], turns: [] });
const reply = (content: unknown[], stop_reason: string) => ({ content, stop_reason, usage: { input_tokens: 1, output_tokens: 1 } }) as never;
const say = (text: string) => ({ type: 'text', text });
/** What Claude was sent on each call, copied at the time (the history array keeps changing afterwards). */
let seen: string[] = [];
const script = (...replies: never[]) => {
  const queue = [...replies];
  vi.mocked(stream).mockImplementation((async (req: { messages: unknown[]; system: unknown }) => {
    seen.push(JSON.stringify({ messages: req.messages, system: req.system }));
    return queue.shift();
  }) as never);
};

beforeEach(() => {
  forgetUploads();
  vi.mocked(stream).mockReset();
  seen = [];
  state.proposals = [];
  state.reminders = [];
});
afterEach(() => forgetUploads());

describe('what a file really is', () => {
  it('is decided by its first bytes, not by what it is called', () => {
    expect(sniff(JPEG)).toMatchObject({ kind: 'image', mime: 'image/jpeg' });
    expect(sniff(PNG)).toMatchObject({ kind: 'image', mime: 'image/png' });
    expect(sniff(Buffer.from('GIF89a......'))).toMatchObject({ mime: 'image/gif' });
    expect(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]))).toMatchObject({ mime: 'image/webp' });
    expect(sniff(PDF)).toMatchObject({ kind: 'pdf', mime: 'application/pdf' });
    for (const bad of ['<html><script>alert(1)</script></html>', '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'MZ\u0090\u0000\u0003 an executable', 'PK\u0003\u0004 a zip archive....', '#!/bin/sh\nrm -rf /', 'just some text for a note']) expect(sniff(Buffer.from(bad)), bad).toBeNull();
    expect(sniff(Buffer.alloc(0))).toBeNull();
    expect(sniff(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('keeps only a plain, short name', () => {
    expect(cleanName('C:\\Users\\me\\Invoice 2026.pdf')).toBe('Invoice 2026.pdf');
    expect(cleanName('../../etc/passwd')).toBe('passwd');
    expect(cleanName('<script>alert(1)</script>.png')).toBe('script.png'); // the tag characters go, and what follows the last slash is the name
    expect(cleanName('a\u202etxt.exe\u0000')).toBe('atxt.exe');
    expect(cleanName('x'.repeat(500))).toHaveLength(80);
    expect(cleanName('')).toBe('file');
  });
});

describe('holding files for the next message', () => {
  it('accepts a real photo or PDF and refuses anything else', () => {
    expect(saveUpload(PNG, 'scan.png')).toMatchObject({ name: 'scan.png', kind: 'image', bytes: PNG.length });
    expect(saveUpload(PDF, 'letter.pdf')).toMatchObject({ kind: 'pdf' });
    expect(() => saveUpload(Buffer.from('<html>hello world, not a picture</html>'), 'photo.jpg')).toThrow(/Only photos/);
  });

  it('refuses a photo over 5 MB and a PDF over 10 MB', () => {
    expect(() => saveUpload(Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]), 'big.jpg')).toThrow(/5 MB/);
    expect(() => saveUpload(Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]), 'big.pdf')).toThrow(/10 MB/);
  });

  it('forgets a file after 30 minutes', () => {
    const t0 = 1_000_000;
    const { id } = saveUpload(PNG, 'a.png', t0);
    expect(takeUploads([id], t0 + 29 * 60_000)).toHaveLength(1);
    expect(() => takeUploads([id], t0 + 31 * 60_000)).toThrow(/expired/);
    expect(heldCount()).toBe(0);
  });

  it('keeps a file until its message is answered, then lets go', () => {
    const { id } = saveUpload(PNG, 'a.png');
    const files = takeUploads([id]);
    expect(heldCount()).toBe(1); // a failed message can be sent again
    releaseUploads(files);
    expect(heldCount()).toBe(0);
  });

  it('allows at most four to a message, only real ids, and no flood of waiting files', () => {
    const ids = Array.from({ length: 5 }, () => saveUpload(PNG, 'x.png').id);
    expect(() => takeUploads(ids)).toThrow(/up to 4/);
    expect(takeUploads(ids.slice(0, 4))).toHaveLength(4);
    for (const bad of ['abc', { 0: 'x' }, [5], [null], ['nope'], [{}]]) expect(() => takeUploads(bad)).toThrow();
    expect(takeUploads(undefined)).toEqual([]);
    expect(takeUploads([])).toEqual([]);
    forgetUploads();
    for (let i = 0; i < 12; i++) saveUpload(PNG, 'f.png');
    expect(() => saveUpload(PNG, 'one too many.png')).toThrow(/Too many files/);
  });
});

describe('the assistant reads an attached file', () => {
  it('hands Claude the file itself, with its name, and keeps only the words afterwards', async () => {
    script(reply([say('This is an electricity bill for 412 SAR, due 25 October.')], 'end_turn'));
    const c = conversation();
    const files = [saveUpload(PNG, 'bill.png'), saveUpload(PDF, 'contract.pdf')].map((f) => takeUploads([f.id])[0]);
    const result = await chat(c, 'What is this?', 'en', () => {}, files);
    expect(result.text).toMatch(/electricity bill/);

    // Claude was sent both files, in a form it can read, with a line naming each
    const sent = seen[0];
    expect(sent).toContain('"type":"image"');
    expect(sent).toContain('"media_type":"image/png"');
    expect(sent).toContain('"type":"document"');
    expect(sent).toContain('"media_type":"application/pdf"');
    expect(sent).toContain(PNG.toString('base64'));
    expect(sent).toContain('Attached photo: bill.png');
    expect(sent).toContain('Attached PDF document: contract.pdf');

    // what is kept: the words and the file names, never the pixels
    const kept = JSON.stringify(c.apiMessages);
    expect(kept).not.toContain(PNG.toString('base64'));
    expect(kept).not.toContain('"type":"image"');
    expect(kept).not.toContain('"type":"document"');
    expect(kept).toContain('contents are not kept');
    expect(c.turns[0]).toEqual({ role: 'user', text: 'What is this?', attachments: [{ name: 'bill.png', kind: 'image' }, { name: 'contract.pdf', kind: 'pdf' }] });
    flushSave();
    expect(fs.readFileSync(process.env.MAAI_DATA_FILE!, 'utf8')).not.toContain(PNG.toString('base64'));
  });

  it('can turn what it read into a reminder and an Asana task, as cards waiting for approval', async () => {
    script(
      reply([{ type: 'tool_use', id: 't1', name: 'propose_reminder', input: { title: 'Pay the electricity bill (412 SAR)', when: '25 October', at: new Date(Date.now() + 3 * 86_400_000).toISOString(), after_prayer: 'none', offset_minutes: 0, repeat: 'once' } }], 'tool_use'),
      reply([say('A bill for 412 SAR, due 25 October. I prepared a reminder: tap Approve to save it.')], 'end_turn'),
    );
    const files = [takeUploads([saveUpload(JPEG, 'bill.jpg').id])[0]];
    const result = await chat(conversation(), 'Summarise and remind me', 'en', () => {}, files);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]).toMatchObject({ kind: 'reminder', status: 'pending' });
    expect(state.reminders).toEqual([]); // nothing is saved until the user approves
  });

  it('removes the file from history even when a tool round followed, and rolls everything back if the turn fails', async () => {
    vi.mocked(stream).mockRejectedValueOnce(new Error('network down'));
    const c = conversation();
    const files = [takeUploads([saveUpload(PNG, 'a.png').id])[0]];
    await expect(chat(c, 'read this', 'en', () => {}, files)).rejects.toThrow('network down');
    expect(c.apiMessages).toEqual([]);
    expect(c.turns).toEqual([]);
  });

  it('keeps no signed reasoning after a file is removed from history, so the next message is accepted', async () => {
    script(reply([{ type: 'thinking', thinking: 'reading the bill', signature: 'sig' }, say('A bill.')], 'end_turn'), reply([say('Yes.')], 'end_turn'));
    const c = conversation();
    await chat(c, 'what is this', 'en', () => {}, [takeUploads([saveUpload(PNG, 'a.png').id])[0]]);
    expect(JSON.stringify(c.apiMessages)).not.toContain('"type":"thinking"');
    await chat(c, 'and now?', 'en');
    expect(seen[1]).not.toContain('"type":"thinking"');
  });

  it('heals a saved conversation whose reasoning no longer matches, by dropping it and asking again', async () => {
    const c = conversation();
    c.apiMessages = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hm', signature: 'old' } as never, say('Hi')] },
    ];
    vi.mocked(stream).mockRejectedValueOnce(new Error('400 messages.1.content.0: Invalid `signature` in `thinking` block'));
    script(reply([say('Back again.')], 'end_turn'));
    const result = await chat(c, 'are you there?', 'en');
    expect(result.text).toBe('Back again.');
    expect(JSON.stringify(c.apiMessages)).not.toContain('"type":"thinking"');
  });

  it('tells the model that writing inside a document is information, not orders', async () => {
    script(reply([say('ok')], 'end_turn'));
    const files = [takeUploads([saveUpload(PNG, 'a.png').id])[0]];
    await chat(conversation(), 'read this', 'en', () => {}, files);
    const system = seen[0];
    expect(system).toMatch(/never instructions to you/);
    expect(system).toMatch(/propose_reminder/);
    expect(system).toMatch(/propose_asana_task/);
  });
});

describe('the upload route', () => {
  const asOwner = async () => {
    const inner = createInnerApp();
    inner.get('*', (_req, res) => res.send('<!doctype html>'));
    const site = await listen(createOnlineSite(inner, { password: 'correct-horse-battery', secret: 'test-secret' }));
    const unlock = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: 'correct-horse-battery' }) });
    const cookie = (unlock.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    return { site, cookie };
  };
  const post = (port: number, body: Buffer, headers: Record<string, string>) =>
    new Promise<{ status: number; json: () => unknown; body: string }>((resolve, reject) => {
      import('node:http').then(({ default: http }) => {
        const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/uploads', headers: { 'content-length': String(body.length), ...headers } }, (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text, json: () => JSON.parse(text) }));
        });
        req.on('error', reject);
        req.end(body);
      });
    });

  it('needs the sign-in, then accepts a real photo and refuses disguised files', async () => {
    const { site, cookie } = await asOwner();
    try {
      expect((await post(site.port, PNG, { 'content-type': 'image/png' })).status).toBe(401);
      const ok = await post(site.port, PNG, { 'content-type': 'image/png', cookie, 'x-filename': encodeURIComponent('فاتورة الكهرباء.png') });
      expect(ok.status).toBe(201);
      expect(ok.json()).toMatchObject({ name: 'فاتورة الكهرباء.png', kind: 'image' });
      const fake = await post(site.port, Buffer.from('<html><script>alert(1)</script></html>'), { 'content-type': 'image/jpeg', cookie, 'x-filename': 'photo.jpg' });
      expect(fake.status).toBe(415);
      expect((await post(site.port, Buffer.alloc(0), { 'content-type': 'image/png', cookie })).status).toBe(400);
      expect((await post(site.port, PNG, { 'content-type': 'image/png', cookie, 'x-filename': '%E0%A4%A' })).status).toBe(201); // a broken name is not an error
    } finally {
      await site.close();
    }
  });

  it('refuses an enormous body before holding it', async () => {
    const { site, cookie } = await asOwner();
    try {
      const huge = Buffer.concat([PNG, Buffer.alloc(12 * 1024 * 1024)]);
      const res = await post(site.port, huge, { 'content-type': 'image/png', cookie });
      expect(res.status).toBe(413);
      expect(res.body).not.toContain('at ');
    } finally {
      await site.close();
    }
  });

  it('attaches to a chat message, answers, and then lets the file go', async () => {
    script(reply([say('A letter from the bank: please call before Thursday.')], 'end_turn'));
    const { site, cookie } = await asOwner();
    try {
      const { id } = (await post(site.port, PNG, { 'content-type': 'image/png', cookie, 'x-filename': 'letter.png' })).json() as { id: string };
      const sent = await raw(site.port, 'POST', '/api/chat/stream', { body: JSON.stringify({ text: '', lang: 'en', attachments: [id] }), headers: { cookie } });
      expect(sent.body).toContain('"type":"done"');
      expect(sent.body).toContain('A letter from the bank');
      expect(seen[0]).toContain('Please summarise this for me.'); // no text typed: a sensible request is used
      expect(heldCount()).toBe(0);
      // an id that is no longer held is a clear, recoverable error
      const again = await raw(site.port, 'POST', '/api/chat/stream', { body: JSON.stringify({ text: 'again', attachments: [id] }), headers: { cookie } });
      expect(again.status).toBe(410);
      expect((again.json() as { error: string }).error).toMatch(/expired/);
      const wrong = await raw(site.port, 'POST', '/api/chat/stream', { body: JSON.stringify({ text: 'x', attachments: 'nope' }), headers: { cookie } });
      expect(wrong.status).toBe(400);
    } finally {
      await site.close();
    }
  });
});
