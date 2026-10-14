import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';

vi.hoisted(() => {
  process.env.MAAI_DATA_DIR = '/tmp/claude-0/security-data';
  process.env.MAAI_DATA_FILE = '/tmp/claude-0/security-data/store.json';
  process.env.ASANA_TOKEN = '';
});

import { createGuard } from '../auth';
import { createApp, createInnerApp, createOnlineSite } from '../site';
import { api } from '../routes/index';
import { listen, listRoutes, raw, type Reply } from './helpers';

const PASSWORD = 'correct-horse-battery';

let site: Awaited<ReturnType<typeof listen>>;

beforeAll(async () => {
  const inner = createInnerApp();
  // What the real server does for the page itself: anything that is not the API gets the app.
  inner.get('*', (_req, res) => res.type('html').send('<!doctype html><title>MAAI</title>'));
  site = await listen(createOnlineSite(inner, { password: PASSWORD, secret: 'test-secret' }));
});
afterAll(() => site.close());

/** Signs in and returns the cookie to send. */
async function signIn(): Promise<string> {
  const res = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: PASSWORD }) });
  expect(res.status).toBe(204);
  return String(res.headers['set-cookie']).split(';')[0];
}

/** True when a reply hands over data: a success that is not the page itself. */
const handsOverData = (res: Reply) => res.status < 400 && String(res.headers['content-type'] ?? '').includes('json');

describe('the sign-in cannot be walked around', () => {
  const routes = listRoutes(api);

  it('finds the API routes to test (so the test cannot silently check nothing)', () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.map((r) => r.path)).toEqual(expect.arrayContaining(['/status', '/today', '/chat/stream', '/proposals/abcd1234/approve', '/admin', '/mail/digest', '/asana/tasks', '/notify/subscribe']));
  });

  /** The same address written in the ways attackers try. */
  const disguises = (path: string): string[] => {
    const full = `/api${path}`;
    return [
      full,
      full.toUpperCase(),
      full.replace('/api', '/API'),
      full.replace('/api', '/Api'),
      full.replace('/api', '/aPi'),
      full + '/',
      full.replace('/api', '//api'),
      full.replace('/api', '/api//'),
      full.replace('/api', '/api/.'),
      full.replace('/api', '/%61pi'),
      full.replace('/api', '/%41PI'),
      full.replace('/api/', '/api%2f'),
      full + '?x=1',
      full + ';a=b',
      full.replace('/api', '/./api'),
      full.replace('/api', '/x/../api'),
    ];
  };

  for (const { method, path } of routes) {
    it(`${method} /api${path} gives nothing to a visitor who is not signed in, however it is written`, async () => {
      for (const address of disguises(path)) {
        const res = await raw(site.port, method, address, method === 'GET' ? {} : { body: '{}' });
        expect(handsOverData(res), `${method} ${address} answered ${res.status}: ${res.body.slice(0, 80)}`).toBe(false);
      }
    });
  }

  it('does answer the owner, on the exact address', async () => {
    const cookie = await signIn();
    const res = await raw(site.port, 'GET', '/api/status', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.json()).toHaveProperty('auth', 'password');
  });

  it('turns away a made-up, truncated or altered session cookie', async () => {
    const real = (await signIn()).split('=')[1];
    for (const value of ['', 'a', 'deadbeef', real.slice(0, -1), real.slice(0, -1) + (real.endsWith('0') ? '1' : '0'), real + '00', 'x'.repeat(5000), real.toUpperCase()]) {
      const res = await raw(site.port, 'GET', '/api/status', { headers: { cookie: `maai_session=${value}` } });
      expect(res.status, `cookie ${value.slice(0, 20)}`).toBe(401);
    }
  });

  it('sets a session cookie browsers will not expose to scripts or send from other sites', async () => {
    const res = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: PASSWORD }) });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).not.toContain(PASSWORD);
  });

  it('keeps the health check and the page reachable, and reveals nothing in them', async () => {
    const health = await raw(site.port, 'GET', '/api/health');
    expect(health.json()).toEqual({ ok: true });
    expect((await raw(site.port, 'GET', '/')).status).toBe(200);
  });

  it('signs out', async () => {
    const res = await raw(site.port, 'POST', '/api/logout');
    expect(String(res.headers['set-cookie'])).toMatch(/Max-Age=0/);
  });
});

describe('the check itself works (a control: the old, flawed sign-in must be caught)', () => {
  it('flags a site whose guard compares the path case-sensitively, as the first version did', async () => {
    const vulnerable = express(); // default Express: matches /API and /api alike
    vulnerable.use((req, res, next) => {
      if (!req.path.startsWith('/api')) return next(); // the old check
      res.status(401).json({ error: 'locked' });
    });
    vulnerable.use('/api', api);
    const s = await listen(vulnerable);
    const leaked = [];
    for (const address of ['/api/status', '/API/status', '/Api/today', '/aPi/admin']) {
      const res = await raw(s.port, 'GET', address);
      if (handsOverData(res)) leaked.push(address);
    }
    expect(leaked).toEqual(['/API/status', '/Api/today', '/aPi/admin']);
    await s.close();
  });
});

describe('guessing the password', () => {
  /** A guard with a clock the test controls, on a bare app. */
  async function guarded(clock: { now: number }) {
    const app = createApp();
    app.use(express.json());
    app.use('/api', createGuard('password', PASSWORD, 'secret', () => clock.now));
    app.get('/api/secret', (_req, res) => res.json({ secret: true }));
    return listen(app);
  }
  const attempt = (port: number, pin: string) => raw(port, 'POST', '/api/unlock', { body: JSON.stringify({ pin }) });

  it('locks after five wrong tries, even for the right password, and says how long', async () => {
    const clock = { now: 1_000_000 };
    const s = await guarded(clock);
    for (let i = 0; i < 5; i++) expect((await attempt(s.port, `wrong-${i}`)).status).toBe(401);
    const locked = await attempt(s.port, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBe('60');
    await s.close();
  });

  it('locks for twice as long each round, up to an hour, and a good sign-in starts over', async () => {
    const clock = { now: 1_000_000 };
    const s = await guarded(clock);
    const fail5 = async () => {
      for (let i = 0; i < 5; i++) await attempt(s.port, 'nope');
    };
    const waits: string[] = [];
    for (let round = 0; round < 9; round++) {
      await fail5();
      const locked = await attempt(s.port, PASSWORD);
      waits.push(String(locked.headers['retry-after']));
      clock.now += Number(locked.headers['retry-after']) * 1000 + 1;
    }
    expect(waits).toEqual(['60', '120', '240', '480', '960', '1920', '3600', '3600', '3600']);
    expect((await attempt(s.port, PASSWORD)).status).toBe(204);
    await fail5();
    expect((await attempt(s.port, PASSWORD)).headers['retry-after']).toBe('60');
    await s.close();
  });

  it('lets a wrong try followed by the right password in', async () => {
    const s = await guarded({ now: 1 });
    await attempt(s.port, 'nope');
    expect((await attempt(s.port, PASSWORD)).status).toBe(204);
    await s.close();
  });

  it('does not accept the password in any other form (numbers, arrays, objects, missing)', async () => {
    const s = await guarded({ now: 1 });
    for (const body of ['{}', '{"pin":123}', '{"pin":[]}', '{"pin":{"a":1}}', `{"pin":["${PASSWORD}"]}`, '{"pin":null}', '{"password":"' + PASSWORD + '"}']) {
      expect((await raw(s.port, 'POST', '/api/unlock', { body })).status, body).toBe(401);
      await raw(s.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: PASSWORD }) }); // resets the counter
    }
    await s.close();
  });
});
