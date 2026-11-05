import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { costOf, levelOf, localUsage, renderCheck, renderUsage, resetRenderCache } from './render-usage';

const NOW = Date.parse('2026-11-05T01:00:00Z');

/** Render's API as the server sees it: the services list and this service's metrics. */
function fakeRender(seen: string[] = []): typeof fetch {
  const series = (unit: string, values: number[], labels: { field: string; value: string }[] = []) => ({ unit, labels, values: values.map((value, i) => ({ timestamp: new Date(NOW - (values.length - i) * 3_600_000).toISOString(), value })) });
  return (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    switch (url.pathname) {
      case '/v1/services':
        return json([
          { service: { id: 'srv-me', name: 'maaigit', type: 'web_service', suspended: 'not_suspended', serviceDetails: { plan: '0.5c-512mb', url: 'https://maaigit.onrender.com', disk: { sizeGB: 2 } } } },
          { service: { id: 'srv-b', name: 'studio', type: 'web_service', suspended: 'not_suspended', serviceDetails: { plan: 'starter', disk: { sizeGB: 1 } } } },
          { service: { id: 'srv-c', name: 'najiz-chat', type: 'web_service', suspended: 'suspended', serviceDetails: { plan: 'starter', disk: { sizeGB: 1 } } } },
          { service: { id: 'srv-d', name: 'site', type: 'static_site', suspended: 'not_suspended', serviceDetails: {} } },
          { service: { id: 'srv-e', name: 'demo', type: 'web_service', suspended: 'not_suspended', serviceDetails: { plan: 'free' } } },
        ]);
      case '/v1/metrics/cpu': return json([series('cpu', [0.01, 0.2, 0.05])]);
      case '/v1/metrics/cpu-limit': return json([series('cpu', [0.5, 0.5, 0.5])]);
      case '/v1/metrics/memory': return json([series('bytes', [180e6, 190e6, 200e6])]);
      case '/v1/metrics/memory-limit': return json([series('bytes', [536870912])]);
      case '/v1/metrics/bandwidth': return json([series('mb', [5, 5, 5, 5, 5, 5, 5])]);
      case '/v1/metrics/http-requests': return json([series('unitless', [900, 900], [{ field: 'statusCode', value: '200' }]), series('unitless', [0, 106], [{ field: 'statusCode', value: '502' }])]);
      default: return new Response('{}', { status: 404 });
    }
  });
}

beforeEach(() => {
  resetRenderCache();
  process.env.RENDER_API_KEY = 'rnd_test';
  process.env.RENDER_SERVICE_ID = 'srv-me';
});
afterEach(() => {
  delete process.env.RENDER_API_KEY;
  delete process.env.RENDER_SERVICE_ID;
});

describe('levels', () => {
  it('turns a value into low, medium or high', () => {
    expect([levelOf(10, 60, 85), levelOf(60, 60, 85), levelOf(90, 60, 85)]).toEqual(['low', 'medium', 'high']);
  });
});

describe('what Render costs', () => {
  it('prices each service: instance plus disk, a suspended one only for its disk, static and free ones nothing', () => {
    expect(costOf({ id: 'a', name: 'a', type: 'web_service', serviceDetails: { plan: '0.5c-512mb', disk: { sizeGB: 2 } } })).toMatchObject({ plan: 'Starter', computeUsd: 7, diskUsd: 0.5, monthlyUsd: 7.5 });
    expect(costOf({ id: 'b', name: 'b', type: 'web_service', suspended: 'suspended', serviceDetails: { plan: 'starter', disk: { sizeGB: 1 } } })).toMatchObject({ computeUsd: 0, diskUsd: 0.25, note: expect.stringContaining('only the disk') });
    expect(costOf({ id: 'c', name: 'c', type: 'static_site' })).toMatchObject({ plan: 'Static', monthlyUsd: 0 });
    expect(costOf({ id: 'd', name: 'd', type: 'web_service', serviceDetails: { plan: 'mystery' } })).toMatchObject({ monthlyUsd: 0, note: expect.stringContaining('Unknown plan') });
  });

  it('adds up the workspace and reads this service’s use, with levels', async () => {
    const seen: string[] = [];
    const r = await renderUsage({ now: NOW, fetcher: fakeRender(seen) });
    expect(r.reports).toBe('ok');
    expect(r.monthly).toMatchObject({ usd: 15, running: 2, suspended: 1, free: 2, idleUsd: 0.25, level: 'low' });
    expect(r.services![0]).toMatchObject({ name: 'maaigit', self: true });
    expect(r.self!.cpu).toMatchObject({ limit: 0.5, pct: 40, level: 'low' });
    expect(r.self!.memory!.level).toBe('low');
    expect(r.self!.bandwidth).toMatchObject({ last30MB: 35, projectedMonthMB: 150, level: 'low' });
    expect(r.self!.requests).toMatchObject({ total24h: 1906, errors24h: 106, errorRate: 5.6, level: 'high' });
    expect(renderCheck()).toMatchObject({ id: 'render', status: 'warn', detail: expect.stringContaining('About $15 a month') });
    // Cached: a second look does not call Render again.
    const calls = seen.length;
    await renderUsage({ now: NOW + 60_000, fetcher: fakeRender(seen) });
    expect(seen.length).toBe(calls);
  });

  it('asks for the key when there is none, and still shows this machine', async () => {
    delete process.env.RENDER_API_KEY;
    const r = await renderUsage({ now: NOW, fetcher: fakeRender() });
    expect(r.reports).toBe('needs-key');
    expect(r.message).toContain('RENDER_API_KEY');
    expect(r.local.memory.used).toBeGreaterThan(0);
    expect(renderCheck()).toMatchObject({ status: 'off' });
  });

  it('says plainly when Render refuses the key', async () => {
    const r = await renderUsage({ now: NOW, fetcher: (async () => new Response('{}', { status: 401 })) });
    expect(r).toMatchObject({ reports: 'error', message: expect.stringContaining('refused the key') });
  });
});

describe('this machine', () => {
  it('reads memory, CPU and disk with their limits', () => {
    const l = localUsage();
    expect(l.memory).toMatchObject({ unit: 'MB', level: expect.stringMatching(/low|medium|high/) });
    expect(l.memory.limit).toBeGreaterThan(0);
    expect(l.cpu.limit).toBeGreaterThan(0);
    expect(l.disk?.limit).toBeGreaterThan(0);
  });
});
