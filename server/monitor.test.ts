import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { monitorConfigured, monitoring, resetMonitor, shapeOf } from './monitor';

const answer = (status: number, body: string) => {
  const calls: { url: string; auth: string }[] = [];
  const ask = (async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), auth: (init.headers as Record<string, string>).authorization });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { ask, calls };
};

beforeEach(() => {
  resetMonitor();
  process.env.MONITOR_API_KEY = 'mon_test';
});
afterEach(() => {
  delete process.env.MONITOR_API_KEY;
  delete process.env.MONITOR_URL;
});

describe('the monitoring page of the other site', () => {
  it('asks the site with the key from the server and the days asked for, and keeps the answer a few minutes', async () => {
    const site = answer(200, JSON.stringify({ requests: 5 }));
    const first = await monitoring(7, false, site.ask, 1_000_000);
    expect(first).toMatchObject({ ok: true, data: { requests: 5 } });
    expect(site.calls).toEqual([{ url: 'https://hail-moving-atlas.jb7hqcy4v6.chatgpt.site/api/monitoring?days=7', auth: 'Bearer mon_test' }]);
    await monitoring(7, false, site.ask, 1_000_000 + 60_000);
    expect(site.calls.length).toBe(1); // kept
    await monitoring(7, true, site.ask, 1_000_000 + 61_000);
    expect(site.calls.length).toBe(2); // "refresh" asks again
    await monitoring(30, false, site.ask, 1_000_000 + 62_000);
    expect(site.calls[2].url).toContain('days=30');
    await monitoring(12345, false, site.ask, 1_000_000 + 63_000);
    expect(site.calls.length).toBe(3); // an odd number of days is taken as 30, which is kept
  });

  it('says why when there is nothing to show, and never asks without a key', async () => {
    delete process.env.MONITOR_API_KEY;
    expect(monitorConfigured()).toBe(false);
    const none = answer(200, '{}');
    await expect(monitoring(30, false, none.ask)).resolves.toEqual({ ok: false, why: 'no-key' });
    expect(none.calls.length).toBe(0);
    process.env.MONITOR_API_KEY = 'mon_test';
    await expect(monitoring(30, true, answer(401, 'no').ask)).resolves.toEqual({ ok: false, why: 'refused', status: 401 });
    await expect(monitoring(30, true, answer(200, '<html>a page</html>').ask)).resolves.toEqual({ ok: false, why: 'not-json' });
    await expect(monitoring(30, true, answer(200, JSON.stringify('x'.repeat(1_100_000))).ask)).resolves.toEqual({ ok: false, why: 'too-big' });
    const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    await expect(monitoring(30, true, down)).resolves.toEqual({ ok: false, why: 'unreachable' });
  });

  it('tries again soon after a failure, so a fixed key shows quickly', async () => {
    await monitoring(30, false, answer(401, 'no').ask, 5_000_000);
    const good = answer(200, '{"ok":1}');
    await expect(monitoring(30, false, good.ask, 5_000_000 + 10_000)).resolves.toMatchObject({ ok: false });
    await expect(monitoring(30, false, good.ask, 5_000_000 + 30_000)).resolves.toMatchObject({ ok: true });
  });

  it('describes an answer by its field names and kinds only, never its values', () => {
    const shape = shapeOf({ visitors: 4321, owner: 'secret name', days: [{ date: '2026-11-17', n: 1 }] });
    expect(shape).toBe('{visitors:number,owner:string,days:[{date:string,n:number}]x1}');
    expect(shape).not.toContain('secret');
    expect(shape).not.toContain('4321');
  });
});
