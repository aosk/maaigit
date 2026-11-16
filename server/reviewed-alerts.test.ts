import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/reviewed-data', MAAI_DATA_FILE: '/tmp/claude-0/reviewed-data/store.json', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_WHATSAPP_FROM: '', ASANA_TOKEN: '', GMAIL_USER: '', GMAIL_APP_PASSWORD: '', GOOGLE_CALENDAR_ICS_URL: '' });
});

const alert = vi.hoisted(() => vi.fn(async (_key: string, _text: (lang: 'ar' | 'en') => { title: string; body: string }) => {}));
vi.mock('./notify.js', async (original) => ({ ...(await original<typeof import('./notify')>()), alertMessage: alert }));
vi.mock('./ai/claude.js', async (original) => ({ ...(await original<typeof import('./ai/claude')>()), client: {}, create: vi.fn() }));

import { create } from './ai/claude';
import { createKey, receiveFromBot, resetLink } from './bot';
import { clearInbound } from './inbound';
import { dropWaitingReplies } from './intake';
import { state } from './store';

let n = 0;
const wa = (text: string, extra: Record<string, unknown> = {}) => ({ id: `r${++n}`, channel: 'whatsapp', from: 'Sara', phone: `9665222${String(10000 + n)}`, text, at: new Date().toISOString(), ...extra });
const claude = (value: Record<string, unknown>) => vi.mocked(create).mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ reply: 'متى يناسبك؟', enough: false, summary: '', urgent: false, ...value }) }] } as never);
const bodies = () => alert.mock.calls.map(([, text]) => text('ar').body);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-11-16T10:00:00Z'));
  clearInbound();
  alert.mockClear();
  state.inbox = [];
  state.bot = { commands: [] };
  state.intake = {};
  state.whatsappAcks = {};
  state.replyMode = 'smart';
  state.replyWaitSeconds = 0; // answered at once
  for (const agent of state.agents) agent.enabled = true;
  vi.mocked(create).mockReset();
  createKey();
  resetLink();
});
afterEach(() => {
  dropWaitingReplies();
  vi.useRealTimers();
});

describe('the user is told what Claude understood, not the raw message', () => {
  it('waits for the review, then tells the user the short summary (a voice note\'s slips put right)', async () => {
    claude({ summary: 'سارة تسأل عن موعد تسليم العقد، تحتاجه قبل الخميس.' });
    receiveFromBot({ messages: [wa('السلام عليكم ممكن اعرف متا موعد تسلييم العقد لاني احتاجه قبل الخميس', { media: true, mediaType: 'voice', voice: true })] });
    expect(alert).not.toHaveBeenCalled(); // nothing raw goes out first
    await vi.advanceTimersByTimeAsync(50);
    expect(bodies()).toEqual(['سارة تسأل عن موعد تسليم العقد، تحتاجه قبل الخميس.']);
    // Claude was told the 🎤 text came from a machine
    expect((vi.mocked(create).mock.calls[0][0] as { system: string }).system).toMatch(/🎤[\s\S]*written out by a machine/);
  });

  it('tells the user in the person\'s own words when no review is coming: replies off, or Claude failed', async () => {
    state.replyMode = 'off';
    receiveFromBot({ messages: [wa('hello there')] });
    expect(bodies()).toEqual(['hello there']);
    alert.mockClear();
    state.replyMode = 'smart';
    vi.mocked(create).mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    receiveFromBot({ messages: [wa('are you there?')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(bodies()).toEqual(['are you there?']);
  });

  it('keeps a stranger\'s raw words to 100 characters, gives Claude\'s summary 160, and no line breaks in either', async () => {
    claude({ summary: `${'ملخص '.repeat(60)}\nسطر ثاني` });
    receiveFromBot({ messages: [wa('x')] });
    await vi.advanceTimersByTimeAsync(50);
    expect(bodies()[0].length).toBeLessThanOrEqual(160);
    expect(bodies()[0]).not.toContain('\n');
  });

  it('does not tell the user twice about the same person within 15 minutes, unless it is urgent', async () => {
    const phone = '966522299999';
    claude({ summary: 'أول رسالة' });
    receiveFromBot({ messages: [wa('one', { phone })] });
    await vi.advanceTimersByTimeAsync(50);
    claude({ summary: 'ثاني رسالة' });
    receiveFromBot({ messages: [wa('two', { phone })] });
    await vi.advanceTimersByTimeAsync(50);
    expect(bodies()).toEqual(['أول رسالة']);
    claude({ summary: 'حادث، يحتاجك الآن', urgent: true });
    receiveFromBot({ messages: [wa('three', { phone })] });
    await vi.advanceTimersByTimeAsync(50);
    expect(bodies()).toEqual(['أول رسالة', 'حادث، يحتاجك الآن']);
  });
});
