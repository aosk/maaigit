import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventBus } from './bus.js';
import { createApiRouter, type ApiContext } from './routes/api.js';
import type { AppState } from './store/state.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Locates the built web bundle. The module sits at a different depth when run
 * from source (`server/src`) than from the compiled output
 * (`server/dist/server/src`), so walk up until a `web/dist` turns up rather
 * than hard-coding a number of `..` segments that is wrong in one of the two.
 */
function findWebDist(): string | null {
  if (process.env.STOCKPLAY_WEB_DIST) {
    const explicit = resolve(process.env.STOCKPLAY_WEB_DIST);
    return existsSync(explicit) ? explicit : null;
  }
  let dir = HERE;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(dir, 'web/dist');
    if (existsSync(resolve(candidate, 'index.html'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export interface AppDeps {
  state: AppState;
  bus: EventBus;
  persist: () => void;
  onEngineChange: () => void;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, instruments: deps.state.instruments.length, clients: deps.bus.size });
  });

  app.use('/api', createApiRouter(deps satisfies ApiContext));

  // In a production build the web bundle is served from the same origin, so the
  // dashboard works without a separate dev server.
  const webDist = findWebDist();
  if (webDist) {
    app.use(express.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(webDist, 'index.html')));
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[stockplay]', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: err.message } });
  });

  return app;
}
