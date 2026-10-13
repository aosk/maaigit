import { Router } from 'express';
import type { AsanaOverview } from '../../shared/types.js';
import { asanaConfigured, openTasks, summarize } from '../asana.js';
import { wrap } from './http.js';

export const asana = Router();

/** The open tasks that matter now (overdue, then due today, then the next few), for Today. */
asana.get('/asana', wrap(async (_req, res) => {
  if (!asanaConfigured) return res.json({ configured: false, open: 0, overdue: 0, dueToday: 0, tasks: [] } satisfies AsanaOverview);
  const tasks = await openTasks().catch(() => []);
  const overview: AsanaOverview = { ...summarize(tasks), tasks: tasks.slice(0, 6) };
  res.json(overview);
}));
