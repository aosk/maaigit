import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/group-data',
    MAAI_DATA_FILE: '/tmp/claude-0/group-data/store.json',
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_WHATSAPP_FROM: '',
    ASANA_TOKEN: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    GOOGLE_CALENDAR_ICS_URL: '',
  });
});

vi.mock('./ai/claude.js', async (original) => ({ ...(await original<typeof import('./ai/claude')>()), client: {}, create: vi.fn() }));

import { create } from './ai/claude';
import { answerLeftoverMessages, createKey, receiveFromBot, resetLink, takeCommands } from './bot';
import { dropWaitingReplies, replyWaitSeconds } from './intake';
import { state } from './store';

const SARA = '966522222222';
const wa = (text: string, extra: Record<string, unknown> = {}) => ({ id: `m${Math.random().toString(16).slice(2)}`, channel: 'whatsapp', from: 'Sara', phone: SARA, text, at: new Date().toISOString(), ...extra });
const claudeSays = (reply: string) =>
  vi.mocked(create).mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ reply, enough: false, summary: 'Sara asks something', urgent: false }) }] } as never);
const queued = () => state.bot.commands.filter((c) => c.status === 'queued');
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
  state.inbox = state.inbox.filter((m) => m.via !== 'bot');
  state.bot = { commands: [] };
  state.whatsappAcks = {};
  state.intake = {};
  state.replyMode = 'smart';
  state.replyWaitSeconds = undefined; // the default wait
  state.notifyPrefs.messages = false;
  for (const agent of state.agents) agent.enabled = true;
  vi.mocked(create).mockReset();
  createKey(); // a connected device bot
  resetLink();
  claudeSays('متى يناسبك؟');
});
afterEach(() => {
  dropWaitingReplies();
  vi.useRealTimers();
});

describe('answering a run of messages once', () => {
  it('waits for the person to stop writing, then answers them all in one reply', async () => {
    expect(replyWaitSeconds()).toBe(45);
    receiveFromBot({ messages: [wa('hi')] }, Date.now());
    await advance(10_000);
    receiveFromBot({ messages: [wa('are you free tomorrow?')] }, Date.now());
    await advance(10_000);
    receiveFromBot({ messages: [wa('around 5pm')] }, Date.now());
    // Forty-four seconds after the last one: still waiting.
    await advance(44_000);
    expect(queued()).toHaveLength(0);
    expect(vi.mocked(create)).not.toHaveBeenCalled();
    await advance(2_000);
    expect(queued()).toHaveLength(1);
    expect(vi.mocked(create)).toHaveBeenCalledTimes(1);
    // The reply was written from the whole run.
    const asked = JSON.stringify(vi.mocked(create).mock.calls[0][0]);
    expect(asked).toContain('hi');
    expect(asked).toContain('are you free tomorrow?');
    expect(asked).toContain('around 5pm');
  });

  it('answers at most 2.5 minutes after the first message, however long they keep writing', async () => {
    for (let i = 0; i < 6; i++) {
      receiveFromBot({ messages: [wa(`message ${i}`)] }, Date.now());
      await advance(40_000);
    }
    // The run began at 0; by 150 s it has been answered once (messages at 0, 40, 80, 120 came before it).
    expect(vi.mocked(create)).toHaveBeenCalledTimes(1);
    expect(queued().length).toBeGreaterThanOrEqual(1);
  });

  it('answers an urgent message at once', async () => {
    receiveFromBot({ messages: [wa('عاجل! أحتاجك الحين')] }, Date.now());
    await advance(1_000);
    expect(queued()).toHaveLength(1);
  });

  it('answers each message at once when the wait is turned off', async () => {
    state.replyWaitSeconds = 0;
    receiveFromBot({ messages: [wa('hi')] }, Date.now());
    await advance(1_000);
    expect(queued()).toHaveLength(1);
  });

  it('keeps two people apart', async () => {
    receiveFromBot({ messages: [wa('hello from Sara'), wa('hello from Omar', { from: 'Omar', phone: '966533333333' })] }, Date.now());
    await advance(46_000);
    expect(queued().map((c) => c.phone).sort()).toEqual(['966522222222', '966533333333']);
  });

  it('does not answer when the user answered himself while it waited', async () => {
    receiveFromBot({ messages: [wa('hi')] }, Date.now());
    await advance(20_000);
    for (const m of state.inbox) if (m.phone === SARA) m.replied = true;
    await advance(30_000);
    expect(queued()).toHaveLength(0);
    expect(vi.mocked(create)).not.toHaveBeenCalled();
  });
});

describe('after a restart', () => {
  it('answers a fresh message that was still waiting, once, and leaves old or answered ones alone', async () => {
    const fresh = new Date(Date.now() - 5 * 60_000).toISOString();
    state.inbox.push({ id: 'a', from: 'Sara', phone: SARA, channel: 'whatsapp', text: 'hello?', receivedAt: fresh, replied: false, via: 'bot', externalId: 'x1' } as never);
    state.inbox.push({ id: 'b', from: 'Old', phone: '966544444444', channel: 'whatsapp', text: 'hello?', receivedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(), replied: false, via: 'bot', externalId: 'x2' } as never);
    state.intake['966555555555'] = { since: fresh, sent: [{ text: 'done', at: new Date(Date.now() - 60_000).toISOString() }] };
    state.inbox.push({ id: 'c', from: 'Done', phone: '966555555555', channel: 'whatsapp', text: 'thanks', receivedAt: fresh, replied: false, via: 'bot', externalId: 'x3' } as never);
    expect(answerLeftoverMessages()).toBe(1);
    await advance(100);
    expect(queued().map((c) => c.phone)).toEqual([SARA]);
    takeCommands();
  });
});
