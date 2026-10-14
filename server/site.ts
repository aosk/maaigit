import express from 'express';
import { createGuard } from './auth.js';
import { feedRoutes } from './feed.js';
import { api } from './routes/index.js';

/** An Express app set up the way every MAAI server should be. */
export function createApp(): express.Express {
  const app = express();
  // "/API/status" must not be treated as "/api/status": paths are matched exactly as written.
  app.set('case sensitive routing', true);
  app.disable('x-powered-by');
  return app;
}

/** The app itself: the JSON body reader and the API under /api (no sign-in; whoever mounts it adds that). */
export function createInnerApp(): express.Express {
  const app = createApp();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', api);
  return app;
}

/**
 * The server reachable from the internet: a health check and the calendar link first (neither
 * can carry a sign-in), then everything under /api behind the password, then the app itself.
 */
export function createOnlineSite(inner: express.Express, options: { password: string; secret: string }): express.Express {
  const site = createApp();
  // Render sits in front of the app; trust its forwarded address and protocol.
  site.set('trust proxy', 1);
  // The hosting service checks this to know MAAI is up; it reveals nothing.
  site.get('/api/health', (_req, res) => res.json({ ok: true }));
  // Calendar apps can't sign in; their link is a long random key (see feed.ts).
  site.use(feedRoutes);
  site.use(express.json({ limit: '1mb' }));
  site.use('/api', createGuard('password', options.password, options.secret));
  site.use(inner);
  return site;
}
