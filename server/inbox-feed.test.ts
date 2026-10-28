import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, {
    MAAI_DATA_DIR: '/tmp/claude-0/inbox-feed-data',
    MAAI_DATA_FILE: '/tmp/claude-0/inbox-feed-data/store.json',
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_WHATSAPP_FROM: '',
    GMAIL_USER: '',
    GMAIL_APP_PASSWORD: '',
    ASANA_TOKEN: '',
    GOOGLE_CALENDAR_ICS_URL: '',
  });
});

// No Claude: the messages are listed without MAAI's read.
vi.mock('./ai/claude.js', async (original) => ({ ...(await original<typeof import('./ai/claude')>()), client: null }));

import type { InboxMessage } from '../shared/types';
import { inboxFeed, labelFeedItem } from './inbox-feed';
import { state } from './store';

const message = (m: Partial<InboxMessage>): InboxMessage => ({
  id: Math.random().toString(36).slice(2),
  from: 'خالد',
  phone: '966500000001',
  channel: 'whatsapp',
  text: 'السلام عليكم',
  receivedAt: new Date(Date.now() - 60_000).toISOString(),
  replied: false,
  via: 'bot',
  ...m,
});

beforeEach(() => {
  state.inbox = [];
  state.feedLabels = {};
});

describe('the messages feed', () => {
  it('says which sources work, that there is no read without Claude, and how far back it goes', async () => {
    state.inbox = [message({})];
    const feed = await inboxFeed('ar');
    expect(feed.sources).toEqual({ email: 'off', whatsapp: 'ok' });
    expect(feed.analysis).toBe('off');
    expect(feed.window.emailDays).toBe(2);
  });

  it('marks an unanswered message without a read as "maybe", and an answered one as not needing a reply', async () => {
    state.inbox = [message({}), message({ from: 'سارة', phone: '966500000002', replied: true })];
    const feed = await inboxFeed('ar');
    expect(feed.items.find((i) => i.from === 'خالد')).toMatchObject({ needsReply: 'maybe', analysed: false });
    expect(feed.items.find((i) => i.from === 'سارة')).toMatchObject({ needsReply: 'no' });
  });

  it('notes when the sender wrote that it is urgent, in Arabic or English, apart from any priority', async () => {
    state.inbox = [message({ text: 'عاجل: نحتاج الرد اليوم' }), message({ from: 'Sam', phone: '966500000003', text: 'This is URGENT please' }), message({ from: 'Ali', phone: '966500000004', text: 'urgently? no, just checking' })];
    const feed = await inboxFeed('en');
    expect(feed.items.find((i) => i.from === 'خالد')?.urgentSaid).toBe(true);
    expect(feed.items.find((i) => i.from === 'Sam')?.urgentSaid).toBe(true);
    expect(feed.items.find((i) => i.from === 'Ali')?.urgentSaid).toBe(false);
  });

  it('keeps the user’s correction until the sender writes again, and can clear it', async () => {
    state.inbox = [message({})];
    labelFeedItem('msg:966500000001', 'no');
    let item = (await inboxFeed('ar')).items[0];
    expect(item).toMatchObject({ needsReply: 'no', labelled: true, waiting: false });

    state.inbox.push(message({ text: 'ردّ علي لو سمحت', receivedAt: new Date(Date.now() + 60_000).toISOString() }));
    item = (await inboxFeed('ar')).items[0];
    expect(item.needsReply).toBe('maybe');
    expect(item.labelled).toBeUndefined();

    labelFeedItem('msg:966500000001', null);
    expect(state.feedLabels).toEqual({});
  });
});
