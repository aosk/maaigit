import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const FAKE_PORT = vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/usage-data',
    MAAI_DATA_FILE: '/tmp/claude-0/usage-data/store.json',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:45871',
    MAAI_TIMEZONE: 'Asia/Riyadh',
    ASANA_TOKEN: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    GOOGLE_CALENDAR_ICS_URL: '',
  });
  return 45871;
});

import { create } from './ai/claude';
import { dayKey, recentUsage, recordUsage } from './usage';
import { createInnerApp, createOnlineSite } from './site';
import { listen, raw } from './security/helpers';
import { state } from './store';
import type { AdminOverview } from '../shared/types';

let fake: http.Server;
beforeAll(async () => {
  fake = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 } }));
    });
  });
  await new Promise<void>((resolve) => fake.listen(FAKE_PORT, '127.0.0.1', resolve));
});
afterAll(() => new Promise<void>((resolve) => fake.close(() => resolve())));
beforeEach(() => {
  state.usageLog = [];
  state.usage = { inputTokens: 0, outputTokens: 0, requests: 0 };
});

const NOON = new Date('2026-10-14T09:00:00Z');

describe('counting Claude tokens', () => {
  it('adds up each request under its day and feature, with cached tokens kept apart', () => {
    recordUsage('chat', { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 }, NOON);
    recordUsage('chat', { input_tokens: 10, output_tokens: 5 }, NOON);
    recordUsage('briefing', { input_tokens: 7, output_tokens: 3 }, NOON);
    expect(state.usageLog).toEqual([
      { day: '2026-10-14', purpose: 'chat', input: 120, cached: 50, output: 25, requests: 2 },
      { day: '2026-10-14', purpose: 'briefing', input: 7, cached: 0, output: 3, requests: 1 },
    ]);
    expect(state.usage).toEqual({ inputTokens: 120 + 50 + 7, outputTokens: 28, requests: 3 });
  });

  it('counts a day by the app\'s own clock, not UTC', () => {
    // 22:30 UTC is already the next morning in Riyadh (UTC+3)
    expect(dayKey(new Date('2026-10-14T22:30:00Z'), 'Asia/Riyadh')).toBe('2026-10-15');
    expect(dayKey(new Date('2026-10-14T22:30:00Z'), 'UTC')).toBe('2026-10-14');
  });

  it('forgets days older than 90, and reports only the days asked for', () => {
    const at = (daysAgo: number) => new Date(NOON.getTime() - daysAgo * 86_400_000);
    for (const ago of [100, 91, 40, 7, 6, 1, 0]) recordUsage('chat', { input_tokens: 1, output_tokens: 1 }, at(ago));
    recordUsage('chat', { input_tokens: 1, output_tokens: 1 }, NOON);
    expect(state.usageLog.some((r) => r.day < '2026-07-15')).toBe(false);
    expect(recentUsage(30, NOON).map((r) => r.day)).toEqual(['2026-10-07', '2026-10-08', '2026-10-13', '2026-10-14']);
    expect(recentUsage(7, NOON).map((r) => r.day)).toEqual(['2026-10-08', '2026-10-13', '2026-10-14']);
  });

  it('ignores nonsense numbers instead of corrupting the totals', () => {
    recordUsage('chat', { input_tokens: -5, output_tokens: Number.NaN as never, cache_read_input_tokens: null }, NOON);
    expect(Object.values(state.usageLog[0]).filter((v) => typeof v === 'number').every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
  });
});

describe('every Claude request is counted under what it was for', () => {
  it('records the tokens Claude reports, for the feature that asked', async () => {
    await create({ purpose: 'email-digest', system: 's', messages: [{ role: 'user', content: 'hi' }], effort: 'low', maxTokens: 100 });
    await create({ purpose: 'whatsapp', system: 's', messages: [{ role: 'user', content: 'hi' }], effort: 'low', maxTokens: 100 });
    const today = state.usageLog.map(({ purpose, input, cached, output, requests }) => ({ purpose, input, cached, output, requests }));
    expect(today).toEqual([
      { purpose: 'email-digest', input: 110, cached: 50, output: 20, requests: 1 },
      { purpose: 'whatsapp', input: 110, cached: 50, output: 20, requests: 1 },
    ]);
    expect(state.usage.requests).toBe(2);
  });
});

describe('the admin portal', () => {
  it('serves the usage rows only to a signed-in owner', async () => {
    const inner = createInnerApp();
    inner.get('*', (_req, res) => res.send('<!doctype html>'));
    const site = await listen(createOnlineSite(inner, { password: 'correct-horse-battery', secret: 'test-secret' }));
    try {
      recordUsage('chat', { input_tokens: 5, output_tokens: 2 });
      expect((await raw(site.port, 'GET', '/api/admin')).status).toBe(401);
      const unlock = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: 'correct-horse-battery' }) });
      const cookie = String(unlock.headers['set-cookie']).split(';')[0];
      const overview = (await raw(site.port, 'GET', '/api/admin', { headers: { cookie } })).json() as AdminOverview;
      expect(overview.usageLog).toHaveLength(1);
      expect(overview.usageLog[0]).toMatchObject({ purpose: 'chat', input: 5, output: 2, requests: 1 });
      expect(overview.usage.requests).toBe(1);
    } finally {
      await site.close();
    }
  });
});
