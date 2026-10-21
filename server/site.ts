import express from 'express';
import { createGuard } from './auth.js';
import { feedRoutes } from './feed.js';
import { api } from './routes/index.js';
import { deviceApi } from './routes/bot.js';
import { whatsappWebhook } from './whatsapp.js';
import { passkeyLogin } from './passkeys.js';
import { config } from './config.js';
import { save, state } from './store.js';
import { failing, signal } from './signals.js';
import { bodyErrors, lastResort, noStore, sameOriginOnly, securityHeaders } from './security.js';

/** An Express app set up the way every MAAI server should be. */
export function createApp(): express.Express {
  const app = express();
  // "/API/status" must not be treated as "/api/status": paths are matched exactly as written.
  app.set('case sensitive routing', true);
  app.disable('x-powered-by');
  app.use(securityHeaders());
  return app;
}

/** The app itself: the JSON body reader and the API under /api (no sign-in; whoever mounts it adds that). */
export function createInnerApp(): express.Express {
  const app = createApp();
  app.use(express.json({ limit: '1mb' }));
  // The user's device bot signs in with its own key, not the password (see routes/bot.ts).
  app.use('/bot/v1', noStore, deviceApi);
  app.use('/api', noStore, api);
  app.use(bodyErrors, lastResort);
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
  // The built app can run under a strict Content-Security-Policy; the browser is told to keep to HTTPS.
  site.use(securityHeaders({ csp: true, hsts: true }));
  // The hosting service checks this to know MAAI is up; it reveals nothing.
  // It reveals nothing beyond up or down; 503 when the data cannot be saved, so the host can restart MAAI.
  site.get('/api/health', (_req, res) => {
    const saving = signal('storage');
    res.status(failing(saving) ? 503 : 200).json({ ok: !failing(saving) });
  });
  // Calendar apps can't sign in; their link is a long random key (see feed.ts).
  site.use(feedRoutes);
  // Twilio cannot sign in either; every request to this one proves itself with Twilio's signature.
  site.use(whatsappWebhook);
  site.use(express.json({ limit: '1mb' }));
  const guard = createGuard('password', options.password, options.secret, Date.now, { lockActive: () => state.passkeys.length > 0, lockMinutes: config.lockMinutes, epoch: { get: () => state.sessionEpoch, bump: () => { state.sessionEpoch += 1; save(); } } });
  // Signing in with Face ID has to be reachable before there is a session; it proves itself with a signature.
  site.use('/api/passkey/login', noStore, passkeyLogin(guard.startSession));
  site.use('/api', sameOriginOnly, guard);
  site.use(inner);
  // The body reader runs here, before the sign-in, so its complaints need answering here too.
  site.use(bodyErrors, lastResort);
  return site;
}
