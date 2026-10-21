import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/health-data',
    MAAI_DATA_FILE: '/tmp/claude-0/health-data/store.json',
    ASANA_TOKEN: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    GOOGLE_CALENDAR_ICS_URL: '',
    TWILIO_ACCOUNT_SID: '',
  });
});

vi.mock('./ai/claude.js', async (original) => ({ ...(await original<typeof import('./ai/claude')>()), client: {}, create: vi.fn() }));

import { createInnerApp, createOnlineSite } from './site';
import { listen, raw } from './security/helpers';
import { healthReport, watchHealth } from './health';
import { failed, ok, resetSignals } from './signals';
import { createKey } from './bot';
import { state } from './store';

const PASSWORD = 'correct-horse-battery';
let site: Awaited<ReturnType<typeof listen>>;
let cookie = '';

beforeAll(async () => {
  site = await listen(createOnlineSite(createInnerApp(), { password: PASSWORD, secret: 'test-secret' }));
  const res = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: PASSWORD }) });
  cookie = String(res.headers['set-cookie']).split(';')[0];
});
afterAll(() => site.close());

beforeEach(() => {
  resetSignals();
  state.bot = { commands: [] };
  state.replyMode = 'smart';
  state.alerts = [];
  state.notifyPrefs.health = true;
});

const check = (id: string) => healthReport().checks.find((c) => c.id === id)!;

describe('the health check', () => {
  it('reports every part, with the worst as the overall status', () => {
    const report = healthReport();
    expect(report.checks.map((c) => c.id)).toEqual(expect.arrayContaining(['server', 'storage', 'claude', 'bot', 'gmail', 'calendar', 'asana', 'push']));
    expect(report.checks.filter((c) => c.status !== 'ok' && c.status !== 'off').map((c) => `${c.id}: ${c.detail}`)).toEqual([]);
    expect(check('bot')).toMatchObject({ status: 'off' });
  });

  it('turns red when the last Claude call failed, and green when one works again', () => {
    failed('claude', '402: Your credit balance is too low');
    expect(check('claude')).toMatchObject({ status: 'fail', fix: expect.stringContaining('credit') });
    expect(healthReport().status).toBe('fail');
    ok('claude', 1200);
    expect(check('claude')).toMatchObject({ status: 'ok', detail: expect.stringContaining('1.2 s') });
  });

  it('warns about a silent device bot, fails after two hours, and names an outdated bot', () => {
    createKey();
    state.bot.lastSeen = new Date(Date.now() - 10 * 60_000).toISOString();
    expect(check('bot')).toMatchObject({ status: 'warn', fix: expect.stringContaining('npm start') });
    state.bot.lastSeen = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(check('bot').status).toBe('fail');
    state.bot.lastSeen = new Date().toISOString();
    state.bot.version = 'old-one';
    expect(check('bot')).toMatchObject({ status: 'warn', detail: expect.stringContaining('newest') });
  });

  it('tells the phones once when a part breaks and once when it recovers', async () => {
    await watchHealth(); // learns the starting point
    failed('claude', '529: overloaded');
    await watchHealth();
    await watchHealth(); // still broken: no second alert
    ok('claude');
    await watchHealth();
    expect(state.alerts.map((a) => a.title)).toEqual(['🩺 Claude AI works again', '🩺 Claude AI stopped working']);
  });

  it('is only for the signed-in user; the public check says up or down and nothing else', async () => {
    expect((await raw(site.port, 'GET', '/api/admin/health')).status).toBe(401);
    const mine = await raw(site.port, 'GET', '/api/admin/health', { headers: { cookie } });
    expect(JSON.parse(mine.body)).toMatchObject({ status: expect.any(String), checks: expect.any(Array) });
    const open = await raw(site.port, 'GET', '/api/health');
    expect([open.status, JSON.parse(open.body)]).toEqual([200, { ok: true }]);
    failed('storage', 'ENOSPC: no space left on device');
    const down = await raw(site.port, 'GET', '/api/health');
    expect([down.status, JSON.parse(down.body)]).toEqual([503, { ok: false }]);
  });
});
