import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/inbound-data',
    MAAI_DATA_FILE: '/tmp/claude-0/inbound-data/store.json',
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
import { createKey, receiveFromBot, resetLink } from './bot';
import { clearInbound, onInbound } from './inbound';
import { state } from './store';

const wa = (phone: string, text: string) => ({ id: `m${Math.random().toString(16).slice(2)}`, channel: 'whatsapp', from: 'Someone', phone, text, at: new Date().toISOString() });
const queued = () => state.bot.commands.filter((c) => c.status === 'queued');

beforeEach(() => {
  clearInbound();
  state.inbox = state.inbox.filter((m) => m.via !== 'bot');
  state.bot = { commands: [] };
  state.whatsappAcks = {};
  state.intake = {};
  state.replyMode = 'smart';
  state.replyWaitSeconds = 0;
  state.notifyPrefs.messages = false;
  for (const agent of state.agents) agent.enabled = true;
  vi.mocked(create).mockReset();
  vi.mocked(create).mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify({ reply: 'متى يناسبك؟', enough: false, summary: 's', urgent: false }) }] } as never);
  createKey();
  resetLink();
});
afterEach(() => clearInbound());

describe('who answers a new private message', () => {
  it('is the general reply when no module claims it', async () => {
    receiveFromBot({ messages: [wa('966522222222', 'hello')] }, Date.now());
    await vi.waitFor(() => expect(queued()).toHaveLength(1));
  });

  it('is the module that claims it, and then the general reply stays out', async () => {
    const seen: string[] = [];
    onInbound((m) => {
      seen.push(m.phone ?? '');
      return m.phone === '966533333333';
    });
    receiveFromBot({ messages: [wa('966533333333', 'from a team member')] }, Date.now());
    await new Promise((r) => setTimeout(r, 50));
    expect(seen).toEqual(['966533333333']);
    expect(queued()).toHaveLength(0);
    expect(vi.mocked(create)).not.toHaveBeenCalled();
    // someone else is not claimed, so the general reply answers them
    receiveFromBot({ messages: [wa('966544444444', 'hello')] }, Date.now());
    await vi.waitFor(() => expect(queued()).toHaveLength(1));
  });

  it('can be handed back: a module that finds the message is not its own gives it to the general reply', async () => {
    onInbound((_m, fallback) => {
      setTimeout(fallback, 10); // after its own check, say a classification
      return true;
    });
    receiveFromBot({ messages: [wa('966555555555', 'hello')] }, Date.now());
    expect(queued()).toHaveLength(0);
    await vi.waitFor(() => expect(queued()).toHaveLength(1));
  });
});
