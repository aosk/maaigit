import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/stt-data', MAAI_DATA_FILE: '/tmp/claude-0/stt-data/store.json', ASANA_TOKEN: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', GOOGLE_CALENDAR_ICS_URL: '' });
});

const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 1)]);
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(64, 1)]);

async function load(key = 'sk-test-key') {
  vi.resetModules();
  vi.stubEnv('STT_API_KEY', key);
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('STT_BASE_URL', 'https://stt.example/v1/');
  vi.stubEnv('STT_MODEL', 'whisper-test');
  return import('./stt');
}

beforeEach(() => vi.unstubAllEnvs());

describe('what a recording is', () => {
  it('is decided by its first bytes: webm, ogg, mp4/m4a, wav, mp3', async () => {
    const { audioKind } = await load();
    expect(audioKind(WEBM)?.ext).toBe('webm');
    expect(audioKind(M4A)?.ext).toBe('m4a');
    expect(audioKind(Buffer.concat([Buffer.from('OggS'), Buffer.alloc(30)]))?.ext).toBe('ogg');
    expect(audioKind(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(30)]))?.ext).toBe('wav');
    expect(audioKind(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(30)]))?.ext).toBe('mp3');
  });

  it('refuses anything else: web pages, scripts, pictures, tiny files', async () => {
    const { audioKind } = await load();
    expect(audioKind(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(audioKind(Buffer.from('#!/bin/sh\nrm -rf /\n\n\n\n'))).toBeNull();
    expect(audioKind(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]))).toBeNull();
    expect(audioKind(Buffer.alloc(4))).toBeNull();
  });
});

describe('transcribing', () => {
  it('sends the recording, the model and a hint of names and style to the service, with the key, and returns the words', async () => {
    const { transcribe } = await load();
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(JSON.stringify({ text: '  ذكرني بالاجتماع مع Sara يوم الاثنين  ' }), { status: 200 });
    }) as unknown as typeof fetch;
    const text = await transcribe(WEBM, fake);
    expect(text).toBe('ذكرني بالاجتماع مع Sara يوم الاثنين');
    expect(calls[0].url).toBe('https://stt.example/v1/audio/transcriptions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key');
    const form = calls[0].init.body as FormData;
    expect(form.get('model')).toBe('whisper-test');
    expect(String(form.get('prompt'))).toMatch(/Asana/);
    expect((form.get('file') as File).name).toBe('speech.webm');
    expect(form.get('language')).toBeNull(); // not forced: Arabic and English are both fine in one recording
  });

  it('refuses a file that is not a recording before calling anyone', async () => {
    const { transcribe } = await load();
    const fake = vi.fn() as unknown as typeof fetch;
    await expect(transcribe(Buffer.from('<html>not audio at all, really</html>'), fake)).rejects.toMatchObject({ status: 415 });
    expect(fake).not.toHaveBeenCalled();
  });

  it('is off, with a clear message, when no key is set', async () => {
    const { transcribe, sttConfigured } = await load('');
    expect(sttConfigured).toBe(false);
    await expect(transcribe(WEBM, vi.fn() as unknown as typeof fetch)).rejects.toMatchObject({ status: 503 });
  });

  it('explains a refused key without repeating what the service said, and a down service plainly', async () => {
    const { transcribe } = await load();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = vi.fn(async () => new Response('{"error":"Incorrect API key provided: sk-test-key"}', { status: 401 })) as unknown as typeof fetch;
    const err = await transcribe(WEBM, bad).catch((e: Error) => e);
    expect(err).toMatchObject({ status: 502 });
    expect((err as Error).message).not.toContain('sk-test-key');
    const down = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(transcribe(WEBM, down)).rejects.toMatchObject({ status: 503 });
    errors.mockRestore();
  });
});
