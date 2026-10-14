import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ calendar: vi.fn(), asana: vi.fn(), projects: vi.fn(), gmail: vi.fn(), write: vi.fn() }));
vi.mock('./gcal.js', () => ({ refreshCalendar: calls.calendar }));
vi.mock('./asana.js', () => ({ asanaConfigured: true, openTasks: calls.asana, projects: calls.projects }));
vi.mock('./gmail-inbox.js', () => ({ inboxConfigured: true, fetchInbox: calls.gmail }));
vi.mock('./gwrite.js', () => ({ sendPendingToGoogle: calls.write }));
vi.mock('./store.js', () => ({ audit: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  for (const fn of Object.values(calls)) fn.mockReset().mockResolvedValue(undefined);
});

describe('refreshing everything', () => {
  it('re-reads every source, forcing past their caches', async () => {
    const { syncAll } = await import('./sync');
    const result = await syncAll();
    expect(result.problems).toEqual([]);
    expect(calls.calendar).toHaveBeenCalledWith(true);
    expect(calls.asana).toHaveBeenCalledWith(true);
    expect(calls.projects).toHaveBeenCalledWith(true);
    expect(calls.gmail).toHaveBeenCalledWith({ refresh: true });
    expect(calls.write).toHaveBeenCalledTimes(1);
  });

  it('lets the other sources finish when one fails, and says which failed', async () => {
    calls.asana.mockRejectedValue(new Error('Asana did not accept the token.'));
    const { syncAll } = await import('./sync');
    const result = await syncAll();
    expect(result.problems).toEqual(['Asana: Asana did not accept the token.']);
    expect(calls.gmail).toHaveBeenCalled();
    expect(calls.calendar).toHaveBeenCalled();
  });

  it('does the work once when asked twice at the same time or right after', async () => {
    const { syncAll, lastSyncAt } = await import('./sync');
    const [a, b] = await Promise.all([syncAll(), syncAll()]);
    await syncAll();
    expect(a).toBe(b);
    expect(calls.calendar).toHaveBeenCalledTimes(1);
    expect(lastSyncAt()).toBe(a.at);
  });

  it('runs again every few hours in the background', async () => {
    vi.useFakeTimers();
    const { startBackgroundSync } = await import('./sync');
    startBackgroundSync();
    await vi.advanceTimersByTimeAsync(3_000); // the first refresh, shortly after start-up
    expect(calls.calendar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3 * 3_600_000);
    expect(calls.calendar).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3 * 3_600_000);
    expect(calls.calendar).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
