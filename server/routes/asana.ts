import { Router } from 'express';
import type { AsanaOverview } from '../../shared/types.js';
import { asanaConfigured, cachedTasks, createTask, diagnose, isGid, openTasks, projects, setCompleted, setDueOn, setStatus, statusControls, summarize, validateNewTask } from '../asana.js';
import { audit } from '../store.js';
import { HttpError, text, wrap } from './http.js';

export const asana = Router();

/** A task id from the address, checked so nothing odd is passed on to Asana. */
function taskGid(value: string): string {
  if (!isGid(value)) throw new HttpError(400, 'That is not an Asana task.');
  return value;
}
const nameOf = (gid: string) => cachedTasks().find((t) => t.gid === gid)?.name ?? gid;

/** The open tasks (overdue first, then by date), for Today. The app shows the first few and lets you expand the rest. */
asana.get('/asana', wrap(async (_req, res) => {
  if (!asanaConfigured) return res.json({ configured: false, open: 0, overdue: 0, dueToday: 0, tasks: [] } satisfies AsanaOverview);
  const tasks = await openTasks().catch(() => []);
  const overview: AsanaOverview = { ...summarize(tasks), tasks: tasks.slice(0, 80) };
  res.json(overview);
}));

/** "Check Asana": what MAAI can see (who it is signed in as, how many tasks per workspace), or why it cannot. */
asana.get('/asana/check', wrap(async (_req, res) => {
  if (!asanaConfigured) throw new HttpError(400, 'Asana is not connected. Add ASANA_TOKEN on Render → Environment.');
  res.json(await diagnose());
}));

asana.get('/asana/projects', wrap(async (_req, res) => res.json(await projects().catch(() => []))));

// The buttons in the app: tapping one is the user's own action, so these apply straight away (and are logged).

asana.post('/asana/tasks', wrap(async (req, res) => {
  const task = await createTask(validateNewTask(req.body));
  audit(`Created Asana task: ${task.name}`, 'User', 'done');
  res.status(201).json(task);
}));

asana.post('/asana/tasks/:gid/complete', wrap(async (req, res) => {
  const gid = taskGid(req.params.gid);
  const done = req.body.done !== false;
  const name = nameOf(gid);
  await setCompleted(gid, done);
  audit(`${done ? 'Completed' : 'Reopened'} Asana task: ${name}`, 'User', 'done');
  res.status(204).end();
}));

asana.post('/asana/tasks/:gid/due', wrap(async (req, res) => {
  const gid = taskGid(req.params.gid);
  const dueOn = text(req.body.dueOn, 10);
  await setDueOn(gid, dueOn);
  audit(`${dueOn ? `Moved Asana task due date to ${dueOn}` : 'Cleared the due date of Asana task'}: ${nameOf(gid)}`, 'User', 'done');
  res.status(204).end();
}));

asana.get('/asana/tasks/:gid/controls', wrap(async (req, res) => res.json(await statusControls(taskGid(req.params.gid)))));

asana.post('/asana/tasks/:gid/status', wrap(async (req, res) => {
  const gid = taskGid(req.params.gid);
  const type = req.body.type === 'field' ? 'field' : 'section';
  const optionGid = text(req.body.optionGid, 30);
  const fieldGid = text(req.body.fieldGid, 30);
  if (!isGid(optionGid) || (type === 'field' && !isGid(fieldGid))) throw new HttpError(400, 'Pick a status from the list.');
  await setStatus(gid, { type, optionGid, fieldGid });
  audit(`Changed the status of Asana task: ${nameOf(gid)}`, 'User', 'done');
  res.status(204).end();
}));
