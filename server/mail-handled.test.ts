import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/handled-data', MAAI_DATA_FILE: '/tmp/claude-0/handled-data/store.json', ANTHROPIC_API_KEY: '', ASANA_TOKEN: '', GOOGLE_CALENDAR_ICS_URL: '' });
});

const INBOX = vi.hoisted(() => [
  { uid: 101, fromName: 'Noura', fromAddress: 'noura.hr@example.com', subject: 'Training Sunday 10am', date: '2026-10-14T07:40:00Z', unread: true, body: 'Please confirm your attendance.' },
  { uid: 102, fromName: 'Ahmed', fromAddress: 'ahmed@example.com', subject: 'Lunch?', date: '2026-10-14T08:00:00Z', unread: true, body: 'Lunch tomorrow?' },
]);
vi.mock('./gmail-inbox.js', async (original) => ({ ...(await original<typeof import('./gmail-inbox')>()), inboxConfigured: true, cachedInbox: () => INBOX, fetchInbox: vi.fn(async () => INBOX), getEmail: vi.fn(async (uid: number) => INBOX.find((m) => m.uid === uid)) }));
vi.mock('./mail.js', async (original) => ({ ...(await original<typeof import('./mail')>()), mailConfigured: true, sendMail: vi.fn(async () => {}) }));
vi.mock('./gwrite.js', async (original) => ({ ...(await original<typeof import('./gwrite')>()), mirrorToGoogle: vi.fn(async () => ({ status: 'added' as const })) }));

import type { Proposal } from '../shared/types';
import { digestInbox } from './ai/mail';
import { runTool } from './ai/tools';
import { contextNote } from './ai/context';
import { createInnerApp } from './site';
import { listen, raw } from './security/helpers';
import { sendMail } from './mail';
import { state } from './store';

let server: Awaited<ReturnType<typeof listen>>;
beforeEach(async () => {
  state.handledMail = {};
  state.proposals = [];
  state.events = state.events.filter((e) => e.demo);
  vi.mocked(sendMail).mockClear();
  server = await listen(createInnerApp());
  return () => server.close();
});

const card = (p: object): Proposal => {
  const proposal = { id: `p_${Math.random().toString(16).slice(2, 10)}`, status: 'pending', title: 't', ...p } as Proposal;
  state.proposals.push(proposal);
  return proposal;
};
const approve = (p: Proposal, body: object = {}) => raw(server.port, 'POST', `/api/proposals/${p.id}/approve`, { body: JSON.stringify(body) });
const sunday = () => new Date(Date.now() + 3 * 86_400_000).toISOString();

describe('an email stops asking for a decision once it was dealt with', () => {
  it('is handled when the reply the assistant wrote for it is sent', async () => {
    const reply = card({ kind: 'email', to: 'noura.hr@example.com', subject: 'Re: Training', body: 'I will attend.', replyToUid: 101 });
    expect((await approve(reply)).status).toBe(200);
    expect(state.handledMail['101']).toMatchObject({ how: 'replied' });
    expect(state.handledMail['102']).toBeUndefined();
    const digest = await digestInbox('en', false);
    expect(digest.emails.find((m) => m.uid === 101)?.handled).toMatchObject({ how: 'replied' });
    expect(digest.emails.find((m) => m.uid === 102)?.handled).toBeUndefined();
    expect(contextNote()).toMatch(/#101 .*\(already handled by the user\)/);
    expect(contextNote()).not.toMatch(/#102 .*already handled/);
  });

  it('is found by the sender\'s address when the reply was not tagged with the email number', async () => {
    const reply = card({ kind: 'email', to: 'AHMED@example.com', subject: 'Re: Lunch', body: 'Yes!' });
    await approve(reply);
    expect(state.handledMail['102']).toMatchObject({ how: 'replied' });
  });

  it('is handled when the meeting it invited the user to is booked', async () => {
    const meeting = card({ kind: 'meeting', title: 'Training', attendee: 'Noura', minutes: 60, options: [{ start: sunday() }], emailUid: 101 });
    expect((await approve(meeting)).status).toBe(200);
    expect(state.events.some((e) => e.title === 'Training')).toBe(true);
    expect(state.handledMail['101']).toMatchObject({ how: 'meeting' });
  });

  it('stays waiting when the reply could not be sent, or was cancelled', async () => {
    const { MailError } = await import('./mail');
    vi.mocked(sendMail).mockRejectedValueOnce(new MailError('Gmail refused.'));
    const failed = card({ kind: 'email', to: 'noura.hr@example.com', subject: 's', body: 'b', replyToUid: 101 });
    expect((await approve(failed)).status).toBe(400);
    const cancelled = card({ kind: 'email', to: 'ahmed@example.com', subject: 's', body: 'b', replyToUid: 102 });
    await raw(server.port, 'POST', `/api/proposals/${cancelled.id}/cancel`, { body: '{}' });
    expect(state.handledMail).toEqual({});
  });

  it('ignores nonsense email numbers and keeps the list from growing without end', async () => {
    for (const bad of [0, -4, 1.5, Number.NaN, undefined]) {
      const c = card({ kind: 'email', to: 'nobody@example.com', subject: 's', body: 'b', replyToUid: bad });
      await approve(c);
    }
    expect(state.handledMail).toEqual({});
    const { markHandled } = await import('./mail-handled');
    for (let uid = 1; uid <= 520; uid++) markHandled(uid, 'replied');
    expect(Object.keys(state.handledMail).length).toBeLessThanOrEqual(500);
  });
});

describe('answering an invitation puts it in the calendar too', () => {
  it('lets the assistant tag a reply and a meeting with the email they come from', async () => {
    const created: Proposal[] = [];
    const call = (name: string, input: object) => runTool({ type: 'tool_use', id: name, name, input } as never, created);
    await call('propose_email', { to: 'noura.hr@example.com', to_name: 'Noura', subject: 'Re: Training', body: 'Confirmed.', reply_to_uid: 101 });
    await call('propose_meeting', { title: 'Training session', attendee: 'Noura', attendee_email: '', minutes: 60, options: [{ start: sunday(), note: 'As invited' }], email_uid: 101 });
    await call('propose_email', { to: 'x@example.com', to_name: '', subject: 's', body: 'b', reply_to_uid: 0 });
    expect(created[0]).toMatchObject({ kind: 'email', replyToUid: 101 });
    expect(created[1]).toMatchObject({ kind: 'meeting', emailUid: 101 });
    expect((created[2] as { replyToUid?: number }).replyToUid).toBeUndefined();
  });

  it('is part of the instructions: confirming an invitation means a calendar card as well as a reply', async () => {
    const { tools } = await import('./ai/tools');
    const meeting = tools.find((t) => t.name === 'propose_meeting')!;
    expect(meeting.input_schema.required).toContain('email_uid');
    expect(tools.find((t) => t.name === 'propose_email')!.input_schema.required).toContain('reply_to_uid');
    const { strings } = await import('../src/i18n');
    expect(strings.en.decidePrompt(1, 'A', 'B', 'Yes')).toMatch(/add it to my calendar/);
    expect(strings.ar.decidePrompt(1, 'A', 'B', 'نعم')).toMatch(/تقويمي/);
  });
});
