import type { AsanaStatus, AsanaTask } from '../shared/types.js';

/**
 * Asana through a Personal Access Token (Asana → profile picture → My Settings →
 * Apps → Developer apps → Personal access token). MAAI reads the tasks assigned to
 * you; anything that changes a task (a comment, marking it done, a new due date)
 * only happens after you approve a card.
 */

const TOKEN = process.env.ASANA_TOKEN?.trim();
export const asanaConfigured = Boolean(TOKEN);

const API = process.env.ASANA_API ?? 'https://app.asana.com/api/1.0';
const CACHE_MS = 5 * 60_000;

/** An Asana problem in plain words. */
export class AsanaError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!TOKEN) throw new AsanaError('Asana is not connected. Add ASANA_TOKEN on Render → Environment.');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify({ data: body }) : undefined,
  }).catch(() => {
    throw new AsanaError('Could not reach Asana. Check the internet connection and try again.');
  });
  if (res.status === 401) throw new AsanaError('Asana did not accept the token. Create a new personal access token and update ASANA_TOKEN.');
  if (res.status === 404) throw new AsanaError('Asana could not find that task.');
  if (res.status === 429) throw new AsanaError('Asana is busy. Try again in a minute.');
  if (!res.ok) {
    const message = ((await res.json().catch(() => ({}))) as { errors?: { message?: string }[] }).errors?.[0]?.message;
    throw new AsanaError(`Asana said: ${message ?? res.status}`);
  }
  return ((await res.json()) as { data: T }).data;
}

interface RawTask {
  gid: string;
  name: string;
  due_on: string | null;
  /** Set instead of due_on when the task has a due time. */
  due_at?: string | null;
  notes?: string;
  permalink_url: string;
  projects?: { name: string }[];
}

const FIELDS = 'name,due_on,due_at,notes,permalink_url,projects.name';

const toTask = (t: RawTask): AsanaTask => ({
  gid: t.gid,
  name: t.name,
  dueOn: t.due_on ?? (t.due_at ? todayIso(new Date(t.due_at)) : undefined),
  notes: t.notes?.slice(0, 1500) || undefined,
  url: t.permalink_url,
  project: t.projects?.[0]?.name,
});

let cache: { at: number; tasks: AsanaTask[] } | null = null;
let lastError: string | undefined;

/** Today as YYYY-MM-DD in the app's time zone (Asana due dates are plain dates). */
export function todayIso(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TZ }).format(now);
}

/** Your open tasks, due soonest first (undated last). Cached for 5 minutes. */
export async function openTasks(force = false): Promise<AsanaTask[]> {
  if (!asanaConfigured) return [];
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.tasks;
  try {
    const me = await call<{ workspaces: { gid: string }[] }>('GET', '/users/me?opt_fields=workspaces');
    const lists = await Promise.all(
      me.workspaces.map((w) => call<RawTask[]>('GET', `/tasks?assignee=me&workspace=${w.gid}&completed_since=now&limit=100&opt_fields=${FIELDS}`)),
    );
    const tasks = lists.flat().map(toTask).sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999'));
    cache = { at: Date.now(), tasks };
    lastError = undefined;
    return tasks;
  } catch (error) {
    lastError = (error as Error).message;
    if (cache) return cache.tasks;
    throw error;
  }
}

/** The tasks without calling Asana: what is already loaded (for the assistant's context). */
export const cachedTasks = (): AsanaTask[] => cache?.tasks ?? [];

export function summarize(tasks: AsanaTask[], today = todayIso()): AsanaStatus {
  return {
    configured: asanaConfigured,
    open: tasks.length,
    overdue: tasks.filter((t) => t.dueOn && t.dueOn < today).length,
    dueToday: tasks.filter((t) => t.dueOn === today).length,
    error: lastError,
  };
}

export const asanaStatus = (): AsanaStatus => summarize(cachedTasks());

/** One task with its latest comments, for the assistant to read. */
export async function getTask(gid: string): Promise<{ task: AsanaTask; comments: { by: string; at: string; text: string }[] }> {
  const [raw, stories] = await Promise.all([
    call<RawTask>('GET', `/tasks/${gid}?opt_fields=${FIELDS}`),
    call<{ type: string; text: string; created_at: string; created_by?: { name: string } }[]>('GET', `/tasks/${gid}/stories?opt_fields=type,text,created_at,created_by.name&limit=100`),
  ]);
  const comments = stories
    .filter((s) => s.type === 'comment')
    .slice(-8)
    .map((s) => ({ by: s.created_by?.name ?? 'Someone', at: s.created_at, text: s.text.slice(0, 1000) }));
  return { task: toTask(raw), comments };
}

/** What an approved card does to a task. Nothing is sent that the user did not approve. */
export async function updateTask(gid: string, change: { comment?: string; complete?: boolean; dueOn?: string }): Promise<void> {
  if (change.comment) await call('POST', `/tasks/${gid}/stories`, { text: change.comment });
  const fields: Record<string, unknown> = {};
  if (change.complete) fields.completed = true;
  if (change.dueOn) fields.due_on = change.dueOn;
  if (Object.keys(fields).length) await call('PUT', `/tasks/${gid}`, fields);
  cache = null;
}
