import { describe, expect, it } from 'vitest';
import type { Proposal } from '../../shared/types';
import { prayersFor } from '../../shared/prayer';
import { config } from '../config';
import { runTool, tools } from './tools';
import type { ToolUse } from './claude';

const call = (name: string, input: unknown): ToolUse => ({ type: 'tool_use', id: 't1', name, input });

describe('assistant tools', () => {
  it('lists every tool as strict', () => {
    expect(tools.map((t) => t.name).sort()).toEqual(['propose_asana_task', 'propose_asana_update', 'propose_email', 'propose_meeting', 'propose_remember', 'propose_reminder', 'propose_whatsapp', 'read_asana_task', 'read_email', 'read_whatsapp']);
    expect(tools.every((t) => t.strict)).toBe(true);
  });

  it('turns a meeting into a pending card, dropping times during a prayer', async () => {
    const day = new Date('2026-10-14T00:00:00');
    const dhuhr = prayersFor(day, config.latitude, config.longitude).find((p) => p.name === 'dhuhr')!.time;
    const free = new Date(day);
    free.setHours(10, 0, 0, 0);
    const created: Proposal[] = [];
    const { result, detail } = await runTool(
      call('propose_meeting', {
        title: 'Meeting with Sara',
        attendee: 'Sara',
        attendee_email: '',
        minutes: 30,
        options: [{ start: dhuhr.toISOString(), note: '' }, { start: free.toISOString(), note: 'Best fit' }],
      }),
      created,
    );
    expect(result.is_error).toBeUndefined();
    expect(detail).toBe('Meeting with Sara');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: 'meeting', status: 'pending', options: [{ start: free.toISOString(), note: 'Best fit' }] });
  });

  it('asks Claude to try again when no time works', async () => {
    const created: Proposal[] = [];
    const { result } = await runTool(call('propose_meeting', { title: 'x', attendee: 'x', attendee_email: '', minutes: 30, options: [{ start: 'soon', note: '' }] }), created);
    expect(result.is_error).toBe(true);
    expect(created).toHaveLength(0);
  });

  it('refuses an email without a real address', async () => {
    const created: Proposal[] = [];
    const { result } = await runTool(call('propose_email', { to: 'Ahmed', to_name: '', subject: 'Hi', body: 'Hello' }), created);
    expect(result.is_error).toBe(true);
    expect(String(result.content)).toMatch(/not an email address/);
  });

  it('does not touch Asana when it is not connected', async () => {
    const created: Proposal[] = [];
    const { result } = await runTool(call('propose_asana_update', { task_gid: '1', comment: 'Done', complete: true, due_on: '' }), created);
    expect(result.is_error).toBe(true);
    expect(created).toHaveLength(0);
    expect((await runTool(call('propose_asana_task', { name: 'Call the accountant', notes: '', due_on: '', project_name: '' }), created)).result.is_error).toBe(true);
    expect(created).toHaveLength(0);
    expect((await runTool(call('read_asana_task', { task_gid: '1' }), created)).result.is_error).toBe(true);
  });

  it('reports an unknown tool as an error instead of throwing', async () => {
    const { result } = await runTool(call('delete_everything', {}), []);
    expect(result.is_error).toBe(true);
  });
});
