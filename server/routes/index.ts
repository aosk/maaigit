import { Router } from 'express';
import { status } from '../status.js';
import { today } from './today.js';
import { assistant } from './chat.js';
import { inbox } from './inbox.js';
import { notify } from './notify.js';
import { admin } from './admin.js';
import { asana } from './asana.js';
import { calendar } from './calendar.js';
import { sync } from './sync.js';
import { errorHandler } from './http.js';
import { passkeyManagement } from '../passkeys.js';
import { news } from './news.js';
import { uploads } from './uploads.js';

/** Everything under /api, one file per area of the app. */
export const api = Router();

// The app calls this while it is being used, so the Face ID lock counts that as activity.
api.post('/active', (_req, res) => res.status(204).end());
api.get('/status', (_req, res) => res.json({ ...status(), auth: res.locals.auth ?? 'none' }));
api.use(today, assistant, inbox, asana, calendar, sync, notify, admin, passkeyManagement, news, uploads);
// Anything under /api that no route answered.
api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
api.use(errorHandler);
