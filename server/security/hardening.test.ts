import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';

// Secrets are set before anything loads, so the tests can look for them in every answer.
const SECRETS = vi.hoisted(() => {
  const secrets = {
    anthropic: 'sk-ant-api03-SECRETSECRETSECRET0123456789',
    gmailUser: 'owner@example.com',
    gmailPass: 'abcdwxyzabcdwxyz',
    asana: '1/1200000000000:deadbeefdeadbeefdeadbeefdeadbeef',
    password: 'correct-horse-battery',
    icsToken: 'private-0123456789abcdef0123456789abcdef',
    privateKey: 'PRIVATEKEYMATERIAL0123456789',
  };
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/hardening-data',
    MAAI_DATA_FILE: '/tmp/claude-0/hardening-data/store.json',
    ANTHROPIC_API_KEY: secrets.anthropic,
    ANTHROPIC_BASE_URL: 'http://127.0.0.1:9',
    ASANA_TOKEN: secrets.asana,
    ASANA_API: 'http://127.0.0.1:9',
    GOOGLE_CALENDAR_API: 'http://127.0.0.1:9',
    GOOGLE_CALENDAR_ID: 'owner@example.com',
    GOOGLE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'maai@p.iam.gserviceaccount.com', private_key: secrets.privateKey, token_uri: 'http://127.0.0.1:9/token' }),
    GOOGLE_CALENDAR_ICS_URL: `https://127.0.0.1:9/calendar/ical/owner%40example.com/${secrets.icsToken}/basic.ics`,
    GMAIL_USER: secrets.gmailUser,
    GMAIL_APP_PASSWORD: secrets.gmailPass,
  });
  return secrets;
});

import { createGuard } from '../auth';
import { isPushServiceUrl } from '../notify';
import { writePrivate } from '../secure-fs';
import { CONTENT_SECURITY_POLICY, bodyErrors, lastResort } from '../security';
import { createApp, createInnerApp, createOnlineSite } from '../site';
import { api } from '../routes/index';
import { explain } from '../routes/http';
import { feedPath } from '../feed';
import { listen, listRoutes, raw } from './helpers';

let site: Awaited<ReturnType<typeof listen>>;
let cookie = '';

beforeAll(async () => {
  const inner = createInnerApp();
  inner.get('*', (_req, res) => res.type('html').send('<!doctype html><title>MAAI</title>'));
  site = await listen(createOnlineSite(inner, { password: SECRETS.password, secret: 'test-secret' }));
  const res = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: SECRETS.password }) });
  cookie = String(res.headers['set-cookie']).split(';')[0];
});
afterAll(() => site.close());

const asOwner = { get headers() { return { cookie }; } };

describe('browser protections', () => {
  const addresses = ['/', '/api/health', '/api/status', '/api/nothing-here', feedPath, '/calendar/not-a-key.ics', '/anything/else'];

  it('sends the protective headers with every kind of answer', async () => {
    for (const address of addresses) {
      const res = await raw(site.port, 'GET', address, { headers: address === '/api/status' ? asOwner.headers : {} });
      expect(res.headers['x-content-type-options'], address).toBe('nosniff');
      expect(res.headers['x-frame-options'], address).toBe('DENY');
      expect(res.headers['referrer-policy'], address).toBe('no-referrer');
      expect(res.headers['strict-transport-security'], address).toMatch(/max-age=\d+/);
      expect(res.headers['content-security-policy'], address).toBe(CONTENT_SECURITY_POLICY);
      expect(res.headers['x-powered-by'], address).toBeUndefined();
    }
  });

  it('allows no scripts but its own, no framing, no plugins, no other form targets', () => {
    const rules = Object.fromEntries(CONTENT_SECURITY_POLICY.split('; ').map((rule) => [rule.split(' ')[0], rule.split(' ').slice(1)]));
    expect(rules['script-src']).toEqual(["'self'"]);
    expect(rules['frame-ancestors']).toEqual(["'none'"]);
    expect(rules['object-src']).toEqual(["'none'"]);
    expect(rules['base-uri']).toEqual(["'none'"]);
    expect(rules['connect-src']).toEqual(["'self'"]);
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/\*|unsafe-eval/);
    expect(rules['script-src'].join(' ')).not.toContain('unsafe-inline');
  });

  it('keeps private answers out of every cache', async () => {
    const res = await raw(site.port, 'GET', '/api/status', { headers: asOwner.headers });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('answers to bad requests', () => {
  const noInternals = (body: string) => {
    expect(body).not.toMatch(/node_modules|\/home\/|\/tmp\/|\bat [\w.<>]+ \(|\.ts:\d+|Error:/);
  };

  it('answers malformed JSON plainly, before and after signing in, without a stack trace', async () => {
    for (const headers of [{}, asOwner.headers]) {
      const res = await raw(site.port, 'POST', '/api/unlock', { headers, body: '{"pin": ' });
      expect(res.status).toBe(400);
      expect(res.json()).toEqual({ error: 'The request could not be read.' });
      noInternals(res.body);
    }
  });

  it('refuses a body over 1 MB', async () => {
    const res = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: 'x'.repeat(1_200_000) }) });
    expect(res.status).toBe(413);
    noInternals(res.body);
  });

  it('answers an unknown API address with a plain 404 once signed in', async () => {
    const res = await raw(site.port, 'GET', '/api/does-not-exist', { headers: asOwner.headers });
    expect(res.status).toBe(404);
    expect(res.json()).toEqual({ error: 'Not found' });
  });

  it('keeps the details of an unexpected failure to itself', () => {
    const { status, error } = explain(new Error("ENOENT: no such file '/home/user/musaedapp/data/store.json'"));
    expect(status).toBe(500);
    expect(error).toBe('Something went wrong. Try again.');
  });

  it('does the same for a failure outside the API', async () => {
    const app = createApp();
    app.get('/boom', () => {
      throw new Error("secret detail /home/user/x");
    });
    app.use(bodyErrors, lastResort);
    const s = await listen(app);
    const res = await raw(s.port, 'GET', '/boom');
    expect(res.status).toBe(500);
    expect(res.body).not.toContain('secret detail');
    await s.close();
  });
});

describe('sessions', () => {
  const PW = 'correct-horse-battery';
  async function guarded(clock: { now: number }, password = PW) {
    const app = createApp();
    app.use(express.json());
    app.use('/api', createGuard('password', password, 'the-secret', () => clock.now));
    app.get('/api/me', (_req, res) => res.json({ ok: true }));
    return listen(app);
  }
  const signIn = async (port: number) => String((await raw(port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: PW }) })).headers['set-cookie']).split(';')[0];
  const me = (port: number, cookie: string) => raw(port, 'GET', '/api/me', { headers: { cookie } }).then((r) => r.status);

  it('ends by itself after 30 days', async () => {
    const clock = { now: 1_800_000_000_000 };
    const s = await guarded(clock);
    const c = await signIn(s.port);
    expect(await me(s.port, c)).toBe(200);
    clock.now += 29 * 86_400_000;
    expect(await me(s.port, c)).toBe(200);
    clock.now += 2 * 86_400_000;
    expect(await me(s.port, c)).toBe(401);
    await s.close();
  });

  it('is renewed while it is being used, once half the time is gone', async () => {
    const clock = { now: 1_800_000_000_000 };
    const s = await guarded(clock);
    const c = await signIn(s.port);
    expect((await raw(s.port, 'GET', '/api/me', { headers: { cookie: c } })).headers['set-cookie']).toBeUndefined();
    clock.now += 16 * 86_400_000;
    const renewed = await raw(s.port, 'GET', '/api/me', { headers: { cookie: c } });
    expect(String(renewed.headers['set-cookie'])).toMatch(/maai_session=\d+\.[0-9a-f]{64}/);
    await s.close();
  });

  it('stops working when the password changes', async () => {
    const clock = { now: 1_800_000_000_000 };
    const before = await guarded(clock);
    const c = await signIn(before.port);
    await before.close();
    const after = await guarded(clock, 'a-brand-new-password');
    expect(await me(after.port, c)).toBe(401);
    await after.close();
  });

  it('cannot be stretched by editing the expiry date in it', async () => {
    const clock = { now: 1_800_000_000_000 };
    const s = await guarded(clock);
    const [expires, signature] = (await signIn(s.port)).split('=')[1].split('.');
    for (const forged of [`${Number(expires) + 10 * 86_400}.${signature}`, `9999999999.${signature}`, `${expires}.${'0'.repeat(64)}`, `${expires}`, `.${signature}`, `-1.${signature}`]) {
      expect(await me(s.port, `maai_session=${forged}`), forged.slice(0, 30)).toBe(401);
    }
    await s.close();
  });
});

describe('where notifications may be sent', () => {
  it('accepts the browsers\' own push services', () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://web.push.apple.com/QAbc', 'https://wns2-par02p.notify.windows.com/w/?token=x']) expect(isPushServiceUrl(ok), ok).toBe(true);
  });

  it('refuses everything else, including tricks that merely look like them', () => {
    for (const bad of [
      'http://fcm.googleapis.com/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
      'https://169.254.169.254/latest/meta-data/',
      'https://fcm.googleapis.com.evil.com/x',
      'https://evil.com/fcm.googleapis.com',
      'https://user:pw@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://web.push.apple.com@evil.com/x',
      'https://evilnotify.windows.com/x',
      'https://internal.service/x',
      'file:///etc/passwd',
      'javascript:alert(1)',
      '',
      'not a url',
    ]) expect(isPushServiceUrl(bad), bad).toBe(false);
  });

  it('is enforced by the API', async () => {
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    const evil = await raw(site.port, 'POST', '/api/notify/subscribe', { headers: asOwner.headers, body: JSON.stringify({ subscription: { endpoint: 'https://169.254.169.254/x', keys } }) });
    expect(evil.status).toBe(400);
    const good = await raw(site.port, 'POST', '/api/notify/subscribe', { headers: asOwner.headers, body: JSON.stringify({ subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys } }) });
    expect(good.status).toBe(204);
    await raw(site.port, 'POST', '/api/notify/unsubscribe', { headers: asOwner.headers, body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc' }) });
  });
});

describe('secrets stay on the server', () => {
  it('never appear in anything the app can ask for', async () => {
    const routes = listRoutes(api).filter((r) => r.method === 'GET' && !r.path.startsWith('/mail'));
    expect(routes.length).toBeGreaterThan(8);
    const hidden = Object.entries(SECRETS).filter(([name]) => !['gmailUser', 'password'].includes(name)).map(([, value]) => value);
    hidden.push(SECRETS.password, 'the-secret', fs.readFileSync(path.join('/tmp/claude-0/hardening-data', 'push.json'), 'utf8').match(/"privateKey": "([^"]+)"/)![1]);
    for (const { path: route } of routes) {
      const res = await raw(site.port, 'GET', `/api${route}`, { headers: asOwner.headers });
      const everything = res.body + JSON.stringify(res.headers);
      for (const secret of hidden) expect(everything, `GET /api${route} must not contain a secret`).not.toContain(secret);
    }
  });

  it('shows which address mail goes from, but nothing that could sign in as it', async () => {
    const status = (await raw(site.port, 'GET', '/api/status', { headers: asOwner.headers })).json() as { mail: { from: string } };
    expect(status.mail.from).toBe(SECRETS.gmailUser);
    expect(JSON.stringify(status)).not.toContain(SECRETS.gmailPass);
  });

  it('keeps the calendar link key out of sight except for the signed-in owner', async () => {
    expect((await raw(site.port, 'GET', '/api/calendar/feed')).status).toBe(401);
    const link = (await raw(site.port, 'GET', '/api/calendar/feed', { headers: asOwner.headers })).json() as { https: string };
    expect(link.https).toContain(feedPath);
    expect((await raw(site.port, 'GET', feedPath)).status).toBe(200); // the link itself needs no sign-in: it is the key
  });
});

describe('files that hold secrets', () => {
  it.skipIf(process.platform === 'win32')('are readable by their owner only', () => {
    const dir = '/tmp/claude-0/hardening-data';
    for (const name of ['push.json', 'feed-token', 'store.json']) {
      if (!fs.existsSync(path.join(dir, name))) continue;
      expect(fs.statSync(path.join(dir, name)).mode & 0o077, name).toBe(0);
    }
    const tmp = path.join(dir, 'probe', 'x.txt');
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, 'old', { mode: 0o644 }); // a file that already exists with loose permissions
    writePrivate(tmp, 'new');
    expect(fs.statSync(tmp).mode & 0o077).toBe(0);
    expect(fs.readFileSync(tmp, 'utf8')).toBe('new');
  });

  it('are the only files the server writes, and always through writePrivate', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) && entry.name !== 'secure-fs.ts' && /writeFile(Sync)?\(|createWriteStream\(|appendFile/.test(fs.readFileSync(file, 'utf8'))) offenders.push(file);
      }
    };
    walk('server');
    expect(offenders).toEqual([]);
  });
});
