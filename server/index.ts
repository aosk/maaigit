import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { api } from './routes.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);

if (config.production) {
  const dist = path.resolve('dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  // One process, one port: Vite serves the app with hot reload, Express serves /api.
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(config.port, () => {
  const ai = process.env.ANTHROPIC_API_KEY ? 'Claude connected' : 'demo mode (no ANTHROPIC_API_KEY in .env)';
  console.log(`\n  MAAI is running: http://localhost:${config.port}   [${ai}]`);
  console.log(`  Admin portal:    http://localhost:${config.port}/#/admin\n`);
});
