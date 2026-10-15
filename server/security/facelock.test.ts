import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGuard } from '../auth';
import { listen, raw, type Reply } from './helpers';

const PASSWORD = 'correct-horse-battery';
const MINUTE = 60_000;

let clock = Date.parse('2026-10-15T09:00:00Z');
let faceSetUp = false;
const guard = createGuard('password', PASSWORD, 'secret-one', () => clock, { lockActive: () => faceSetUp, lockMinutes: 5 });
const other = createGuard('password', PASSWORD, 'secret-two', () => clock, { lockActive: () => true, lockMinutes: 5 });

let site: Awaited<ReturnType<typeof listen>>;
let otherSite: Awaited<ReturnType<typeof listen>>;
beforeAll(async () => {
  const build = (g: typeof guard) => {
    const app = express();
    app.use(express.json());
    app.post('/api/face-login', (_req, res) => {
      g.startSession(res);
      res.status(204).end();
    });
    app.use('/api', g);
    app.get('/api/ping', (_req, res) => res.json({ ok: true }));
    return app;
  };
  site = await listen(build(guard));
  otherSite = await listen(build(other));
});
afterAll(async () => {
  await site.close();
  await otherSite.close();
});
beforeEach(() => {
  clock = Date.parse('2026-10-15T09:00:00Z');
  faceSetUp = false;
});

const cookies = (res: Reply) => ((res.headers['set-cookie'] ?? [])).map((c) => c.split(';')[0]);
const named = (res: Reply, name: string) => ((res.headers['set-cookie'] ?? [])).find((c) => c.startsWith(`${name}=`));
const unlock = async (s = site) => raw(s.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: PASSWORD }) });
const ping = (jar: string[], s = site, background = false) => raw(s.port, 'GET', '/api/ping', { headers: { cookie: jar.join('; '), ...(background ? { 'x-maai-background': '1' } : {}) } });

describe('the app locks itself once Face ID is set up', () => {
  it('asks for nothing extra until Face ID is set up', async () => {
    const res = await unlock();
    expect(cookies(res)).toHaveLength(2);
    expect((await ping([cookies(res)[0]])).status).toBe(200); // the long session alone is enough
  });

  it('then needs the long session and a recent unlock, and says which one is missing', async () => {
    const jar = cookies(await unlock());
    faceSetUp = true;
    expect((await ping(jar)).status).toBe(200);
    const sessionOnly = await ping([jar[0]]);
    expect(sessionOnly.status).toBe(401);
    expect(sessionOnly.json()).toEqual({ error: 'locked', kind: 'password', face: true });
    const faceOnly = await ping([jar[1]]);
    expect(faceOnly.status).toBe(401);
    expect(faceOnly.json()).toEqual({ error: 'locked', kind: 'password' }); // not signed in at all: no Face ID hint
  });

  it('locks again after five minutes unused, and Face ID (or the password) opens it', async () => {
    const jar = cookies(await unlock());
    faceSetUp = true;
    clock += 6 * MINUTE;
    const locked = await ping(jar);
    expect(locked.status).toBe(401);
    expect((locked.json() as { face?: boolean }).face).toBe(true);

    const login = await raw(site.port, 'POST', '/api/face-login', { body: '{}' });
    expect(login.status).toBe(204);
    expect((await ping(cookies(login))).status).toBe(200);
    // the password does the same
    expect((await ping(cookies(await unlock()))).status).toBe(200);
  });

  it('stays open while it is being used, by renewing the unlock as it goes', async () => {
    let jar = cookies(await unlock());
    faceSetUp = true;
    clock += 1 * MINUTE;
    const early = await ping(jar);
    expect(named(early, 'maai_face')).toBeUndefined(); // plenty of time left: nothing renewed
    clock += 2 * MINUTE; // now less than half is left
    const renewed = await ping(jar);
    expect(renewed.status).toBe(200);
    expect(named(renewed, 'maai_face')).toBeDefined();
    jar = [jar[0], cookies(renewed).find((c) => c.startsWith('maai_face='))!];
    clock += 4 * MINUTE; // past the first unlock's end, inside the renewed one
    expect((await ping(jar)).status).toBe(200);
  });

  it('is not kept open by the app\'s own automatic refreshes, only by real use', async () => {
    const jar = cookies(await unlock());
    faceSetUp = true;
    clock += 3 * MINUTE; // less than half the time is left
    const refresh = await ping(jar, site, true);
    expect(refresh.status).toBe(200); // still open, so it keeps working…
    expect(named(refresh, 'maai_face')).toBeUndefined(); // …but is not extended
    clock += 3 * MINUTE; // an app left open on a table, refreshing by itself
    expect((await ping(jar, site, true)).status).toBe(401);

    const fresh = cookies(await unlock());
    clock += 3 * MINUTE;
    expect(named(await ping(fresh), 'maai_face')).toBeDefined(); // a tap or a screen change does extend it
  });

  it('does not renew a lapsed unlock just because the app asked', async () => {
    const jar = cookies(await unlock());
    faceSetUp = true;
    clock += 10 * MINUTE;
    const res = await ping(jar);
    expect(res.status).toBe(401);
    expect(named(res, 'maai_face')).toBeUndefined();
  });

  it('locks at once if Face ID is set up while a session is open elsewhere', async () => {
    const jar = [cookies(await unlock())[0]];
    expect((await ping(jar)).status).toBe(200);
    faceSetUp = true;
    expect((await ping(jar)).status).toBe(401);
  });

  it('cannot be forged: wrong signature, another server, stretched expiry', async () => {
    const jar = cookies(await unlock());
    faceSetUp = true;
    const [expires, signature] = jar[1].split('=')[1].split('.');
    expect((await ping([jar[0], `maai_face=${expires}.${signature.replace(/.$/, signature.endsWith('0') ? '1' : '0')}`])).status).toBe(401);
    expect((await ping([jar[0], `maai_face=${Number(expires) + 86_400}.${signature}`])).status).toBe(401); // a later expiry does not carry the old signature
    // an unlock from a different MAAI (other secret) means nothing here
    const foreign = cookies(await unlock(otherSite));
    expect((await ping([jar[0], foreign[1]])).status).toBe(401);
    expect((await ping([jar[0], 'maai_face=99999999999.' + 'a'.repeat(64)])).status).toBe(401);
    expect((await ping([jar[0], 'maai_face=garbage'])).status).toBe(401);
  });

  it('sets both cookies with the same protections, the unlock one short-lived', async () => {
    const res = await unlock();
    const face = named(res, 'maai_face')!;
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) expect(face).toContain(part);
    expect(face).toContain('Max-Age=300');
    expect(named(res, 'maai_session')).toContain('Max-Age=2592000');
  });

  it('signing out clears both', async () => {
    const res = await raw(site.port, 'POST', '/api/logout', { body: '{}' });
    expect(named(res, 'maai_session')).toContain('Max-Age=0');
    expect(named(res, 'maai_face')).toContain('Max-Age=0');
  });
});
