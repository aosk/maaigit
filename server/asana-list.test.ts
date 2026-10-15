import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PORT = vi.hoisted(() => {
  Object.assign(process.env, { MAAI_DATA_DIR: '/tmp/claude-0/asana-list-data', MAAI_DATA_FILE: '/tmp/claude-0/asana-list-data/store.json', ASANA_TOKEN: 'test-token', ASANA_API: 'http://127.0.0.1:45873', GOOGLE_CALENDAR_ICS_URL: '', ANTHROPIC_API_KEY: '' });
  return 45873;
});

import { openTasks, sortTasks } from './asana';
import { createInnerApp } from './site';
import { listen, raw } from './security/helpers';
import type { AsanaOverview, AsanaTask } from '../shared/types';

let total = 0;
let failing = false;
const requested: string[] = [];
let server: http.Server;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requested.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    if (failing) return void res.writeHead(500).end(JSON.stringify({ errors: [{ message: 'Asana is down' }] }));
    const url = new URL(req.url ?? '', 'http://x');
    if (url.pathname === '/users/me') return void res.end(JSON.stringify({ data: { workspaces: [{ gid: '1' }] } }));
    if (url.pathname === '/tasks') {
      const start = Number(url.searchParams.get('offset') ?? 0);
      const end = Math.min(start + 100, total);
      const data = Array.from({ length: end - start }, (_, i) => ({
        gid: String(1000 + start + i),
        name: `Task ${start + i}`,
        // every 10th task has a date; the rest have none
        due_on: (start + i) % 10 === 0 ? `2026-11-${String(10 + ((start + i) % 20)).padStart(2, '0')}` : null,
        created_at: new Date(Date.UTC(2026, 9, 1) + (start + i) * 60_000).toISOString(),
        permalink_url: `https://app.asana.com/0/1/${start + i}`,
      }));
      return void res.end(JSON.stringify({ data, next_page: end < total ? { offset: String(end) } : null }));
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  failing = false;
  requested.length = 0;
});

describe('your Asana list', () => {
  it('reads every page, not just the first hundred', async () => {
    total = 250;
    const tasks = await openTasks(true);
    expect(tasks).toHaveLength(250);
    expect(requested.filter((u) => u.startsWith('/tasks')).length).toBe(3);
  });

  it('puts dated tasks first, then the ones with no date with the newest on top', () => {
    const t = (name: string, dueOn?: string, createdAt?: string): AsanaTask => ({ gid: name, name, dueOn, createdAt, url: 'https://app.asana.com/0/1/2' });
    const sorted = sortTasks([t('old-undated', undefined, '2026-01-01'), t('later', '2026-12-01'), t('new-undated', undefined, '2026-10-14'), t('soon', '2026-10-20')]);
    expect(sorted.map((x) => x.name)).toEqual(['soon', 'later', 'new-undated', 'old-undated']);
  });

  it('hands the app all of them, so a task with no date never falls off the end of the list', async () => {
    total = 40;
    await openTasks(true);
    const app = await listen(createInnerApp());
    try {
      const overview = (await raw(app.port, 'GET', '/api/asana')).json() as AsanaOverview;
      expect(overview.open).toBe(40);
      expect(overview.tasks).toHaveLength(40);
      // the newest task without a date sits right after the dated ones
      const undated = overview.tasks.filter((x) => !x.dueOn);
      expect(undated[0].name).toBe('Task 39');
    } finally {
      await app.close();
    }
  });

  it('keeps showing what it had when Asana stops answering, and says why', async () => {
    total = 12;
    await openTasks(true);
    failing = true;
    expect((await openTasks(true)).length).toBe(12);
    const app = await listen(createInnerApp());
    try {
      const overview = (await raw(app.port, 'GET', '/api/asana')).json() as AsanaOverview;
      expect(overview.tasks.length).toBeGreaterThan(0);
      expect(overview.error).toMatch(/Asana is down/);
    } finally {
      await app.close();
    }
  });
});
