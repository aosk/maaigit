import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/fuzz-data', MAAI_DATA_FILE: '/tmp/claude-0/fuzz-data/store.json', ANTHROPIC_API_KEY: '', ASANA_TOKEN: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '' });
});

import { createInnerApp, createOnlineSite } from '../site';
import { api } from '../routes/index';
import { listen, listRoutes, raw } from './helpers';

const PASSWORD = 'correct-horse-battery';
let site: Awaited<ReturnType<typeof listen>>;
let cookie = '';

beforeAll(async () => {
  const inner = createInnerApp();
  inner.get('*', (_req, res) => res.type('html').send('<!doctype html>'));
  site = await listen(createOnlineSite(inner, { password: PASSWORD, secret: 'test-secret' }));
  const res = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: PASSWORD }) });
  cookie = String(res.headers['set-cookie']).split(';')[0];
});
afterAll(() => site.close());

const HOSTILE_BODIES: [string, string][] = [
  ['empty object', '{}'],
  ['array', '[]'],
  ['null', 'null'],
  ['a bare string', '"text"'],
  ['a number', '123'],
  ['prototype pollution', '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}}}'],
  ['wrong types everywhere', '{"title":{"$ne":null},"start":[],"minutes":{"a":1},"text":{"x":1},"to":[1],"name":{},"done":"no","pin":[],"enabled":"yes","tone":{},"lang":[],"subscription":"x","endpoint":5,"dueOn":{},"projectGid":[],"optionGid":{},"type":9}'],
  ['huge strings', JSON.stringify({ title: 'x'.repeat(200_000), text: 'y'.repeat(200_000), from: 'z'.repeat(200_000), body: 'q'.repeat(200_000) })],
  ['markup, line breaks and control characters', JSON.stringify({ title: '<script>alert(1)</script>', from: 'a\r\nBcc: x@y.z', text: '\u0000‮ ', email: 'a@b.c\r\nBcc: evil@x.y', to: 'a@b.c\nBcc: evil@x.y', subject: 'hi\r\nBcc: evil@x.y', start: '2026-13-45T99:99', minutes: -5 })],
  ['deep nesting', '['.repeat(400) + ']'.repeat(400)],
  ['numbers as text', '{"minutes":"1e999","start":"99999999999999999","title":"1","done":"false","pin":"\\u0000"}'],
];

const writeRoutes = () => listRoutes(api).filter((r) => r.method !== 'GET' && !['/unlock', '/logout', '/chat/stream'].includes(r.path));

describe('hostile requests to every endpoint that changes something', () => {
  it('finds the endpoints (so the test cannot silently check nothing)', () => {
    expect(writeRoutes().length).toBeGreaterThan(18);
  });

  for (const { method, path } of writeRoutes()) {
    it(`${method} /api${path} never crashes, whatever it is sent`, async () => {
      for (const [name, body] of HOSTILE_BODIES) {
        const res = await raw(site.port, method, `/api${path}`, { headers: { cookie }, body });
        // 500 means something broke unexpectedly; a deliberate "not ready" (503) or the like is fine.
        expect(res.status, `${name}: ${res.body.slice(0, 120)}`).not.toBe(500);
        if (res.status >= 400) expect(typeof (res.json() as { error?: unknown }).error, name).toBe('string');
        expect(res.body, name).not.toMatch(/node_modules|\.ts:\d+|\bat [\w.<>]+ \(/);
      }
    });
  }

  it('leaves no trace of prototype pollution', () => {
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
  });

  it('is still serving afterwards', async () => {
    expect((await raw(site.port, 'GET', '/api/status', { headers: { cookie } })).status).toBe(200);
  });
});

describe('hostile addresses and queries', () => {
  const ids = ['..%2f..%2fetc%2fpasswd', '%00', '%', 'x'.repeat(5000), '__proto__', 'constructor', 'toString', '<script>', '1209876543210%0d%0aSet-Cookie:x=1', '../../x', '%2e%2e%2f'];
  const withParams = listRoutes(api).filter((r) => /\/(abcd1234|1209876543210)\b/.test(r.path));

  it('finds the routes with an identifier in the address', () => {
    expect(withParams.length).toBeGreaterThan(8);
  });

  for (const route of withParams) {
    it(`${route.method} /api${route.path} refuses a made-up identifier politely`, async () => {
      for (const id of ids) {
        const address = `/api${route.path.replace(/abcd1234|1209876543210/, id)}`;
        const res = await raw(site.port, route.method, address, { headers: { cookie }, body: route.method === 'GET' ? undefined : '{}' });
        expect(res.status, `${address.slice(0, 80)} → ${res.body.slice(0, 80)}`).toBeLessThan(500);
        expect(String(res.headers['set-cookie'] ?? '')).not.toContain('x=1'); // no header injection through the address
      }
    });
  }

  it('shrugs off strange query strings', async () => {
    for (const q of ['/api/alerts?since=%00', '/api/alerts?since[]=1&since[]=2', '/api/alerts?since=' + 'x'.repeat(10_000), '/api/briefing?lang[]=x', '/api/briefing?lang=../../x', '/api/mail/digest?refresh[a]=b', '/api/mail/digest?lang=%E0%A4%A']) {
      const res = await raw(site.port, 'GET', q, { headers: { cookie } });
      expect(res.status, q.slice(0, 60)).toBeLessThan(500);
    }
  });

  it('rejects an address that is not valid at all, without hanging', async () => {
    const res = await raw(site.port, 'GET', '/api/%zz', { headers: { cookie } });
    expect(res.status).toBeLessThan(500);
  });
});

describe('sending too much, or too slowly', () => {
  it('answers a flood of sign-in attempts with a lock, not a crash', async () => {
    const statuses = new Set<number>();
    for (let i = 0; i < 40; i++) statuses.add((await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: `guess-${i}` }) })).status);
    expect([...statuses].sort()).toEqual([401, 429]);
    expect(await raw(site.port, 'GET', '/api/status', { headers: { cookie } }).then((r) => r.status)).toBe(200); // the owner's session is unaffected
  });
});
