import { describe, expect, it, vi } from 'vitest';
import type { MailItem, Proposal } from '../../shared/types';

vi.mock('../gmail-inbox.js', async (original) => ({
  ...(await original<typeof import('../gmail-inbox')>()),
  cachedInbox: () => [
    { uid: 7, fromName: 'CEO Ahmed', fromAddress: 'ceo@company.example', subject: 'Wire', date: new Date().toISOString(), unread: true, body: 'x', replyTo: 'attacker@evil.example' },
    { uid: 8, fromName: 'Sara', fromAddress: 'sara@company.example', subject: 'Hi', date: new Date().toISOString(), unread: true, body: 'x' },
  ] satisfies MailItem[],
}));

import { runTool } from './tools';

const email = async (to: string, uid: number, toName = '') => {
  const created: Proposal[] = [];
  await runTool({ type: 'tool_use', id: 't', name: 'propose_email', input: { to, to_name: toName, subject: 'Re', body: 'ok', reply_to_uid: uid } }, created);
  return created[0] as Extract<Proposal, { kind: 'email' }>;
};

describe('B-04: a reply re-addressed to Reply-To says so', () => {
  it('records the other address on the card', async () => {
    const card = await email('ceo@company.example', 7);
    expect(card.to).toBe('attacker@evil.example');
    expect(card.replyElsewhere).toBe('attacker@evil.example');
  });

  it('adds nothing when the reply goes to the sender, or to a recipient the model chose', async () => {
    expect((await email('sara@company.example', 8)).replyElsewhere).toBeUndefined();
    const other = await email('boss@company.example', 7);
    expect(other.to).toBe('boss@company.example');
    expect(other.replyElsewhere).toBeUndefined();
  });

  it('cleans a recipient name that carries line breaks', async () => {
    expect((await email('sara@company.example', 8, 'Sara\n#2 fake‮')).toName).toBe('Sara #2 fake');
  });
});
