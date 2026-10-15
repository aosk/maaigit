import type { AsanaControl, AsanaProject, AsanaStatus, AsanaTask } from '../shared/types.js';

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

async function callFull<T>(method: string, path: string, body?: unknown): Promise<{ data: T; next_page?: { offset?: string } | null }> {
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
  return (await res.json()) as { data: T; next_page?: { offset?: string } | null };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await callFull<T>(method, path, body)).data;
}

/** Every page of a list (Asana sends at most 100 at a time), up to `max` items. */
async function callAll<T>(path: string, max = 500): Promise<T[]> {
  const out: T[] = [];
  let offset = '';
  do {
    const page = await callFull<T[]>('GET', `${path}${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`);
    out.push(...page.data);
    offset = page.next_page?.offset ?? '';
  } while (offset && out.length < max);
  return out.slice(0, max);
}

interface RawTask {
  gid: string;
  name: string;
  due_on: string | null;
  /** Set instead of due_on when the task has a due time. */
  due_at?: string | null;
  created_at?: string;
  notes?: string;
  permalink_url: string;
  projects?: { name: string }[];
}

const FIELDS = 'name,due_on,due_at,created_at,notes,permalink_url,projects.name';

/** Only an https address is kept as a link (never "javascript:" or the like). */
const webLink = (url: string | undefined) => (url && /^https:\/\/[\w.-]+\//.test(url) ? url : '');

const toTask = (t: RawTask): AsanaTask => ({
  gid: t.gid,
  name: t.name,
  dueOn: t.due_on ?? (t.due_at ? todayIso(new Date(t.due_at)) : undefined),
  notes: t.notes?.slice(0, 1500) || undefined,
  url: webLink(t.permalink_url),
  project: t.projects?.[0]?.name,
  createdAt: t.created_at,
});

/** Dated tasks soonest first, then the ones without a date, newest first (so a task just added is easy to find). */
export function sortTasks(tasks: AsanaTask[]): AsanaTask[] {
  return [...tasks].sort((a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

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
      me.workspaces.map((w) => callAll<RawTask>(`/tasks?assignee=me&workspace=${w.gid}&completed_since=now&limit=100&opt_fields=${FIELDS}`)),
    );
    const tasks = sortTasks(lists.flat().map(toTask));
    cache = { at: Date.now(), tasks };
    lastError = undefined;
    return tasks;
  } catch (error) {
    lastError = (error as Error).message;
    console.error('Asana: could not read your tasks:', lastError);
    if (cache) return cache.tasks;
    throw error;
  }
}

/** What MAAI can see in Asana right now, for the "Check Asana" button: who it is signed in as and how many tasks each workspace gives. */
export async function diagnose(): Promise<{ user: string; email?: string; workspaces: { name: string; open: number }[]; shown: number; cachedAt?: string; error?: string }> {
  const me = await call<{ name: string; email?: string; workspaces: { gid: string; name: string }[] }>('GET', '/users/me?opt_fields=name,email,workspaces.name');
  const workspaces = await Promise.all(
    me.workspaces.map(async (w) => ({ name: w.name, open: (await callAll<RawTask>(`/tasks?assignee=me&workspace=${w.gid}&completed_since=now&limit=100&opt_fields=gid`)).length })),
  );
  return { user: me.name, email: me.email, workspaces, shown: cache?.tasks.length ?? 0, cachedAt: cache ? new Date(cache.at).toISOString() : undefined, error: lastError };
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

// ---------- Projects, status and new tasks ----------

let workspaceCache: string[] | null = null;
async function workspaces(): Promise<string[]> {
  workspaceCache ??= (await call<{ workspaces: { gid: string }[] }>('GET', '/users/me?opt_fields=workspaces')).workspaces.map((w) => w.gid);
  return workspaceCache;
}

let projectCache: { at: number; projects: AsanaProject[] } | null = null;

/** Your projects (for choosing where a new task goes), cached for 30 minutes. */
export async function projects(force = false): Promise<AsanaProject[]> {
  if (!asanaConfigured) return [];
  if (!force && projectCache && Date.now() - projectCache.at < 30 * 60_000) return projectCache.projects;
  const lists = await Promise.all((await workspaces()).map((w) => call<AsanaProject[]>('GET', `/projects?workspace=${w}&archived=false&limit=100&opt_fields=name`)));
  const all = lists.flat().sort((a, b) => a.name.localeCompare(b.name));
  projectCache = { at: Date.now(), projects: all };
  return all;
}

export const cachedProjects = (): AsanaProject[] => projectCache?.projects ?? [];

const GID = /^\d{3,30}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isGid = (value: unknown): value is string => typeof value === 'string' && GID.test(value);

interface NewTask {
  name: string;
  notes: string;
  dueOn: string;
  projectGid: string;
}

/** The new task as Asana will receive it, or a plain-words reason it can't be created. */
export function validateNewTask(input: Partial<Record<keyof NewTask, unknown>>): NewTask {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const task = { name: str(input.name, 500), notes: str(input.notes, 10_000), dueOn: str(input.dueOn, 10), projectGid: str(input.projectGid, 30) };
  if (!task.name) throw new AsanaError('The task needs a name.');
  if (task.dueOn && !DATE.test(task.dueOn)) throw new AsanaError('The due date must look like 2026-10-20.');
  if (task.projectGid && !GID.test(task.projectGid)) throw new AsanaError('That project is not valid.');
  return task;
}

/** Creates a task assigned to you, in a project if one is given. Returns it with its link. */
export async function createTask(input: NewTask): Promise<AsanaTask> {
  const where = input.projectGid ? { projects: [input.projectGid] } : { workspace: (await workspaces())[0] };
  const raw = await call<RawTask>('POST', `/tasks?opt_fields=${FIELDS}`, {
    name: input.name,
    assignee: 'me',
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.dueOn ? { due_on: input.dueOn } : {}),
    ...where,
  });
  cache = null;
  return toTask(raw);
}

export async function setCompleted(gid: string, done: boolean): Promise<void> {
  await call('PUT', `/tasks/${gid}`, { completed: done });
  cache = null;
}

export async function setDueOn(gid: string, dueOn: string): Promise<void> {
  if (dueOn && !DATE.test(dueOn)) throw new AsanaError('The due date must look like 2026-10-20.');
  await call('PUT', `/tasks/${gid}`, { due_on: dueOn || null });
  cache = null;
}

/** The ways to change this task's status: its column on each project's board, and its dropdown fields. */
export async function statusControls(gid: string): Promise<AsanaControl[]> {
  const raw = await call<{
    memberships?: { project?: { gid: string; name: string }; section?: { gid: string } }[];
    custom_fields?: { gid: string; name: string; resource_subtype: string; enum_options?: { gid: string; name: string; enabled?: boolean }[]; enum_value?: { gid: string } | null }[];
  }>(
    'GET',
    `/tasks/${gid}?opt_fields=memberships.project.name,memberships.section,custom_fields.name,custom_fields.resource_subtype,custom_fields.enum_options.name,custom_fields.enum_options.enabled,custom_fields.enum_value`,
  );
  const sections = await Promise.all(
    (raw.memberships ?? [])
      .filter((m) => m.project)
      .map(async (m): Promise<AsanaControl> => {
        const list = await call<{ gid: string; name: string }[]>('GET', `/projects/${m.project!.gid}/sections?opt_fields=name&limit=100`);
        return { type: 'section', label: m.project!.name, current: m.section?.gid, options: list.map((o) => ({ gid: o.gid, name: o.name })) };
      }),
  );
  const fields = (raw.custom_fields ?? [])
    .filter((f) => f.resource_subtype === 'enum' && f.enum_options?.length)
    .map((f): AsanaControl => ({
      type: 'field',
      label: f.name,
      fieldGid: f.gid,
      current: f.enum_value?.gid,
      options: f.enum_options!.filter((o) => o.enabled !== false).map((o) => ({ gid: o.gid, name: o.name })),
    }));
  return [...sections, ...fields].filter((c) => c.options.length > 0);
}

/** Moves the task to another column, or sets a dropdown field. */
export async function setStatus(gid: string, change: { type: 'section' | 'field'; optionGid: string; fieldGid?: string }): Promise<void> {
  if (change.type === 'section') await call('POST', `/sections/${change.optionGid}/addTask`, { task: gid });
  else await call('PUT', `/tasks/${gid}`, { custom_fields: { [change.fieldGid ?? '']: change.optionGid } });
  cache = null;
}
