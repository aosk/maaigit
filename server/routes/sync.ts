import { Router } from 'express';
import { syncAll } from '../sync.js';
import { wrap } from './http.js';

export const sync = Router();

/** Pull down to refresh: re-reads calendars, Asana and Gmail now, and says what could not be read. */
sync.post('/sync', wrap(async (_req, res) => res.json(await syncAll())));
