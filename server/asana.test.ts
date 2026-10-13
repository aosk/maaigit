import { describe, expect, it } from 'vitest';
import type { AsanaTask } from '../shared/types';
import { summarize } from './asana';

const task = (dueOn?: string): AsanaTask => ({ gid: String(Math.random()), name: 'x', dueOn, url: 'https://app.asana.com/0/1/2' });

describe('Asana summary', () => {
  it('counts open, overdue and due-today tasks', () => {
    const s = summarize([task('2026-10-12'), task('2026-10-13'), task('2026-10-13'), task('2026-10-20'), task()], '2026-10-13');
    expect(s).toMatchObject({ open: 5, overdue: 1, dueToday: 2 });
  });
});
