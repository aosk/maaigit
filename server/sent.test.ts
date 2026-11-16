import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/sent-data', MAAI_DATA_FILE: '/tmp/claude-0/sent-data/store.json', ASANA_TOKEN: '', GOOGLE_CALENDAR_ICS_URL: '', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '', MAAI_PASSWORD: 'sent-pass' });
});

import type { InboxMessage } from '../shared/types';
import { createKey, finishCommand, queueCommand, takeCommands } from './bot';
import { exchangeWith, sentMessages } from './sent';
import { createInnerApp, createOnlineSite } from './site';
import { listen, raw } from './security/helpers';
import { state } from './store';

const KHALID = '966522222222';
const T0 = Date.parse('2026-11-17T08:00:00Z');
const at = (min: number) => T0 + min * 60_000;
const theirs = (text: string, min: number): InboxMessage => ({ id: `m${min}`, from: 'Khalid', phone: KHALID, channel: 'whatsapp', via: 'bot', text, receivedAt: new Date(at(min)).toISOString(), replied: false });

beforeEach(() => {
  state.bot = { commands: [] };
  createKey();
});

describe('what went out on WhatsApp', () => {
  it('lists every reply newest first, saying what kind each was, and never a task or a file request', () => {
    queueCommand({ kind: 'reply', phone: KHALID, toName: 'Khalid', text: 'auto', automatic: true, tag: 'reply' }, at(1));
    queueCommand({ kind: 'reply', phone: KHALID, toName: 'Khalid', text: 'mine' }, at(2));
    queueCommand({ kind: 'reply', phone: '966533333333', toName: 'أحمد', text: 'تذكير', automatic: true, tag: 'team' }, at(3));
    queueCommand({ kind: 'reply', phone: '966544444444', toName: 'Rider', text: 'address', automatic: true, tag: 'courier', attachment: 'Pictures/door.jpg' }, at(4));
    queueCommand({ kind: 'reply', phone: '966500000009', toName: 'MAAI', text: 'notice', automatic: true, tag: 'self' }, at(5));
    queueCommand({ kind: 'media', text: 'wa-message-id', automatic: true }, at(6));
    queueCommand({ kind: 'task', text: 'open the report' }, at(7));
    const sent = sentMessages();
    expect(sent.map((m) => [m.text, m.kind])).toEqual([['notice', 'self'], ['address', 'courier'], ['تذكير', 'team'], ['mine', 'approved'], ['auto', 'reply']]);
    expect(sent[1].withPicture).toBe(true);
    expect(sent.every((m) => m.status === 'queued')).toBe(true);
  });

  it('says when a message did not go, with what the bot said, and treats an untagged automatic reply (an older one) as an automatic reply', () => {
    const failing = queueCommand({ kind: 'reply', phone: KHALID, toName: 'Khalid', text: 'old auto', automatic: true }, at(1));
    takeCommands(at(2));
    finishCommand(failing.id, { ok: false, output: '+966522222222 is not on WhatsApp' });
    const [m] = sentMessages();
    expect(m).toMatchObject({ kind: 'reply', status: 'failed', problem: '+966522222222 is not on WhatsApp' });
  });
});

describe('a conversation as the Inbox shows it', () => {
  it('puts their messages and what went out to them in order, and leaves out notices to the user and other people', () => {
    queueCommand({ kind: 'reply', phone: KHALID, toName: 'Khalid', text: 'an old reminder', automatic: true, tag: 'team' }, at(-600));
    queueCommand({ kind: 'reply', phone: KHALID, toName: 'Khalid', text: 'الله يحييك', automatic: true, tag: 'reply' }, at(2));
    queueCommand({ kind: 'reply', phone: '966500000009', toName: 'MAAI', text: 'notice about Khalid', automatic: true, tag: 'self' }, at(3));
    queueCommand({ kind: 'reply', phone: '966533333333', toName: 'Other', text: 'to someone else', automatic: true, tag: 'reply' }, at(3));
    queueCommand({ kind: 'reply', phone: KHALID, toName: 'Khalid', text: 'أبشر', tag: undefined }, at(6));
    const lines = exchangeWith(KHALID, [theirs('السلام عليكم', 1), theirs('متى الموعد؟', 5)]);
    expect(lines.map((l) => [l.who, l.text, l.kind])).toEqual([
      ['them', 'السلام عليكم', undefined],
      ['sent', 'الله يحييك', 'reply'],
      ['them', 'متى الموعد؟', undefined],
      ['sent', 'أبشر', 'approved'],
    ]);
  });
});

describe('the door', () => {
  it('needs the sign-in', async () => {
    const site = await listen(createOnlineSite(createInnerApp(), { password: 'sent-pass-long-enough', secret: 'test-secret' }));
    try {
      expect((await raw(site.port, 'GET', '/api/sent')).status).toBe(401);
      const login = await raw(site.port, 'POST', '/api/unlock', { body: JSON.stringify({ pin: 'sent-pass-long-enough' }) });
      const cookie = String(login.headers['set-cookie']).split(';')[0];
      queueCommand({ kind: 'reply', phone: KHALID, toName: 'Khalid', text: 'hello', automatic: true, tag: 'reply' });
      const res = await raw(site.port, 'GET', '/api/sent', { headers: { cookie } });
      expect(res.status).toBe(200);
      expect((res.json() as { messages: { text: string }[] }).messages[0].text).toBe('hello');
    } finally {
      await site.close();
    }
  });
});
