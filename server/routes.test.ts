import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/routes-data', MAAI_DATA_FILE: '/tmp/claude-0/routes-data/store.json', ASANA_TOKEN: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', GOOGLE_CALENDAR_ICS_URL: '' });
});

// Claude and the mail server are stand-ins that answer after a moment, so two requests can overlap.
const sent: string[] = [];
vi.mock('./mail.js', async (original) => ({
  ...(await original<typeof import('./mail')>()),
  sendMail: vi.fn(async (mail: { to: string }) => {
    await new Promise((r) => setTimeout(r, 60));
    if (!mail.to.includes('@')) throw new MailError(`"${mail.to}" is not a valid email address.`);
    sent.push(mail.to);
  }),
}));
vi.mock('./ai/claude.js', async (original) => ({ ...(await original<typeof import('./ai/claude')>()), client: {}, stream: vi.fn() }));

import { stream } from './ai/claude';
import { MailError } from './mail';
import { createInnerApp, createOnlineSite } from './site';
import { listen, raw } from './security/helpers';
import { state } from './store';

const owner = async () => {
  const inner = createInnerApp();
  inner.get('*', (_req, res) => res.send('<!doctype html>'));
  const site = await listen(createOnlineSite(inner, { password: 'correct-horse-battery', secret: 'test-secret' }));
  const unlock = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: 'correct-horse-battery' }) });
  const cookie = (unlock.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  const call = (method: string, path: string, body?: unknown) => raw(site.port, method, path, { headers: { cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { site, call };
};

const emailCard = () => {
  const card = { id: `mail-${state.proposals.length}`, kind: 'email' as const, status: 'pending' as const, title: 'Hello', to: 'sara@example.com', subject: 'Hello', body: 'Hi Sara' };
  state.proposals.push(card);
  return card;
};

beforeEach(() => {
  sent.length = 0;
  state.proposals = [];
  for (const a of state.agents) a.enabled = true;
});

describe('approving a card', () => {
  it('does the thing once, however many times the button is tapped', async () => {
    const { site, call } = await owner();
    try {
      const card = emailCard();
      const taps = await Promise.all([call('POST', `/api/proposals/${card.id}/approve`, {}), call('POST', `/api/proposals/${card.id}/approve`, {}), call('POST', `/api/proposals/${card.id}/approve`, {})]);
      expect(taps.map((t) => t.status).sort()).toEqual([200, 409, 409]);
      expect(sent).toEqual(['sara@example.com']);
      expect(card.status).toBe('approved');
    } finally {
      await site.close();
    }
  });

  it('can be tried again after a failure, and is not stuck', async () => {
    const { site, call } = await owner();
    try {
      const card = emailCard();
      const bad = await call('POST', `/api/proposals/${card.id}/approve`, { to: 'not-an-address' });
      expect(bad.status).toBe(400);
      expect(card.status).toBe('pending');
      expect((await call('POST', `/api/proposals/${card.id}/approve`, {})).status).toBe(200);
    } finally {
      await site.close();
    }
  });

  it('is refused for an email or WhatsApp card once the admin switches messaging off', async () => {
    const { site, call } = await owner();
    try {
      const card = emailCard();
      state.agents.find((a) => a.id === 'messaging')!.enabled = false;
      const res = await call('POST', `/api/proposals/${card.id}/approve`, {});
      expect(res.status).toBe(403);
      expect(sent).toEqual([]);
      expect(card.status).toBe('pending');
    } finally {
      await site.close();
    }
  });

  it('answers a card with no times to book with a clear message, not a crash', async () => {
    const { site, call } = await owner();
    try {
      state.proposals.push({ id: 'm1', kind: 'meeting', status: 'pending', title: 'Sync', attendee: 'Sara', minutes: 30, options: [] });
      const res = await call('POST', '/api/proposals/m1/approve', {});
      expect(res.status).toBe(400);
      expect((res.json() as { error: string }).error).toMatch(/no time/);
    } finally {
      await site.close();
    }
  });
});

describe('the assistant answering', () => {
  it('takes one message at a time, so the conversation cannot be corrupted', async () => {
    vi.mocked(stream).mockImplementation((async () => {
      await new Promise((r) => setTimeout(r, 80));
      return { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
    }) as never);
    const { site, call } = await owner();
    try {
      const both = await Promise.all([call('POST', '/api/chat/stream', { text: 'one', lang: 'en' }), call('POST', '/api/chat/stream', { text: 'two', lang: 'en' })]);
      expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
      // and the next message after it finished is accepted again
      expect((await call('POST', '/api/chat/stream', { text: 'three', lang: 'en' })).status).toBe(200);
    } finally {
      await site.close();
    }
  });
});

describe('the admin switches', () => {
  it('accept only true or false', async () => {
    const { site, call } = await owner();
    try {
      for (const bad of ['false', 0, null, undefined, 'yes']) expect((await call('PATCH', '/api/admin/agents/messaging', { enabled: bad })).status).toBe(400);
      expect(state.agents.find((a) => a.id === 'messaging')!.enabled).toBe(true);
      expect((await call('PATCH', '/api/admin/agents/messaging', { enabled: false })).status).toBe(200);
      expect(state.agents.find((a) => a.id === 'messaging')!.enabled).toBe(false);
    } finally {
      await site.close();
    }
  });

  it('also stop an email reply from the inbox', async () => {
    const { site, call } = await owner();
    try {
      state.inbox.push({ id: 'i1', from: 'Sara', email: 'sara@example.com', channel: 'email', text: 'Hi', receivedAt: new Date().toISOString(), replied: false });
      state.agents.find((a) => a.id === 'messaging')!.enabled = false;
      expect((await call('POST', '/api/inbox/i1/email', { body: 'Hello' })).status).toBe(403);
      expect(sent).toEqual([]);
    } finally {
      await site.close();
    }
  });
});

describe('penetration-test findings, kept fixed', () => {
  const signIn = async (port: number) => {
    const res = await raw(port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: 'correct-horse-battery' }) });
    return (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  };

  it('Sign out ends the session for good: a copied cookie stops working', async () => {
    const { site } = await owner();
    try {
      const stolen = await signIn(site.port);
      const other = await signIn(site.port);
      expect((await raw(site.port, 'GET', '/api/today', { headers: { cookie: stolen } })).status).toBe(200);
      expect((await raw(site.port, 'POST', '/api/logout', { headers: { cookie: other } })).status).toBe(204);
      expect((await raw(site.port, 'GET', '/api/today', { headers: { cookie: stolen } })).status).toBe(401);
      expect((await raw(site.port, 'GET', '/api/today', { headers: { cookie: other } })).status).toBe(401);
      // a new sign-in works, and its cookie is good
      const fresh = await signIn(site.port);
      expect((await raw(site.port, 'GET', '/api/today', { headers: { cookie: fresh } })).status).toBe(200);
    } finally {
      await site.close();
    }
  });

  it('a stranger calling Sign out cannot end the owner\'s session', async () => {
    const { site } = await owner();
    try {
      const mine = await signIn(site.port);
      await raw(site.port, 'POST', '/api/logout');
      await raw(site.port, 'POST', '/api/logout', { headers: { cookie: 'maai_session=1.' + 'a'.repeat(64) } });
      expect((await raw(site.port, 'GET', '/api/today', { headers: { cookie: mine } })).status).toBe(200);
    } finally {
      await site.close();
    }
  });

  it('the calendar link is never built from a forged Host header', async () => {
    const { site } = await owner();
    try {
      vi.stubEnv('RENDER_EXTERNAL_URL', 'https://maai.example');
      const cookie = await signIn(site.port);
      const res = await raw(site.port, 'GET', '/api/calendar/feed', { headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example', cookie } });
      expect(res.status).toBe(200);
      expect(res.body).not.toContain('evil.example');
      expect(res.body).toContain('https://maai.example/calendar/');
      vi.unstubAllEnvs();
    } finally {
      await site.close();
    }
  });
});
