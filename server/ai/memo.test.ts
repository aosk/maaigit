import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PORT = vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/memo-data',
    MAAI_DATA_FILE: '/tmp/claude-0/memo-data/store.json',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:45872',
    ASANA_TOKEN: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    GOOGLE_CALENDAR_ICS_URL: '',
  });
  return 45872;
});

import fs from 'node:fs';
import { briefing } from './briefing';
import { fingerprint, remember } from './memo';
import { flushSave, id, state } from '../store';

let calls = 0;
let answer = 'Two meetings today.';
let server: http.Server;
beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls += 1;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: answer }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  calls = 0;
  answer = 'Two meetings today.';
  state.aiCache = {};
  state.usageLog = [];
  state.reminders = [];
  state.events = [];
  for (const agent of state.agents) agent.enabled = true;
});

describe('remember', () => {
  it('answers again only when the data changed', async () => {
    const make = vi.fn(async () => ({ n: Math.random() }));
    const first = await remember('chat', 'slot', { a: 1 }, make);
    const again = await remember('chat', 'slot', { a: 1 }, make);
    expect(again).toEqual(first);
    expect(make).toHaveBeenCalledTimes(1);
    await remember('chat', 'slot', { a: 2 }, make);
    expect(make).toHaveBeenCalledTimes(2);
    // slots do not mix
    await remember('chat', 'other', { a: 2 }, make);
    expect(make).toHaveBeenCalledTimes(3);
  });

  it('shares one call between simultaneous requests, and does not keep a failure', async () => {
    let release!: () => void;
    const make = vi.fn(() => new Promise<string>((resolve) => (release = () => resolve('done'))));
    const a = remember('chat', 'slot', 'same', make);
    const b = remember('chat', 'slot', 'same', make);
    release();
    expect(await Promise.all([a, b])).toEqual(['done', 'done']);
    expect(make).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => {
      throw new Error('Claude is busy');
    });
    await expect(remember('chat', 'broken', 'x', failing)).rejects.toThrow('busy');
    const working = vi.fn(async () => 'fine');
    expect(await remember('chat', 'broken', 'x', working)).toBe('fine');
  });

  it('can expire an answer after a while, and skip keeping an empty one', async () => {
    let time = 1_000_000;
    const make = vi.fn(async () => 'text');
    const options = { maxAgeMs: 60_000, now: () => time };
    await remember('briefing', 's', 'x', make, options);
    time += 30_000;
    await remember('briefing', 's', 'x', make, options);
    expect(make).toHaveBeenCalledTimes(1);
    time += 31_000;
    await remember('briefing', 's', 'x', make, options);
    expect(make).toHaveBeenCalledTimes(2);

    const empty = vi.fn(async () => '');
    await remember('briefing', 'e', 'x', empty, { keep: (v: string) => v.length > 0 });
    await remember('briefing', 'e', 'x', empty, { keep: (v: string) => v.length > 0 });
    expect(empty).toHaveBeenCalledTimes(2);
  });

  it('counts every reuse, so the admin portal can show what was saved', async () => {
    const make = async () => 'x';
    await remember('whatsapp', 's', 1, make);
    await remember('whatsapp', 's', 1, make);
    await remember('whatsapp', 's', 1, make);
    expect(state.usageLog.find((r) => r.purpose === 'whatsapp')).toMatchObject({ hits: 2, requests: 0 });
  });

  it('is saved with the rest of the data, so a restart does not lose it', async () => {
    await remember('chat', 'persisted', 'data', async () => ({ summary: 'kept' }));
    flushSave();
    const onDisk = JSON.parse(fs.readFileSync(process.env.MAAI_DATA_FILE!, 'utf8'));
    expect(onDisk.aiCache.persisted).toMatchObject({ fingerprint: fingerprint('data'), value: { summary: 'kept' } });
  });
});

describe('the daily briefing', () => {
  it('asks Claude once, then reuses the answer every time Today is opened', async () => {
    const first = await briefing('en');
    expect(first).toMatchObject({ text: 'Two meetings today.', source: 'claude' });
    answer = 'A different answer that must not appear.';
    for (let i = 0; i < 5; i++) expect((await briefing('en')).text).toBe('Two meetings today.');
    expect(calls).toBe(1);
    expect(state.usageLog.find((r) => r.purpose === 'briefing')).toMatchObject({ requests: 1, hits: 5 });
  });

  it('writes a new one when the data changes, and not for time passing alone', async () => {
    await briefing('en');
    await briefing('en');
    expect(calls).toBe(1);
    state.reminders.push({ id: id(), title: 'Call my mother', when: 'Tonight', at: new Date(Date.now() + 3_600_000).toISOString(), repeat: 'once', done: false });
    answer = 'Call your mother tonight.';
    expect((await briefing('en')).text).toBe('Call your mother tonight.');
    expect(calls).toBe(2);
    state.reminders[0].done = true;
    await briefing('en');
    expect(calls).toBe(3);
  });

  it('keeps a separate answer for each language', async () => {
    await briefing('en');
    answer = 'اجتماعان اليوم.';
    expect((await briefing('ar')).text).toBe('اجتماعان اليوم.');
    expect((await briefing('en')).text).toBe('Two meetings today.');
    expect((await briefing('ar')).text).toBe('اجتماعان اليوم.');
    expect(calls).toBe(2);
  });

  it('does not keep an empty answer from Claude', async () => {
    answer = '';
    expect((await briefing('en')).source).toBe('demo');
    answer = 'Now a real one.';
    expect((await briefing('en')).text).toBe('Now a real one.');
    expect(calls).toBe(2);
  });
});
