import { beforeEach, describe, expect, it, vi } from 'vitest';

const INBOX = vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/facts-data', MAAI_DATA_FILE: '/tmp/claude-0/facts-data/store.json', ANTHROPIC_API_KEY: '', GOOGLE_CALENDAR_ICS_URL: '', MAAI_TIMEZONE: 'Asia/Riyadh' });
  return [
    { uid: 1, fromName: 'A', fromAddress: 'a@x.co', subject: 's', date: '2026-10-15T05:00:00Z', unread: true, body: '' },
    { uid: 2, fromName: 'B', fromAddress: 'b@x.co', subject: 's', date: '2026-10-15T05:10:00Z', unread: true, body: '' },
    { uid: 3, fromName: 'C', fromAddress: 'c@x.co', subject: 's', date: '2026-10-15T05:20:00Z', unread: false, body: '' },
  ];
});
vi.mock('../gmail-inbox.js', async (original) => ({ ...(await original<typeof import('../gmail-inbox')>()), cachedInbox: () => INBOX }));
vi.mock('../asana.js', async (original) => ({
  ...(await original<typeof import('../asana')>()),
  asanaConfigured: true,
  todayIso: () => '2026-10-15',
  cachedTasks: () => [
    { gid: '1', name: 'late', dueOn: '2026-10-10' },
    { gid: '2', name: 'today', dueOn: '2026-10-15' },
    { gid: '3', name: 'later', dueOn: '2026-10-20' },
    { gid: '4', name: 'no date' },
  ],
}));

import { briefingFacts } from './facts';
import { markHandled } from '../mail-handled';
import { id, state } from '../store';

// 10:00 in Riyadh
const NOW = new Date('2026-10-15T07:00:00Z');
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * 3_600_000).toISOString();

beforeEach(() => {
  state.events = [];
  state.reminders = [];
  state.inbox = [];
  state.handledMail = {};
  state.aiCache = {};
  state.stressDays = {};
});

describe('the numbers on the briefing card', () => {
  it('counts today\'s events, what is left of them, and picks the next one with its leave time', () => {
    state.events = [
      { id: 'a', title: 'Stand-up', start: at(-2), minutes: 15 },
      { id: 'b', title: 'Dentist', start: at(2), minutes: 45, place: 'Clinic', travelMinutes: 20 },
      { id: 'c', title: 'Report review', start: at(5), minutes: 60 },
      { id: 'd', title: 'Tomorrow thing', start: at(30), minutes: 30 },
      { id: 'e', title: 'Holiday', start: at(1), minutes: 1440, allDay: true },
    ];
    const facts = briefingFacts('en', NOW);
    expect(facts.events).toEqual({ left: 2, total: 3 }); // the all-day one is not a meeting; tomorrow's is not today's
    expect(facts.next).toMatchObject({ id: 'b', title: 'Dentist', place: 'Clinic' });
    expect(facts.next!.leaveAt).toBeTruthy();
  });

  it('has no next event on an empty day', () => {
    expect(briefingFacts('en', NOW)).toMatchObject({ next: undefined, events: { left: 0, total: 0 } });
  });

  it('counts overdue and due-today Asana tasks, and open reminders', () => {
    state.reminders = [
      { id: id(), title: 'a', when: 'x', repeat: 'once', done: false },
      { id: id(), title: 'b', when: 'x', repeat: 'once', done: true },
    ];
    const facts = briefingFacts('en', NOW);
    expect(facts.tasks).toEqual({ overdue: 1, dueToday: 1 });
    expect(facts.reminders).toEqual({ open: 1 });
  });

  it('counts unread email, and what needs a decision or a reply from the saved sort, without the ones already handled', () => {
    expect(briefingFacts('en', NOW).email).toEqual({ unread: 2, toDecide: 0, toReply: 0 }); // no saved sort yet
    state.aiCache['mail-digest:en'] = {
      fingerprint: 'x',
      at: NOW.toISOString(),
      value: { summary: '', items: [{ uid: 1, category: 'decide' }, { uid: 2, category: 'reply' }, { uid: 3, category: 'fyi' }] },
    };
    expect(briefingFacts('en', NOW).email).toEqual({ unread: 2, toDecide: 1, toReply: 1 });
    markHandled(1, 'replied');
    expect(briefingFacts('en', NOW).email).toEqual({ unread: 1, toDecide: 0, toReply: 1 });
    expect(briefingFacts('ar', NOW).email.toDecide).toBe(0); // each language has its own sort
  });

  it('counts people waiting on WhatsApp, not messages', () => {
    const msg = (phone: string, replied: boolean) => ({ id: id(), from: phone, phone, channel: 'whatsapp' as const, text: 'hi', receivedAt: NOW.toISOString(), replied });
    state.inbox = [msg('1', false), msg('1', false), msg('2', false), msg('3', true)];
    expect(briefingFacts('en', NOW).whatsapp).toEqual({ waiting: 2 });
  });

  it('works out the day\'s load from all of it, and remembers the day\'s highest', () => {
    state.events = [
      { id: 'a', title: 'One', start: at(1), minutes: 60 },
      { id: 'b', title: 'Two, straight after', start: at(2), minutes: 60 },
      { id: 'c', title: 'Three', start: at(5), minutes: 30 },
    ];
    state.reminders = [{ id: id(), title: 'late one', when: 'x', at: at(-1), repeat: 'once', done: false }];
    const msg = (phone: string) => ({ id: id(), from: phone, phone, channel: 'whatsapp' as const, text: 'hi', receivedAt: NOW.toISOString(), replied: false });
    state.inbox = [msg('1'), msg('2')];
    state.aiCache['whatsapp-digest:en'] = { fingerprint: 'x', at: NOW.toISOString(), value: { summary: '', items: [{ key: '1', priority: 'high' }, { key: '2', priority: 'low' }] } };
    state.aiCache['mail-digest:en'] = { fingerprint: 'x', at: NOW.toISOString(), value: { summary: '', items: [{ uid: 1, category: 'decide', priority: 'high' }, { uid: 2, category: 'reply', priority: 'normal' }] } };

    const { stress } = briefingFacts('en', NOW);
    const part = (key: string) => stress.factors.find((f) => f.key === key)!;
    expect(part('schedule')).toMatchObject({ count: 3, points: 14 }); // 3 left (9) + 1 back to back (3) + 0.5 h beyond the free 2 (1.5) = 13.5, rounded
    expect(part('whatsapp')).toMatchObject({ count: 2, points: 6 + 3 }); // 2 waiting, 1 important
    expect(part('email')).toMatchObject({ count: 2, points: 4 + 2 + 3 });
    expect(part('reminders')).toMatchObject({ count: 1, points: 2 + 3 }); // due today, and late
    expect(stress.score).toBe(stress.factors.reduce((a, f) => a + f.points, 0));
    expect(stress.drivers).toContain('schedule');
    expect(state.stressDays['2026-10-15']).toBe(stress.score);
    expect(stress.week).toHaveLength(7);
    expect(stress.week[6]).toEqual({ day: '2026-10-15', score: stress.score });

    // a lighter moment later in the day does not lower the day's highest score
    state.inbox = [];
    state.aiCache = {};
    const lighter = briefingFacts('en', NOW).stress;
    expect(lighter.score).toBeLessThan(stress.score);
    expect(state.stressDays['2026-10-15']).toBe(stress.score);
    expect(lighter.week[6].score).toBe(stress.score);
  });
});
