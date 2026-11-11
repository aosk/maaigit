import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/trading-routes',
    MAAI_DATA_FILE: '/tmp/claude-0/trading-routes/store.json',
    MAAI_TRADING_FILE: '/tmp/claude-0/trading-routes/trading.json',
    MAAI_TRADING_QUOTES: 'sim',
    ASANA_TOKEN: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    GOOGLE_CALENDAR_ICS_URL: '',
  });
});

vi.mock('../ai/claude.js', async (original) => ({ ...(await original<typeof import('../ai/claude')>()), client: null }));

import { createInnerApp, createOnlineSite } from '../site';
import { listen, raw } from '../security/helpers';
import { resetTradeBotLimits } from '../routes/tradeBot';
import { submit, setMode } from './executor';
import { emit, resetTrading, trading } from './store';

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
  resetTrading();
  resetTradeBotLimits();
});

const asUser = (method: string, path: string, body?: unknown) =>
  raw(site.port, method, `/api${path}`, { body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie, origin: `http://127.0.0.1:${site.port}` } });
const asBot = (method: string, path: string, key: string, body?: unknown) =>
  raw(site.port, method, `/trade/v1${path}`, { body: body === undefined ? undefined : JSON.stringify(body), headers: { authorization: `Bearer ${key}` } });

async function botKey() {
  const made = await asUser('POST', '/trading/bot/key');
  return (made.json() as { key: string }).key;
}

describe('StockSmart for the user', () => {
  it('is behind the sign-in, like the rest of MAAI', async () => {
    expect((await raw(site.port, 'GET', '/api/trading')).status).toBe(401);
    const res = await asUser('GET', '/trading');
    expect(res.status).toBe(200);
    expect(res.json()).toMatchObject({ mode: 'paper', halted: false, limits: { capital: 100_000 } });
  });

  it('stops with one tap and starts again only when the user says so', async () => {
    expect((await asUser('POST', '/trading/halt', { reason: 'test' })).json()).toMatchObject({ halted: true, haltReason: 'test' });
    expect((await asUser('POST', '/trading/resume')).json()).toMatchObject({ halted: false });
  });

  it('refuses real money without the typed confirmation, a connected bot, and its SNB login', async () => {
    expect((await asUser('POST', '/trading/mode', { mode: 'live' })).status).toBe(400);
    expect((await asUser('POST', '/trading/mode', { mode: 'live', confirm: 'LIVE' })).status).toBe(409);
    const key = await botKey();
    await asBot('POST', '/heartbeat', key, { brokerSession: false });
    expect((await asUser('POST', '/trading/mode', { mode: 'live', confirm: 'LIVE' })).json()).toMatchObject({ error: expect.stringMatching(/logged in/) });
    await asBot('POST', '/heartbeat', key, { brokerSession: true });
    expect((await asUser('POST', '/trading/mode', { mode: 'live', confirm: 'LIVE' })).json()).toMatchObject({ mode: 'live' });
  });

  it('keeps every limit within a sensible range and logs each change', async () => {
    expect((await asUser('PUT', '/trading/limits', { dailyLossPct: 50 })).status).toBe(400);
    const res = await asUser('PUT', '/trading/limits', { capital: 20_000, maxOrder: 2_000 });
    expect(res.json()).toMatchObject({ limits: { capital: 20_000, maxOrder: 2_000 }, cash: 20_000 });
    expect(trading.events.at(-1)?.text).toMatch(/capital: 100000 → 20000/);
  });

  it('B-12: a limit must be a real number or a numeric string, not an array, object or NaN', async () => {
    for (const bad of [[5000], { v: 5000 }, null, true, '', 'abc', 'Infinity']) {
      expect((await asUser('PUT', '/trading/limits', { capital: bad })).status).toBe(400);
    }
    expect((await asUser('PUT', '/trading/limits', { capital: '120000' })).status).toBe(200);
  });

  it('moves the paper money with the capital even while stocks are held, keeping the profit so far', async () => {
    const paper = trading.books.paper;
    paper.cash = 60_000;
    paper.positions = [{ symbol: '2222', qty: 1000, avgCost: 40 }];
    paper.dayStart.value = 100_000;
    const res = await asUser('PUT', '/trading/limits', { capital: 150_000 });
    expect(res.status).toBe(200);
    expect(paper.cash).toBe(110_000);
    expect(paper.dayStart.value).toBe(150_000);
    expect(paper.positions).toHaveLength(1);
    expect(trading.events.at(-1)?.text).toMatch(/الكاش التجريبي زاد/);
    // Less than what is invested: refused, and nothing changes.
    const tooLow = await asUser('PUT', '/trading/limits', { capital: 30_000 });
    expect(tooLow.status).toBe(409);
    expect(tooLow.json()).toMatchObject({ error: expect.stringMatching(/at least 40000/) });
    expect(trading.limits.capital).toBe(150_000);
    expect(paper.cash).toBe(110_000);
  });

  it('keeps instructions and exclusions the agents must follow', async () => {
    await asUser('POST', '/trading/directives', { text: 'لا تشتري بنوك اليوم' });
    await asUser('PUT', '/trading/excluded', { excluded: ['banks', '2222', 'not-a-stock'] });
    expect(trading.directives[0].text).toBe('لا تشتري بنوك اليوم');
    expect(trading.excluded).toEqual(['banks', '2222']);
  });

  it('streams the log as it happens, resuming after the last event the browser saw', async () => {
    emit('agent.observation', 'technical', 'already seen');
    const first = emit('agent.observation', 'technical', 'before');
    const got = await new Promise<string>((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port: site.port, path: '/api/trading/stream', headers: { cookie, 'last-event-id': String(first.id - 1) } }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
          if (body.includes('after')) {
            req.destroy();
            resolve(body);
          }
        });
        setTimeout(() => emit('agent.observation', 'news', 'after'), 50);
      });
      req.on('error', (e) => (e.message.includes('socket hang up') ? undefined : reject(e)));
    });
    expect(got).toContain(`id: ${first.id}`);
    expect(got).toContain('"text":"before"');
    expect(got).toContain('"text":"after"');
    expect(got).not.toContain('already seen');
  });
});

describe('the SNB desktop bot’s door', () => {
  it('does not exist until a key is made, and refuses a wrong key', async () => {
    expect((await asBot('GET', '/commands', 'stk_x')).status).toBe(404);
    const key = await botKey();
    expect((await asBot('GET', '/commands', 'stk_wrong')).status).toBe(401);
    expect((await asBot('GET', '/commands', key)).json()).toMatchObject({ commands: [], mode: 'paper' });
  });

  it('cannot reach the user’s API with its key', async () => {
    const key = await botKey();
    expect((await raw(site.port, 'GET', '/api/trading', { headers: { authorization: `Bearer ${key}` } })).status).toBe(401);
  });

  it('gets the live order, acknowledges it, checks it may still go, and reports the fill', async () => {
    const key = await botKey();
    await asBot('POST', '/heartbeat', key, { brokerSession: true });
    setMode('live', 'user', 'live');
    const order = submit('d1', '2222', 'buy', 10, 27.4);
    const { commands } = (await asBot('GET', '/commands', key)).json() as { commands: { commandId: string; sig: string }[] };
    expect(commands.map((c) => c.commandId)).toEqual([order.id]);
    expect((await asBot('POST', '/ack', key, { commandId: order.id })).status).toBe(204);
    expect((await asBot('GET', `/go/${order.id}`, key)).json()).toEqual({ go: true });
    expect((await asBot('POST', '/result', key, { commandId: order.id, status: 'filled', filledQty: 10, avgPrice: 27.4, brokerOrderId: 'SNB-1' })).status).toBe(204);
    expect(order.status).toBe('filled');
    expect((await asBot('POST', '/positions', key, { cash: 1000, positions: [{ symbol: '2222', qty: 10, avgCost: 27.4 }] })).json()).toEqual({ drift: false });
  });

  it('halts real trading when the bot loses its SNB login', async () => {
    const key = await botKey();
    await asBot('POST', '/heartbeat', key, { brokerSession: true });
    setMode('live', 'user', 'live');
    await asBot('POST', '/heartbeat', key, { brokerSession: false });
    expect(trading.halted).toBe(true);
  });

  it('rejects malformed reports', async () => {
    const key = await botKey();
    expect((await asBot('POST', '/result', key, { commandId: 'x', status: 'filled' })).status).toBe(400);
    expect((await asBot('POST', '/positions', key, { cash: -1, positions: [] })).status).toBe(400);
    expect((await asBot('POST', '/positions', key, { cash: 1, positions: [{ symbol: 'ABC', qty: 1 }] })).status).toBe(400);
  });
});
