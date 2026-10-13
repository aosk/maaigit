import { Router } from 'express';
import { status } from '../status.js';
import { today } from './today.js';
import { assistant } from './chat.js';
import { inbox } from './inbox.js';
import { notify } from './notify.js';
import { admin } from './admin.js';
import { asana } from './asana.js';
import { calendar } from './calendar.js';
import { errorHandler } from './http.js';

/** Everything under /api, one file per area of the app. */
export const api = Router();

api.get('/status', (_req, res) => res.json({ ...status(), auth: res.locals.auth ?? 'none' }));
api.use(today, assistant, inbox, asana, calendar, notify, admin);
api.use(errorHandler);
