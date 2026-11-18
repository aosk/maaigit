import { describe, expect, it } from 'vitest';
import { label, sections, show } from './monitorView';

describe('drawing whatever the monitoring site answers', () => {
  const answer = {
    totalRequests: 12840,
    error_rate: 0.0123456,
    healthy: true,
    lastDeploy: '2026-11-17T09:42:21.000Z',
    uptime: { percent: 99.95, incidents: 2, regions: { eu: 'ok', us: 'slow' } },
    daily: [
      { date: '2026-11-16', requests: 400, errors: 3, detail: { p95: 120 } },
      { date: '2026-11-17', requests: 512, errors: 0 },
    ],
    tags: ['api', 'web'],
    empty: [],
  };

  it('shows single values as tiles, lists of rows as tables and what is nested as its own section', () => {
    const out = sections(answer, 'Summary');
    expect(out.map((s) => s.title)).toEqual(['Summary', 'uptime', 'uptime · regions']);
    expect(out[0].tiles).toEqual([
      { name: 'total requests', value: '12,840' },
      { name: 'error rate', value: '0.01' },
      { name: 'healthy', value: '✓' },
      { name: 'last deploy', value: '2026-11-17 09:42' },
    ]);
    expect(out[0].tables).toEqual([
      { title: 'daily', columns: ['date', 'requests', 'errors'], rows: [['2026-11-16', '400', '3'], ['2026-11-17', '512', '0']], more: 0 },
      { title: 'tags', columns: [], rows: [['api'], ['web']], more: 0 },
    ]);
    expect(out[1].tiles).toEqual([{ name: 'percent', value: '99.95' }, { name: 'incidents', value: '2' }]);
    expect(out[2].tiles).toEqual([{ name: 'eu', value: 'ok' }, { name: 'us', value: 'slow' }]);
  });

  it('copes with an answer that is a list, a single value, or nothing', () => {
    expect(sections([{ a: 1 }, { a: 2 }], 'Summary')[0].tables[0]).toMatchObject({ columns: ['a'], rows: [['1'], ['2']] });
    expect(sections('all good', 'Summary')).toEqual([{ title: 'Summary', tiles: [{ name: '', value: 'all good' }], tables: [] }]);
    expect(sections({}, 'Summary')).toEqual([]);
    expect(sections([], 'Summary')).toEqual([]);
  });

  it('keeps long lists and wide rows within what a phone can show', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ a: i, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 }));
    const t = sections({ rows: many }, 'Summary')[0].tables[0];
    expect(t.rows.length).toBe(40);
    expect(t.more).toBe(60);
    expect(t.columns.length).toBe(6);
    expect(show('x'.repeat(200)).length).toBe(80);
    // very deep nesting is not followed for ever
    expect(sections({ a: { b: { c: { d: { e: { f: 1 } } } } } }, 'S').some((s) => s.tiles.some((x) => x.value === '{…}'))).toBe(true);
  });

  it('writes values plainly', () => {
    expect([show(null), show(''), show(false), show(1234567.891), show(Number.NaN), show([1, 2]), show([{ a: 1 }])]).toEqual(['—', '—', '✗', '1,234,567.89', '—', '1, 2', '(1)']);
    expect([label('errorRate'), label('error_rate'), label('p95.latency-ms')]).toEqual(['error rate', 'error rate', 'p95 latency ms']);
  });
});
