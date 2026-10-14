import { describe, expect, it } from 'vitest';
import type { AsanaTask } from '../shared/types';
import { AsanaError, isGid, summarize, validateNewTask } from './asana';

const task = (dueOn?: string): AsanaTask => ({ gid: String(Math.random()), name: 'x', dueOn, url: 'https://app.asana.com/0/1/2' });

describe('Asana summary', () => {
  it('counts open, overdue and due-today tasks', () => {
    const s = summarize([task('2026-10-12'), task('2026-10-13'), task('2026-10-13'), task('2026-10-20'), task()], '2026-10-13');
    expect(s).toMatchObject({ open: 5, overdue: 1, dueToday: 2 });
  });
});

describe('new Asana tasks', () => {
  it('cleans up what the user typed', () => {
    expect(validateNewTask({ name: '  Call the accountant ', notes: ' VAT ', dueOn: '2026-10-25', projectGid: '1209876543210' })).toEqual({
      name: 'Call the accountant',
      notes: 'VAT',
      dueOn: '2026-10-25',
      projectGid: '1209876543210',
    });
    expect(validateNewTask({ name: 'No extras' })).toEqual({ name: 'No extras', notes: '', dueOn: '', projectGid: '' });
  });

  it('refuses a missing name, a bad date or a bad project', () => {
    expect(() => validateNewTask({ name: '   ' })).toThrow(AsanaError);
    expect(() => validateNewTask({ name: 'x', dueOn: 'tomorrow' })).toThrow(/due date/);
    expect(() => validateNewTask({ name: 'x', projectGid: '../../users' })).toThrow(/project/);
  });

  it('only lets real Asana ids through to the address', () => {
    expect(isGid('1209876543210')).toBe(true);
    for (const bad of ['', 'abc', '12', '1/../2', '1209876543210?x=1', 42, undefined]) expect(isGid(bad)).toBe(false);
  });
});
