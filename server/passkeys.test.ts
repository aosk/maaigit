import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/passkey-data',
    MAAI_DATA_FILE: '/tmp/claude-0/passkey-data/store.json',
    MAAI_PUBLIC_URL: 'https://maai.example',
    ANTHROPIC_API_KEY: '',
    ASANA_TOKEN: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    GOOGLE_CALENDAR_ICS_URL: '',
  });
});

import { createInnerApp, createOnlineSite } from './site';
import { resetPasskeyState } from './passkeys';
import { listen, raw } from './security/helpers';
import { state } from './store';

const ORIGIN = 'https://maai.example';
const RP = 'maai.example';
const PASSWORD = 'correct-horse-battery';
const b64u = (data: Buffer | string) => Buffer.from(data).toString('base64url');
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();

/** A phone's Face ID, in software: makes keys, and signs exactly as an authenticator does. */
function phone() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const id = randomBytes(16);
  const cose = Buffer.concat([Buffer.from('a5010203262001215820', 'hex'), Buffer.from(jwk.x, 'base64url'), Buffer.from('225820', 'hex'), Buffer.from(jwk.y, 'base64url')]);
  const u32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const rpHash = (rp: string) => sha256(rp);
  return {
    id: b64u(id),
    register(options: { challenge: string }, { origin = ORIGIN, rp = RP, flags = 0x45 } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([rpHash(rp), Buffer.from([flags]), u32(0), Buffer.alloc(16), Buffer.from([0, id.length]), id, cose]);
      const length = Buffer.from([(authData.length >> 8) & 255, authData.length & 255]);
      const attestationObject = Buffer.concat([Buffer.from('a363666d74646e6f6e656761747453746d74a068617574684461746159', 'hex'), length, authData]);
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ['internal'] }, clientExtensionResults: {}, authenticatorAttachment: 'platform' };
    },
    login(options: { challenge: string }, { counter = 1, origin = ORIGIN, rp = RP, flags = 0x05, key = privateKey, credentialId = id } = {}) {
      const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
      const authData = Buffer.concat([rpHash(rp), Buffer.from([flags]), u32(counter)]);
      const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), key);
      return { id: b64u(credentialId), rawId: b64u(credentialId), type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: b64u('maai-owner') }, clientExtensionResults: {} };
    },
  };
}

let site: Awaited<ReturnType<typeof listen>>;
let cookie = '';
beforeAll(async () => {
  const inner = createInnerApp();
  inner.get('*', (_req, res) => res.send('<!doctype html>'));
  site = await listen(createOnlineSite(inner, { password: PASSWORD, secret: 'test-secret' }));
  const res = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: PASSWORD }) });
  cookie = String(res.headers['set-cookie']).split(';')[0];
});
afterAll(() => site.close());
beforeEach(() => {
  state.passkeys = [];
  state.audit = [];
  resetPasskeyState();
  vi.useRealTimers();
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) => raw(site.port, 'POST', path, { body: JSON.stringify(body), headers });
const owner = () => ({ cookie });
const setUp = async (device = phone()) => {
  const options = (await post('/api/passkeys/options', {}, owner())).json() as { challenge: string };
  const res = await post('/api/passkeys', { response: device.register(options), name: 'iPhone' }, owner());
  expect(res.status).toBe(201);
  return device;
};
const loginOptions = async () => (await post('/api/passkey/login/options', {})).json() as { challenge: string; allowCredentials: { id: string }[] };

describe('setting up Face ID', () => {
  it('needs a signed-in session for everything except signing in', async () => {
    expect((await raw(site.port, 'GET', '/api/passkeys')).status).toBe(401);
    expect((await post('/api/passkeys/options', {})).status).toBe(401);
    expect((await post('/api/passkeys', { response: {} })).status).toBe(401);
    expect((await raw(site.port, 'DELETE', '/api/passkeys/abc')).status).toBe(401);
    expect((await post('/api/passkey/login/options', {})).status).toBe(404); // nothing set up yet, and no session needed to ask
  });

  it('keeps only the public half of the key, and lists devices without it', async () => {
    const device = await setUp();
    expect(state.passkeys).toHaveLength(1);
    expect(state.passkeys[0]).toMatchObject({ id: device.id, name: 'iPhone', counter: 0 });
    const list = await raw(site.port, 'GET', '/api/passkeys', { headers: owner() });
    expect(list.body).not.toContain('publicKey');
    expect(JSON.parse(list.body)).toEqual([expect.objectContaining({ id: device.id, name: 'iPhone' })]);
    expect(state.audit[0].event).toMatch(/Set up Face ID/);
  });

  it('refuses a setup that was not made for this site, without a challenge it issued, or without Face ID itself', async () => {
    const options = async () => (await post('/api/passkeys/options', {}, owner())).json() as { challenge: string };
    expect((await post('/api/passkeys', { response: phone().register(await options(), { origin: 'https://evil.example' }) }, owner())).status).toBe(400);
    expect((await post('/api/passkeys', { response: phone().register(await options(), { rp: 'evil.example' }) }, owner())).status).toBe(400);
    expect((await post('/api/passkeys', { response: phone().register({ challenge: b64u(randomBytes(32)) }) }, owner())).status).toBe(400);
    expect((await post('/api/passkeys', { response: phone().register(await options(), { flags: 0x41 }) }, owner())).status).toBe(400); // no Face ID check
    const reused = await options();
    await post('/api/passkeys', { response: phone().register(reused) }, owner());
    expect((await post('/api/passkeys', { response: phone().register(reused) }, owner())).status).toBe(400); // a challenge works once
    expect(state.passkeys).toHaveLength(1);
  });

  it('keeps at most five devices, and lets one be removed', async () => {
    for (let i = 0; i < 5; i++) await setUp();
    expect((await post('/api/passkeys/options', {}, owner())).status).toBe(409);
    const gone = state.passkeys[0].id;
    expect((await raw(site.port, 'DELETE', `/api/passkeys/${gone}`, { headers: owner() })).status).toBe(204);
    expect(state.passkeys).toHaveLength(4);
    expect((await raw(site.port, 'DELETE', `/api/passkeys/${gone}`, { headers: owner() })).status).toBe(404);
  });
});

describe('signing in with Face ID', () => {
  it('gives the same kind of session the password does', async () => {
    const device = await setUp();
    const options = await loginOptions();
    expect(options.allowCredentials.map((c) => c.id)).toEqual([device.id]);
    const res = await post('/api/passkey/login', { response: device.login(options) });
    expect(res.status).toBe(204);
    const set = String(res.headers['set-cookie']);
    expect(set).toMatch(/maai_session=/);
    expect(set).toMatch(/HttpOnly/);
    expect(set).toMatch(/Secure/);
    expect(set).toMatch(/SameSite=Strict/);
    expect((await raw(site.port, 'GET', '/api/status', { headers: { cookie: set.split(';')[0] } })).status).toBe(200);
    expect(state.passkeys[0].counter).toBe(1);
    expect(state.passkeys[0].lastUsedAt).toBeTruthy();
  });

  it('cannot be replayed: a recorded sign-in does nothing the second time', async () => {
    const device = await setUp();
    const options = await loginOptions();
    const recorded = device.login(options);
    expect((await post('/api/passkey/login', { response: recorded })).status).toBe(204);
    const again = await post('/api/passkey/login', { response: recorded });
    expect(again.status).toBe(401);
    expect(again.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a challenge that is old, or was made for setting up', async () => {
    const device = await setUp();
    vi.useFakeTimers({ toFake: ['Date'] });
    const old = await loginOptions();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect((await post('/api/passkey/login', { response: device.login(old) })).status).toBe(401);
    vi.useRealTimers();
    const registering = (await post('/api/passkeys/options', {}, owner())).json() as { challenge: string };
    expect((await post('/api/passkey/login', { response: device.login(registering) })).status).toBe(401);
  });

  it('refuses a signature from another key, another site, a copied-down counter, or without Face ID', async () => {
    const device = await setUp();
    const other = phone();
    const attempt = async (extra: object, who = device) => (await post('/api/passkey/login', { response: who.login(await loginOptions(), extra) })).status;
    expect(await attempt({ key: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey })).toBe(401); // right id, wrong key
    expect(await attempt({ origin: 'https://evil.example' })).toBe(401);
    expect(await attempt({ rp: 'evil.example' })).toBe(401);
    expect(await attempt({ flags: 0x01 })).toBe(401); // present but not verified by Face ID
    expect(await attempt({}, other)).toBe(401); // a device that was never set up
    expect(await attempt({ counter: 5 })).toBe(204);
    expect(await attempt({ counter: 3 })).toBe(401); // a cloned key goes backwards
  });

  it('stops after too many wrong tries, then accepts only the password', async () => {
    const device = await setUp();
    for (let i = 0; i < 10; i++) await post('/api/passkey/login', { response: phone().login(await loginOptions()) });
    const options = await loginOptions();
    expect((await post('/api/passkey/login', { response: device.login(options) })).status).toBe(429);
    expect((await post('/api/unlock', { pin: PASSWORD })).status).toBe(204);
  });

  it('is gone once the device is removed', async () => {
    const device = await setUp();
    await raw(site.port, 'DELETE', `/api/passkeys/${device.id}`, { headers: owner() });
    expect((await post('/api/passkey/login/options', {})).status).toBe(404);
    expect((await post('/api/passkey/login', { response: device.login({ challenge: b64u(randomBytes(32)) }) })).status).toBe(401);
  });

  it('survives hostile input without a server error', async () => {
    await setUp();
    const bodies: unknown[] = [{}, [], null, 'x', { response: null }, { response: 'x' }, { response: { id: 5 } }, { response: { id: state.passkeys[0].id } }, { response: { id: state.passkeys[0].id, response: { clientDataJSON: '%%%', authenticatorData: {}, signature: [] } } }, { response: { __proto__: { polluted: 1 } } }];
    for (const body of bodies) {
      for (const path of ['/api/passkey/login', '/api/passkeys']) {
        const res = await post(path, body, owner());
        expect(res.status, `${path} ${JSON.stringify(body)}`).toBeLessThan(500);
      }
    }
    expect((await raw(site.port, 'POST', '/api/passkey/login', { body: '{"response":', headers: {} })).status).toBeLessThan(500);
    expect((await raw(site.port, 'POST', '/api/passkey/login', { body: 'x'.repeat(100_000) })).status).toBeLessThan(500);
  });
});
