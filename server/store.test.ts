import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const dirs: string[] = [];
const freshDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maai-store-'));
  dirs.push(dir);
  return dir;
};

/** The store as the server loads it, on a data file of the test's choosing. */
async function loadStore(file: string) {
  vi.resetModules();
  vi.stubEnv('MAAI_DATA_FILE', file);
  vi.stubEnv('MAAI_DATA_DIR', path.dirname(file));
  vi.stubEnv('GOOGLE_CALENDAR_ICS_URL', '');
  return import('./store');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('keeping your data safe', () => {
  it('starts with sample data on a first run, and makes no fuss about it', async () => {
    const dir = freshDir();
    const { state } = await loadStore(path.join(dir, 'store.json'));
    expect(state.events.length).toBeGreaterThan(0);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('keeps a copy of a damaged file before starting fresh, so nothing is lost for good', async () => {
    const dir = freshDir();
    const file = path.join(dir, 'store.json');
    const damaged = '{"events":[{"id":"1","title":"My real meeting"';
    fs.writeFileSync(file, damaged);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { state, save, flushSave } = await loadStore(file);
    expect(state.events.some((e) => e.title === 'My real meeting')).toBe(false);
    save();
    flushSave(); // overwrites the live file, as the next save would
    const kept = fs.readdirSync(dir).filter((name) => name.startsWith('store.json.damaged-'));
    expect(kept).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, kept[0]), 'utf8')).toBe(damaged);
  });

  it('saves and loads back exactly what was there', async () => {
    const dir = freshDir();
    const file = path.join(dir, 'store.json');
    const first = await loadStore(file);
    first.state.reminders.push({ id: 'r9', title: 'Call mum', when: 'Today', repeat: 'once', done: false });
    first.save();
    first.flushSave();
    const second = await loadStore(file);
    expect(second.state.reminders.find((r) => r.id === 'r9')?.title).toBe('Call mum');
  });

  it('writes pending changes straight away when told to stop, instead of up to half a second later', async () => {
    vi.useFakeTimers();
    const dir = freshDir();
    const file = path.join(dir, 'store.json');
    const { state, save, flushSave } = await loadStore(file);
    state.drafts = 42;
    save();
    expect(fs.existsSync(file)).toBe(false); // still waiting its turn
    flushSave();
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).drafts).toBe(42);
    vi.advanceTimersByTime(1_000); // the timer that was waiting must not write again or fail
  });

  it('leaves no half-written or temporary files behind', async () => {
    const dir = freshDir();
    const file = path.join(dir, 'store.json');
    const { save, flushSave } = await loadStore(file);
    for (let i = 0; i < 5; i++) {
      save();
      flushSave();
    }
    expect(fs.readdirSync(dir)).toEqual(['store.json']);
    expect(() => JSON.parse(fs.readFileSync(file, 'utf8'))).not.toThrow();
  });

  it('gives settings added in newer versions their defaults when loading an older file', async () => {
    const dir = freshDir();
    const file = path.join(dir, 'store.json');
    fs.writeFileSync(file, JSON.stringify({ notifyPrefs: { reminders: false, leave: true, events: false, eventMinutes: 5, prayers: false, prayerMinutes: 10 } }));
    const { state } = await loadStore(file);
    expect(state.notifyPrefs).toMatchObject({ reminders: false, eventMinutes: 5, briefing: false, briefingTime: '07:00' });
  });

  it('marks the first-run sample events saved by an older version, and only those', async () => {
    const dir = freshDir();
    const file = path.join(dir, 'store.json');
    fs.writeFileSync(file, JSON.stringify({ events: [{ id: 'a', title: 'Team stand-up', start: '2026-10-14T06:00:00.000Z', minutes: 15, place: 'Microsoft Teams' }, { id: 'b', title: 'Team stand-up', start: '2026-10-14T06:00:00.000Z', minutes: 15, place: 'My own office' }] }));
    const { state } = await loadStore(file);
    expect(state.events.map((e) => e.demo ?? false)).toEqual([true, false]);
  });
});
