import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/suggestions-data', MAAI_DATA_FILE: '/tmp/claude-0/suggestions-data/store.json', ASANA_TOKEN: '', GOOGLE_CALENDAR_ICS_URL: '' });
});
const mail = vi.hoisted(() => ({ items: [] as { unread: boolean }[] }));
vi.mock('./gmail-inbox.js', async (original) => ({ ...(await original<typeof import('./gmail-inbox')>()), cachedInbox: () => mail.items }));

import { state } from './store';
import { chatSuggestions } from './suggestions';

const NOW = new Date('2026-11-16T09:00:00+03:00');
const said = (...texts: string[]) => ({ id: 'c', apiMessages: [], turns: texts.flatMap((text) => [{ role: 'user' as const, text }, { role: 'assistant' as const, text: 'تم' }]) });

beforeEach(() => {
  state.conversations = [];
  state.inbox = [];
  state.duties = [];
  state.events = [];
  mail.items = [];
});

describe('what the empty chat offers', () => {
  it('is the usual examples when nothing is known yet', () => {
    expect(chatSuggestions('ar', NOW)).toEqual(['احجز اجتماع مع سارة الأسبوع الجاي، الصباح لو أمكن', 'ذكّرني أتصل على أمي بعد صلاة المغرب', 'كيف جدولي العصر؟']);
    expect(chatSuggestions('en', NOW)[0]).toMatch(/^Book a meeting/);
  });

  it('puts the orders the user repeats first, most often first, in their newest wording, across old conversations', () => {
    // the newest conversation is first in the list
    state.conversations = [said('لخّص لي رسائل اليوم', 'وش وضع السوق؟'), said('وش وضع السوق', 'لخص لي رسائل اليوم', 'لخص لي رسائل اليوم', 'شي قلته مرة وحدة')];
    const out = chatSuggestions('ar', NOW);
    expect(out.slice(0, 2)).toEqual(['لخّص لي رسائل اليوم', 'وش وضع السوق؟']);
    expect(out).not.toContain('شي قلته مرة وحدة');
    expect(out).toHaveLength(4);
  });

  it('never offers a message with a phone number, a file, a very long one, or one in the other language', () => {
    const long = 'اكتب لي '.repeat(20);
    state.conversations = [said('أضف ليلى 0505555555 لناجز', 'أضف ليلى 0505555555 لناجز', long, long, 'what is my day like', 'what is my day like')];
    state.conversations[0].turns.push({ role: 'user', text: 'لخص هذا الملف لي', attachments: [{ name: 'a.pdf', kind: 'pdf' }] }, { role: 'user', text: 'لخص هذا الملف لي', attachments: [{ name: 'a.pdf', kind: 'pdf' }] });
    const ar = chatSuggestions('ar', NOW);
    expect(ar.join(' ')).not.toMatch(/0505555555|اكتب لي|what is|الملف/);
    expect(chatSuggestions('en', NOW)[0]).toBe('what is my day like');
  });

  it('offers what today calls for: unanswered WhatsApp, open follow-ups, unread mail, meetings still to come', () => {
    state.inbox = [{ id: 'm', channel: 'whatsapp', from: 'x', text: 'hi', receivedAt: new Date(NOW.getTime() - 3_600_000).toISOString(), replied: false }] as never;
    state.duties = [{ status: 'open' }] as never;
    expect(chatSuggestions('ar', NOW)).toEqual(['وش رسائل الواتساب اللي تحتاج رد؟', 'وش صار على متابعات الفريق؟', 'احجز اجتماع مع سارة الأسبوع الجاي، الصباح لو أمكن', 'ذكّرني أتصل على أمي بعد صلاة المغرب']);
    mail.items = [{ unread: true }];
    state.events = [{ id: 'e', title: 't', start: new Date(NOW.getTime() + 3 * 3_600_000).toISOString() }] as never;
    expect(chatSuggestions('ar', NOW)).toEqual(['وش رسائل الواتساب اللي تحتاج رد؟', 'وش صار على متابعات الفريق؟', 'وش أهم الإيميلات اللي ما قريتها؟', 'كيف جدولي اليوم؟']);
  });

  it('ignores answered, group and old WhatsApp messages, finished follow-ups, and meetings already over', () => {
    const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
    state.inbox = [{ channel: 'whatsapp', replied: true, receivedAt: at(1) }, { channel: 'whatsapp', replied: false, group: true, receivedAt: at(1) }, { channel: 'whatsapp', replied: false, receivedAt: at(72) }] as never;
    state.duties = [{ status: 'done' }, { status: 'cancelled' }] as never;
    state.events = [{ id: 'e', title: 't', start: at(2) }] as never;
    expect(chatSuggestions('ar', NOW)).toHaveLength(3);
    expect(chatSuggestions('ar', NOW)[0]).toMatch(/^احجز/);
  });

  it('does not repeat a habit that is the same as a ready suggestion', () => {
    state.conversations = [said('كيف جدولي اليوم', 'كيف جدولي اليوم؟')];
    state.events = [{ id: 'e', title: 't', start: new Date(NOW.getTime() + 3_600_000).toISOString() }] as never;
    const out = chatSuggestions('ar', NOW);
    expect(out.filter((x) => x.startsWith('كيف جدولي اليوم'))).toHaveLength(1);
  });
});
