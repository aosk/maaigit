import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/fix-intake-data', MAAI_DATA_FILE: '/tmp/claude-0/fix-intake-data/store.json' });
});

const alert = vi.hoisted(() => vi.fn(async (_key: string, _text: (lang: 'ar' | 'en') => { title: string; body: string }) => {}));
vi.mock('./notify.js', async (original) => ({ ...(await original<typeof import('./notify')>()), alertMessage: alert }));

import type { InboxMessage } from '../shared/types';
import { alertedCount, tell } from './intake';

const message = (over: Partial<InboxMessage> = {}): InboxMessage => ({ id: 'm', from: 'Sara', phone: '966511112222', channel: 'whatsapp', text: 'hi', receivedAt: new Date().toISOString(), replied: false, via: 'twilio', ...over });

beforeEach(() => alert.mockClear());

describe('C4: notification text from a stranger', () => {
  it('labels the sender in the title and shortens the body, with no line breaks', async () => {
    await tell(message({ from: 'MAAI SECURITY\n‮Your account is locked', text: `Call this number now ${'x'.repeat(400)}` }), {}, 1_000_000);
    const [, text] = alert.mock.calls[0];
    const en = text('en');
    expect(en.title).toBe('Message from MAAI SECURITY Your account is locked');
    expect(text('ar').title).toMatch(/^رسالة من MAAI/);
    expect(en.body.length).toBeLessThanOrEqual(100);
    expect(`${en.title}${en.body}`).not.toMatch(/[\n‮]/);
  });
});

describe('B-19: the alert memory is bounded', () => {
  it('forgets old senders once it grows past its cap', async () => {
    for (let i = 0; i < 700; i += 1) await tell(message({ phone: `9665${String(i).padStart(8, '0')}` }), {}, 2_000_000 + i);
    expect(alertedCount()).toBeLessThanOrEqual(500);
    // A much later sender clears everyone past the 15 quiet minutes.
    await tell(message({ phone: '966599999999' }), {}, 2_000_000 + 3_600_000);
    expect(alertedCount()).toBeLessThan(500);
  });
});
