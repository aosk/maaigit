import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const FAKE = vi.hoisted(() => {
  const keys = { normal: 'sk-ant-api03-R2DABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-igAA', admin: 'sk-ant-admin01-SECRETADMINKEY0123456789' };
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/cloud-data',
    MAAI_DATA_FILE: '/tmp/claude-0/cloud-data/store.json',
    ANTHROPIC_API_KEY: keys.normal,
    ANTHROPIC_ADMIN_KEY: keys.admin,
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:45875',
    ASANA_TOKEN: '',
    GOOGLE_CALENDAR_ICS_URL: '',
  });
  return { port: 45875, keys };
});

import { create } from './ai/claude';
import { latestRateLimits, noteRateLimits, resetRateLimits } from './anthropic-limits';
import { cloudUsage, forgetCloudUsage, keyHint, matchKey } from './anthropic-usage';
import { createInnerApp, createOnlineSite } from './site';
import { listen, raw } from './security/helpers';

const seen: { url: string; key: string }[] = [];
let mode: 'ok' | 'forbidden' | 'no-match' | 'paged' = 'ok';
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const url = new URL(req.url ?? '', 'http://x');
      seen.push({ url: req.url ?? '', key: String(req.headers['x-api-key'] ?? '') });
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/v1/messages') {
        res.setHeader('anthropic-ratelimit-requests-limit', '1000');
        res.setHeader('anthropic-ratelimit-requests-remaining', '997');
        res.setHeader('anthropic-ratelimit-requests-reset', '2026-10-15T09:01:00Z');
        res.setHeader('anthropic-ratelimit-input-tokens-limit', '2000000');
        res.setHeader('anthropic-ratelimit-input-tokens-remaining', '1990000');
        res.setHeader('anthropic-ratelimit-output-tokens-limit', 'not a number');
        return void res.end(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
      }
      if (mode === 'forbidden') return void res.writeHead(403).end(JSON.stringify({ error: { type: 'permission_error', message: 'This endpoint requires an Admin API key.' } }));
      if (url.pathname === '/v1/organizations/api_keys') {
        const data = [
          { id: 'apikey_other', name: 'Another key', partial_key_hint: 'sk-ant-api03-ZZZ...QQQQ', status: 'active', scope: { type: 'workspace' } },
          ...(mode === 'no-match' ? [] : [{ id: 'apikey_maai', name: 'MAAI on Render', partial_key_hint: 'sk-ant-api03-R2D...igAA', status: 'active', scope: { type: 'workspace' } }]),
        ];
        return void res.end(JSON.stringify({ data, has_more: false }));
      }
      if (url.pathname === '/v1/organizations/usage_report/messages') {
        const bucket = (day: string, n: number) => ({ starting_at: `${day}T00:00:00Z`, ending_at: `${day}T23:59:59Z`, results: [{ uncached_input_tokens: 1000 * n, cache_read_input_tokens: 500 * n, cache_creation: { ephemeral_1h_input_tokens: 100 * n, ephemeral_5m_input_tokens: 50 * n }, output_tokens: 200 * n }] });
        if (mode === 'paged' && !url.searchParams.get('page')) return void res.end(JSON.stringify({ data: [bucket('2026-10-13', 1)], has_more: true, next_page: 'page_2' }));
        return void res.end(JSON.stringify({ data: mode === 'paged' ? [bucket('2026-10-14', 2)] : [bucket('2026-10-14', 2), bucket('2026-10-15', 3), { starting_at: '2026-10-12T00:00:00Z', ending_at: '2026-10-12T23:59:59Z', results: [] }], has_more: false, next_page: null }));
      }
      if (url.pathname === '/v1/organizations/cost_report') {
        return void res.end(JSON.stringify({ data: [{ starting_at: '2026-10-14T00:00:00Z', results: [{ amount: '123.45', currency: 'USD' }, { amount: '1.55', currency: 'USD' }] }, { starting_at: '2026-10-15T00:00:00Z', results: [{ amount: '250', currency: 'USD' }] }], has_more: false }));
      }
      res.writeHead(404).end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(FAKE.port, '127.0.0.1', resolve));
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  seen.length = 0;
  mode = 'ok';
  forgetCloudUsage();
  resetRateLimits();
});

const NOW = new Date('2026-10-15T09:00:00Z');

describe('the rate limits Anthropic reports', () => {
  it('are kept from the headers of every answer MAAI gets', async () => {
    await create({ purpose: 'chat', system: 's', messages: [{ role: 'user', content: 'hi' }], effort: 'low', maxTokens: 50 });
    const limits = latestRateLimits()!;
    expect(limits.requests).toEqual({ limit: 1000, remaining: 997, resetAt: '2026-10-15T09:01:00.000Z' });
    expect(limits.inputTokens).toMatchObject({ limit: 2_000_000, remaining: 1_990_000 });
    expect(limits.outputTokens).toBeUndefined(); // "not a number" is ignored, not shown as NaN
  });

  it('ignore answers without them and nonsense values', () => {
    noteRateLimits(new Headers({ 'content-type': 'application/json' }));
    expect(latestRateLimits()).toBeUndefined();
    noteRateLimits(new Headers({ 'anthropic-ratelimit-requests-limit': '-5', 'anthropic-ratelimit-requests-remaining': 'abc' }));
    expect(latestRateLimits()).toBeUndefined();
    noteRateLimits(new Headers({ 'anthropic-ratelimit-tokens-limit': '100', 'anthropic-ratelimit-tokens-remaining': '40', 'anthropic-ratelimit-tokens-reset': 'tomorrow-ish' }));
    expect(latestRateLimits()!.tokens).toEqual({ limit: 100, remaining: 40, resetAt: undefined });
  });
});

describe('finding the key MAAI uses', () => {
  it('matches Anthropic\'s partial hint by how the key starts and ends, and only then', () => {
    const rows = [{ id: 'a', name: 'A', partial_key_hint: 'sk-ant-api03-R2D...igAA', status: 'active' }, { id: 'b', name: 'B', partial_key_hint: null, status: 'active' }];
    expect(matchKey(rows, FAKE.keys.normal)?.id).toBe('a');
    expect(matchKey(rows, 'sk-ant-api03-R2D-something-else-ZZZZ')).toBeUndefined();
    expect(matchKey(rows, 'sk-ant-api03-OTHER-igAA')).toBeUndefined();
    expect(matchKey([{ id: 'c', name: 'C', partial_key_hint: '...', status: 'active' }], 'anything')).toBeUndefined();
  });

  it('shows only how the key ends', () => {
    expect(keyHint(FAKE.keys.normal)).toBe('sk-ant-…igAA');
    expect(keyHint('')).toBe('');
  });
});

describe('usage and cost from Anthropic\'s cloud', () => {
  it('reads this key\'s tokens per day and the organization\'s cost, using the admin key', async () => {
    const usage = await cloudUsage({ now: NOW });
    expect(usage.reports).toBe('ok');
    expect(usage.scope).toBe('key');
    expect(usage.key).toMatchObject({ hint: 'sk-ant-…igAA', matched: true, name: 'MAAI on Render', id: 'apikey_maai', status: 'active' });
    expect(usage.days.find((d) => d.day === '2026-10-14')).toEqual({ day: '2026-10-14', uncachedInput: 2000, cacheRead: 1000, cacheWrite: 300, output: 400 });
    expect(usage.days.find((d) => d.day === '2026-10-12')).toMatchObject({ uncachedInput: 0, output: 0 });
    // amounts come in cents as decimal strings: 123.45 + 1.55 = 125 cents on the 14th, 250 on the 15th
    expect(usage.cost).toEqual({ days: [{ day: '2026-10-14', usd: 1.25 }, { day: '2026-10-15', usd: 2.5 }], last30: 3.75, today: 2.5 });
    // the report was limited to this key, and asked with the admin key (never the normal one)
    const report = seen.find((r) => r.url.includes('usage_report'))!;
    expect(report.url).toContain('api_key_ids%5B%5D=apikey_maai');
    expect(seen.filter((r) => r.url.startsWith('/v1/organizations')).every((r) => r.key === FAKE.keys.admin)).toBe(true);
  });

  it('follows pages', async () => {
    mode = 'paged';
    const usage = await cloudUsage({ now: NOW });
    expect(usage.days.map((d) => d.day)).toEqual(['2026-10-13', '2026-10-14']);
  });

  it('says so, and shows the whole organization, when it cannot tell which key is MAAI\'s', async () => {
    mode = 'no-match';
    const usage = await cloudUsage({ now: NOW });
    expect(usage.scope).toBe('organization');
    expect(usage.key.matched).toBe(false);
    expect(usage.message).toMatch(/could not tell which key/);
    expect(seen.find((r) => r.url.includes('usage_report'))!.url).not.toContain('api_key_ids');
  });

  it('explains what to do when Anthropic will not share usage with this credential', async () => {
    mode = 'forbidden';
    const usage = await cloudUsage({ now: NOW });
    expect(usage.reports).toBe('needs-admin-key');
    expect(usage.message).toMatch(/ANTHROPIC_ADMIN_KEY/);
    expect(usage.message).toMatch(/requires an Admin API key/);
    expect(usage.days).toEqual([]);
  });

  it('asks Anthropic at most every five minutes unless told to refresh', async () => {
    await cloudUsage({ now: NOW });
    const first = seen.length;
    await cloudUsage({ now: new Date(NOW.getTime() + 60_000) });
    expect(seen.length).toBe(first);
    await cloudUsage({ now: new Date(NOW.getTime() + 60_000), force: true });
    expect(seen.length).toBeGreaterThan(first);
  });

  it('never puts a full key in what it returns', async () => {
    mode = 'forbidden';
    const text = JSON.stringify(await cloudUsage({ now: NOW, force: true })) + JSON.stringify(await cloudUsage({ now: NOW, force: true }));
    expect(text).not.toContain(FAKE.keys.admin);
    expect(text).not.toContain(FAKE.keys.normal);
    expect(text).not.toContain('SECRETADMINKEY');
  });
});

describe('the admin portal route', () => {
  it('needs the sign-in, and never reveals a key', async () => {
    const inner = createInnerApp();
    inner.get('*', (_req, res) => res.send('<!doctype html>'));
    const site = await listen(createOnlineSite(inner, { password: 'correct-horse-battery', secret: 'test-secret' }));
    try {
      expect((await raw(site.port, 'GET', '/api/admin/cloud')).status).toBe(401);
      const unlock = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: 'correct-horse-battery' }) });
      const jar = (unlock.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
      const res = await raw(site.port, 'GET', '/api/admin/cloud?refresh=1', { headers: { cookie: jar } });
      expect(res.status).toBe(200);
      expect(res.body).not.toContain(FAKE.keys.admin);
      expect(res.body).not.toContain(FAKE.keys.normal);
      expect(JSON.parse(res.body)).toMatchObject({ reports: 'ok', key: { hint: 'sk-ant-…igAA' } });
    } finally {
      await site.close();
    }
  });
});
