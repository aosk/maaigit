import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import { randomBytes } from 'node:crypto';
import express from 'express';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import { api } from './routes/index.js';
import { pinGuard, phoneSetup } from './phone.js';
import { startScheduler } from './notify.js';
import { feedRoutes } from './feed.js';
import { startGoogleWrite } from './gwrite.js';
import { startBackgroundSync, syncAll } from './sync.js';
import { startLiveCalendar } from './livecal.js';
import { briefing } from './ai/briefing.js';
import { createGuard } from './auth.js';

const phoneMode = process.argv.includes('--phone') || process.env.MAAI_PHONE === '1';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);

if (config.production) {
  const dist = path.resolve('dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error('\n  The app has not been built. Use "npm start", or run "npm run build" before "npm run serve".\n');
    process.exit(1);
  }
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.use(feedRoutes);
  // One process, one port: Vite serves the app with hot reload, Express serves /api.
  // Live reload is off in phone mode: the phone can't reach Vite's reload socket over HTTPS.
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: !phoneMode }, appType: 'spa' });
  app.use(vite.middlewares);
}

// The briefing notification is written from freshly read calendars, Asana and mail.
startScheduler(async (lang) => {
  await syncAll();
  return (await briefing(lang)).text;
});
startGoogleWrite();
startBackgroundSync();
startLiveCalendar();

const ai = process.env.ANTHROPIC_API_KEY ? 'Claude connected' : 'demo mode (no ANTHROPIC_API_KEY in .env)';

if (config.production) {
  // Online: reachable by anyone, so everything behind the password.
  if (config.password.length < 8) {
    console.error('\n  MAAI_PASSWORD must be set to at least 8 characters before MAAI can run online.');
    console.error('  On Render: your service → Environment → Add Environment Variable → MAAI_PASSWORD.\n');
    process.exit(1);
  }
  const secretFile = path.join(config.dataDir, 'session-secret');
  if (!fs.existsSync(secretFile)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(secretFile, randomBytes(32).toString('hex'));
  }
  const site = express();
  // The hosting service checks this to know MAAI is up; it reveals nothing.
  site.get('/api/health', (_req, res) => res.json({ ok: true }));
  // Calendar apps can't sign in; their link is a long random key (see feed.ts).
  site.use(feedRoutes);
  site.use(express.json({ limit: '1mb' }));
  site.use(createGuard('password', config.password, fs.readFileSync(secretFile, 'utf8').trim()));
  site.use(app);
  site.listen(config.port, '0.0.0.0', () => console.log(`MAAI is online on port ${config.port} [${ai}]`));
} else {
  // The computer itself: no sign-in, and only reachable from this computer.
  app.listen(config.port, '127.0.0.1', () => {
    console.log(`\n  MAAI is running: http://localhost:${config.port}   [${ai}]`);
    console.log(`  Admin portal:    http://localhost:${config.port}/#/admin\n`);
  });
}

if (phoneMode && !config.production) {
  const { pin, key, cert, ips } = await phoneSetup();
  const phone = express();
  phone.use(express.json({ limit: '1mb' }));
  // The public certificate, so the phone can trust it; it holds no secret.
  phone.get('/maai-cert.crt', (_req, res) => {
    res.attachment('MAAI.crt').setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.send(Buffer.from(cert));
  });
  phone.use(pinGuard());
  phone.use(app);
  https.createServer({ key, cert }, phone).listen(config.phonePort, '0.0.0.0', () => {
    if (ips.length === 0) {
      console.log('  Phone access: no Wi-Fi or network connection found on this computer.\n');
      return;
    }
    const url = `https://${ips[0]}:${config.phonePort}`;
    console.log('  ── Open MAAI on your phone ──────────────────────────────');
    console.log('  1. Connect the phone to the same Wi-Fi as this computer.');
    console.log('  2. Scan this code with the phone camera, or type the address:\n');
    qrcode.generate(url, { small: true }, (code) => console.log(code.replace(/^/gm, '     ')));
    console.log(`     ${url}`);
    for (const other of ips.slice(1)) console.log(`     (or https://${other}:${config.phonePort})`);
    console.log('\n  3. The phone warns the connection is not private: that is expected');
    console.log('     for a home server. Tap "Show Details" then "visit this website".');
    console.log(`  4. Enter this PIN:  ${pin}\n`);
  });
}
