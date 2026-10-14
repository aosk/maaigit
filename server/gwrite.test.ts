import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '../shared/types';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const keyFile = { client_email: 'maai@project.iam.gserviceaccount.com', private_key: privateKey };

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v as string);
  return import('./gwrite');
}
afterEach(() => vi.unstubAllEnvs());

const event = (e: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: 'a1b2c3d4', title: 'Meeting with Sara', start: '2099-01-01T07:00:00.000Z', minutes: 30, ...e });

describe('writing meetings to Google Calendar', () => {
  it('signs the request with the service account key so Google can verify it', async () => {
    const { signJwt } = await load({});
    const jwt = signJwt(keyFile, 1_000_000);
    const [head, claim, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(head, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(claim, 'base64url').toString())).toMatchObject({ iss: keyFile.client_email, scope: 'https://www.googleapis.com/auth/calendar.events', iat: 1_000_000, exp: 1_003_600 });
    const ok = createVerify('RSA-SHA256').update(`${head}.${claim}`).verify(createPublicKey(publicKey), Buffer.from(signature, 'base64url'));
    expect(ok).toBe(true);
  });

  it('is off until both the key and the calendar are given, and says what is missing', async () => {
    expect((await load({ GOOGLE_SERVICE_ACCOUNT: '', GOOGLE_CALENDAR_ID: '' })).googleWriteStatus()).toMatchObject({ configured: false, working: false });
    expect((await load({ GOOGLE_SERVICE_ACCOUNT: JSON.stringify(keyFile), GOOGLE_CALENDAR_ID: '' })).googleWriteStatus().error).toMatch(/GOOGLE_CALENDAR_ID/);
    expect((await load({ GOOGLE_SERVICE_ACCOUNT: 'not json', GOOGLE_CALENDAR_ID: 'me@gmail.com' })).googleWriteStatus().error).toMatch(/JSON key/);
  });

  it('accepts the key as plain JSON or as base64', async () => {
    const plain = await load({ GOOGLE_SERVICE_ACCOUNT: JSON.stringify(keyFile), GOOGLE_CALENDAR_ID: 'me@gmail.com' });
    const encoded = await load({ GOOGLE_SERVICE_ACCOUNT: Buffer.from(JSON.stringify(keyFile)).toString('base64'), GOOGLE_CALENDAR_ID: 'me@gmail.com' });
    for (const m of [plain, encoded]) expect(m.googleWriteStatus()).toMatchObject({ working: true, shareWith: keyFile.client_email, calendar: 'me@gmail.com' });
  });

  it('does nothing when it is not set up', async () => {
    const { mirrorToGoogle, pendingForGoogle } = await load({ GOOGLE_SERVICE_ACCOUNT: '', GOOGLE_CALENDAR_ID: '' });
    expect(await mirrorToGoogle(event())).toBeNull();
    expect(pendingForGoogle().every((e) => !e.demo && !e.googleId)).toBe(true);
  });
});
