import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/rules-data', MAAI_DATA_FILE: '/tmp/claude-0/rules-data/store.json', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '', ASANA_TOKEN: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', GOOGLE_CALENDAR_ICS_URL: '', MAAI_PASSWORD: 'rules-pass' });
});
vi.mock('./ai/claude.js', async (original) => ({ ...(await original<typeof import('./ai/claude')>()), client: {}, create: vi.fn() }));

import { create } from './ai/claude';
import { createKey, receiveFromBot, resetLink } from './bot';
import { clearInbound } from './inbound';
import { busyUntil, dropWaitingReplies, knownName, whyNot } from './intake';
import { inboxFeed } from './inbox-feed';
import { createInnerApp } from './site';
import { listen, raw } from './security/helpers';
import { state } from './store';

const SARA = '966522222222';
const NOW = new Date('2026-11-16T10:00:00Z'); // 13:00 in Riyadh
let n = 0;
const wa = (text: string, phone = SARA) => ({ id: `q${++n}`, channel: 'whatsapp', from: 'S', phone, text, at: new Date().toISOString() });
const claude = (value: Record<string, unknown> = {}) => vi.mocked(create).mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ reply: 'أبشر', enough: true, summary: 'ملخص', urgent: false, draft: '', ...value }) }] } as never);
const asked = () => vi.mocked(create).mock.calls.at(-1)![0] as { system: string; messages: { content: string }[] };
const replies = () => state.bot.commands.filter((c) => c.kind === 'reply');
const meeting = (startMin: number, minutes: number) => ({ id: `e${++n}`, title: 'SECRET board meeting', start: new Date(NOW.getTime() + startMin * 60_000).toISOString(), minutes }) as never;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  clearInbound();
  state.inbox = [];
  state.bot = { commands: [] };
  state.intake = {};
  state.whatsappAcks = {};
  state.events = [];
  state.contacts = [];
  state.addressBook = { cards: [] };
  state.replyMode = 'smart';
  state.replyWaitSeconds = 0;
  state.replyRules = { knowContacts: true, shareBusy: true, quiet: [] };
  state.courier = { enabled: false, shortAddress: '', fullDetails: '', doorPhotoPath: '' };
  for (const agent of state.agents) agent.enabled = true;
  vi.mocked(create).mockReset();
  claude();
  createKey();
  resetLink();
});
afterEach(() => {
  dropWaitingReplies();
  vi.useRealTimers();
});

describe('numbers that are never answered automatically', () => {
  it('get nothing from MAAI, while everyone else is answered', async () => {
    state.replyRules.quiet = [SARA];
    receiveFromBot({ messages: [wa('السلام عليكم'), wa('hello', '966533333333')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(replies().map((c) => c.phone)).toEqual(['966533333333']);
    expect(whyNot({ id: 'x', from: 'S', phone: SARA, channel: 'whatsapp', via: 'bot', text: 'hi', receivedAt: NOW.toISOString(), replied: false })).toMatch(/never-answer-automatically/);
  });
});

describe('someone in the contacts', () => {
  it('is found by the end of the number, in the phone\'s contacts or the imported cards', () => {
    state.contacts = [{ name: 'سارة العتيبي', phone: '966522222222' }];
    state.addressBook = { cards: [{ name: 'Omar Work', phones: ['+966 53 333 3333'], emails: [] }] as never };
    expect(knownName(SARA)).toBe('سارة العتيبي');
    expect(knownName('966533333333')).toBe('Omar Work');
    expect(knownName('966544444444')).toBeUndefined();
    expect(knownName('123')).toBeUndefined();
  });

  it('is greeted by the saved name, and Claude is told who they are; a stranger is not', async () => {
    state.contacts = [{ name: 'سارة العتيبي', phone: SARA }];
    receiveFromBot({ messages: [wa('السلام عليكم')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(asked().messages[0].content).toContain("Who this is: سارة العتيبي, saved in Abdulrahman's contacts.");
    expect(replies()[0].text).toContain('سارة');
    receiveFromBot({ messages: [wa('hello', '966544444444')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(asked().messages[0].content).not.toContain('Who this is');
    // switched off: a contact is treated like anyone else
    state.replyRules.knowContacts = false;
    state.intake = {};
    receiveFromBot({ messages: [wa('مرحبا')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(asked().messages[0].content).not.toContain('Who this is');
  });
});

describe('when the user is free', () => {
  it('is a time only: the end of the meeting on now, back-to-back meetings as one, nothing when free', () => {
    expect(busyUntil(NOW.getTime())).toBeUndefined();
    state.events = [meeting(-30, 60)]; // 12:30 to 13:30 Riyadh
    expect(busyUntil(NOW.getTime())).toBe('1:30 PM');
    state.events = [meeting(-30, 60), meeting(30, 60), meeting(300, 30)]; // …then 13:30 to 14:30; the 18:00 one is separate
    expect(busyUntil(NOW.getTime())).toBe('2:30 PM');
    state.events = [meeting(60, 30)]; // starts in an hour: not busy now
    expect(busyUntil(NOW.getTime())).toBeUndefined();
    state.events = [{ ...(meeting(-30, 600) as object), allDay: true } as never];
    expect(busyUntil(NOW.getTime())).toBeUndefined();
  });

  it('is told to a contact, never to a stranger, never with the meeting\'s name, and not when switched off', async () => {
    state.events = [meeting(-30, 60)];
    state.contacts = [{ name: 'سارة', phone: SARA }];
    receiveFromBot({ messages: [wa('متى تفضى؟')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(asked().messages[0].content).toContain('When he is free: he is busy until about 1:30 PM');
    expect(JSON.stringify(asked())).not.toContain('SECRET');
    receiveFromBot({ messages: [wa('when is he free?', '966544444444')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(asked().messages[0].content).not.toContain('When he is free:');
    state.replyRules.shareBusy = false;
    state.intake = {};
    receiveFromBot({ messages: [wa('متى؟')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(asked().messages[0].content).not.toContain('When he is free:');
  });
});

describe('fewer questions, and a reply ready for the user', () => {
  it('tells Claude to ask nothing when the message is clear, and one question at most', async () => {
    receiveFromBot({ messages: [wa('hello')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(asked().system).toMatch(/ask NOTHING/);
    expect(asked().system).toMatch(/ONE short, polite question/);
    expect(asked().system).not.toMatch(/one or two short, polite questions/);
  });

  it('keeps the draft Claude wrote (links and numbers removed) and offers it on the unanswered message only', async () => {
    claude({ draft: 'وعليكم السلام، أبشر [..] https://evil.example 0501234567' });
    receiveFromBot({ messages: [wa('السلام عليكم، أحتاج العقد')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(state.intake[SARA].draft).toBe('وعليكم السلام، أبشر [..]');
    const feed = await inboxFeed('ar');
    expect(feed.items.find((i) => i.message?.phone === SARA)?.readyDraft).toBe('وعليكم السلام، أبشر [..]');
    state.inbox.forEach((m) => (m.replied = true));
    expect((await inboxFeed('ar')).items.find((i) => i.message?.phone === SARA)?.readyDraft).toBeUndefined();
  });
});

describe('changing the rules', () => {
  it('takes the switches and a list of numbers (made international, repeats dropped), and refuses a bad number', async () => {
    vi.useRealTimers();
    const site = await listen(createInnerApp());
    try {
      const patch = (body: unknown) => raw(site.port, 'PATCH', '/api/admin/bot/reply-rules', { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
      const ok = await patch({ shareBusy: false, quiet: ['0522222222', '+966 52 222 2222', '966533333333'] });
      expect(ok.status).toBe(200);
      expect(state.replyRules).toEqual({ knowContacts: true, shareBusy: false, quiet: ['966522222222', '966533333333'] });
      expect((await patch({ quiet: ['12'] })).status).toBe(400);
      expect((await patch({ quiet: 'all' })).status).toBe(400);
      expect(state.replyRules.quiet).toEqual(['966522222222', '966533333333']);
    } finally {
      await site.close();
    }
  });
});
