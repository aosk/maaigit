import { config } from './config.js';
import { refreshCalendar } from './gcal.js';
import { asanaConfigured, openTasks, projects } from './asana.js';
import { fetchInbox, inboxConfigured } from './gmail-inbox.js';
import { sendPendingToGoogle } from './gwrite.js';
import { audit } from './store.js';

/**
 * Refreshes everything MAAI reads from other places: calendars, Asana, Gmail, and the
 * meetings Google is still missing. Runs every few hours in the background (MAAI_SYNC_HOURS,
 * default 3) and whenever you pull down to refresh. Each source is separate: one failing
 * never stops the others.
 */

/** A second pull right after the first reuses its result, so a nervous thumb can't hammer Gmail. */
const REUSE_MS = 15_000;

export interface SyncResult {
  at: string;
  /** What failed, in plain words (empty when everything worked). */
  problems: string[];
}

let last: SyncResult | null = null;
let running: Promise<SyncResult> | null = null;

/** When everything was last refreshed. */
export const lastSyncAt = (): string | undefined => last?.at;

async function run(): Promise<SyncResult> {
  const steps: [string, () => Promise<unknown>][] = [
    ['Calendars', () => refreshCalendar(true)],
    ['Asana', () => (asanaConfigured ? Promise.all([openTasks(true), projects(true)]) : Promise.resolve())],
    ['Gmail', () => (inboxConfigured ? fetchInbox({ refresh: true }) : Promise.resolve())],
    ['Google Calendar writing', () => sendPendingToGoogle()],
  ];
  const results = await Promise.allSettled(steps.map(([, step]) => step()));
  const problems = results.flatMap((r, i) => (r.status === 'rejected' ? [`${steps[i][0]}: ${(r.reason as Error).message}`] : []));
  for (const problem of problems) console.error('Sync problem –', problem);
  last = { at: new Date().toISOString(), problems };
  return last;
}

/** Refreshes everything now (or returns the refresh that just finished or is still running). */
export function syncAll(): Promise<SyncResult> {
  if (running) return running;
  if (last && Date.now() - Date.parse(last.at) < REUSE_MS) return Promise.resolve(last);
  running = run().finally(() => {
    running = null;
  });
  return running;
}

/** Refreshes shortly after start-up, then every MAAI_SYNC_HOURS hours. */
export function startBackgroundSync() {
  const every = config.syncHours * 3_600_000;
  setTimeout(() => void syncAll(), 2_000);
  setInterval(() => {
    void syncAll().then((r) => audit(r.problems.length ? `Background refresh finished with problems: ${r.problems.join('; ')}` : 'Background refresh: calendars, Asana and Gmail', 'MAAI', r.problems.length ? 'error' : 'done'));
  }, every);
}
