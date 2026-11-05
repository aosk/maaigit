import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/keys-data',
    MAAI_DATA_FILE: '/tmp/claude-0/keys-data/store.json',
    MAAI_TIMEZONE: 'Asia/Riyadh',
    ANTHROPIC_API_KEY: '',
    RENDER_API_KEY: '',
    ASANA_TOKEN: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
  });
});

import { addKey, dueKeyAlerts, keysCheck, keysNote, keysView, looksSecret, noteExpiryNotices, readExpiryNotice, updateKey } from './keys';
import { state } from './store';
import { createInnerApp, createOnlineSite } from './site';
import { listen, raw } from './security/helpers';
import type { MailItem } from '../shared/types';

const NOW = new Date('2026-11-05T09:00:00Z'); // 5 November, Riyadh

/** The email Anthropic really sends (as in the user's screenshot). */
const anthropicNotice: MailItem = {
  uid: 501,
  fromName: 'Anthropic',
  fromAddress: 'no-reply@mail.anthropic.com',
  subject: 'Your API key is expiring soon',
  date: '2026-11-05T08:00:00Z',
  unread: true,
  body: 'API key expiring soon\nThe API key najizsupport (apikey_01CARgLXPfpeKC9aioED9DUa) in your organization “Abdulrahman’s Individual Org” will expire in 7 days on November 12, 2026 (UTC).\nOnce expired, all API requests using this key will be rejected.',
};

beforeEach(() => {
  state.keys = [];
  state.sentAlerts = [];
  delete process.env.ANTHROPIC_API_KEY;
});

describe('reading expiry emails', () => {
  it('reads the key name and the day from Anthropic’s notice', () => {
    expect(readExpiryNotice(anthropicNotice)).toEqual({ service: 'anthropic', name: 'najizsupport', expiresOn: '2026-11-12' });
  });

  it('trusts the sender’s domain, not the name it shows, and ignores emails that are not expiry notices', () => {
    expect(readExpiryNotice({ ...anthropicNotice, fromAddress: 'alerts@anthropic.com.evil.example' })).toBeUndefined();
    expect(readExpiryNotice({ ...anthropicNotice, subject: 'Your invoice', body: 'Thanks for your payment of $20 on November 1, 2026.' })).toBeUndefined();
  });

  it('reads other services’ wording too', () => {
    expect(readExpiryNotice({ ...anthropicNotice, fromAddress: 'noreply@github.com', subject: '[GitHub] Your personal access token "deploy-bot" is about to expire', body: 'Your token "deploy-bot" will expire on 2026-12-01.' })).toEqual({ service: 'github', name: 'deploy-bot', expiresOn: '2026-12-01' });
  });

  it('adds a reminder once, keeps the user’s later date after a renewal, and takes a newer notice', () => {
    expect(noteExpiryNotices([anthropicNotice], NOW)).toBe(1);
    expect(noteExpiryNotices([anthropicNotice], NOW)).toBe(0);
    const [k] = keysView(NOW);
    expect(k).toMatchObject({ name: 'najizsupport', service: 'anthropic', source: 'email', expiresOn: '2026-11-12', daysLeft: 7, level: 'medium', emailUid: 501 });
    updateKey(k.id, { expiresOn: '2027-02-10', renewed: true }, NOW);
    expect(noteExpiryNotices([{ ...anthropicNotice, uid: 502 }], NOW)).toBe(0); // an old notice does not undo the renewal
    expect(keysView(NOW)[0].expiresOn).toBe('2027-02-10');
    expect(noteExpiryNotices([{ ...anthropicNotice, uid: 503, body: anthropicNotice.body.replace('November 12, 2026', 'March 1, 2027') }], NOW)).toBe(1);
    expect(keysView(NOW)[0].expiresOn).toBe('2027-03-01');
  });
});

describe('reminders', () => {
  it('alerts at 14, 7, 3, 1 days and on the day, each once, and once after it expired', () => {
    const k = addKey({ name: 'najizsupport', service: 'anthropic', expiresOn: '2026-11-12' }, NOW);
    const at = (day: string) => new Date(`${day}T09:00:00Z`);
    const steps = ['2026-10-29', '2026-11-01', '2026-11-05', '2026-11-09', '2026-11-11', '2026-11-12', '2026-11-13'].map((d) => {
      const due = dueKeyAlerts(at(d));
      state.sentAlerts.push(...due.map((x) => x.key));
      return due.map((x) => x.key.split(':').pop()).join(',');
    });
    expect(steps).toEqual(['14', '', '7', '3', '1', '0', 'expired']);
    expect(dueKeyAlerts(at('2026-11-14'))).toEqual([]);
    expect(k.daysLeft).toBe(7);
  });

  it('turns the health check amber within 14 days and red within 3, and tells the assistant', () => {
    addKey({ name: 'najizsupport', service: 'anthropic', expiresOn: '2026-11-12', envVar: 'ANTHROPIC_API_KEY' }, NOW);
    expect(keysCheck(NOW)).toMatchObject({ status: 'warn', detail: expect.stringContaining('najizsupport expires in 7 day(s)') });
    expect(keysCheck(new Date('2026-11-10T09:00:00Z')).status).toBe('fail');
    expect(keysCheck(new Date('2026-11-13T09:00:00Z')).detail).toContain('EXPIRED 1 day(s) ago');
    expect(keysNote(NOW)).toContain('najizsupport (Anthropic (Claude), ANTHROPIC_API_KEY) expires 2026-11-12, in 7 day(s)');
  });

  it('lists the keys MAAI runs on, so a date can be added to them', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-value';
    const [placeholder] = keysView(NOW);
    expect(placeholder).toMatchObject({ id: 'env:ANTHROPIC_API_KEY', source: 'detected', inUse: true, level: 'none' });
    expect(JSON.stringify(keysView(NOW))).not.toContain('sk-ant-test-value');
    const saved = updateKey(placeholder.id, { expiresOn: '2027-01-01' }, NOW);
    expect(saved).toMatchObject({ envVar: 'ANTHROPIC_API_KEY', expiresOn: '2027-01-01' });
    expect(keysView(NOW)).toHaveLength(1);
  });
});

describe('never a key', () => {
  it('refuses a pasted key as a name or a note', () => {
    expect(looksSecret('sk-ant-api03-abcdefghijklmnop')).toBe(true);
    expect(looksSecret('najizsupport')).toBe(false);
    expect(() => addKey({ name: 'sk-ant-api03-abcdefghijklmnopqrstu', service: 'anthropic' })).toThrow(/key itself/);
    expect(() => addKey({ name: 'grok', service: 'xai', note: 'xai-abcdefghijklmnopqrstuv' })).toThrow(/holds a key/);
  });
});

describe('the admin routes', () => {
  let site: Awaited<ReturnType<typeof listen>>;
  let cookie = '';
  beforeAll(async () => {
    site = await listen(createOnlineSite(createInnerApp(), { password: 'correct-horse-battery', secret: 'test-secret' }));
    const res = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: 'correct-horse-battery' }) });
    cookie = String(res.headers['set-cookie']).split(';')[0];
  });
  afterAll(() => site.close());

  it('adds, renews and removes a key reminder, and needs the login', async () => {
    const headers = { cookie, 'content-type': 'application/json' };
    expect((await raw(site.port, 'GET', '/api/admin/keys')).status).toBe(401);
    const added = await raw(site.port, 'POST', '/api/admin/keys', { headers, body: JSON.stringify({ name: 'MAAI', service: 'anthropic', expiresOn: '2026-12-01' }) });
    expect(added.status).toBe(201);
    const id = (JSON.parse(added.body) as { id: string; name: string }[]).find((k) => k.name === 'MAAI')!.id;
    const renewed = await raw(site.port, 'PUT', `/api/admin/keys/${id}`, { headers, body: JSON.stringify({ expiresOn: '2027-06-01', renewed: true }) });
    expect(JSON.parse(renewed.body)[0]).toMatchObject({ expiresOn: '2027-06-01', renewedAt: expect.any(String) });
    expect((await raw(site.port, 'POST', '/api/admin/keys', { headers, body: JSON.stringify({ name: 'sk-ant-api03-abcdefghijklmnopqrstu' }) })).status).toBe(400);
    expect((await raw(site.port, 'DELETE', `/api/admin/keys/${id}`, { headers })).status).toBe(200);
    expect(state.keys).toEqual([]);
  });
});
