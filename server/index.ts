import path from 'node:path';
import https from 'node:https';
import express from 'express';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import { api } from './routes.js';
import { phoneSetup, requirePin } from './phone.js';
import { startScheduler } from './notify.js';

const phoneMode = process.argv.includes('--phone') || process.env.MAAI_PHONE === '1';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api', api);

if (config.production) {
  const dist = path.resolve('dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  // One process, one port: Vite serves the app with hot reload, Express serves /api.
  // Live reload is off in phone mode: the phone can't reach Vite's reload socket over HTTPS.
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: !phoneMode }, appType: 'spa' });
  app.use(vite.middlewares);
}

startScheduler();

const ai = process.env.ANTHROPIC_API_KEY ? 'Claude connected' : 'demo mode (no ANTHROPIC_API_KEY in .env)';

// The computer itself: no PIN, and only reachable from this computer.
app.listen(config.port, '127.0.0.1', () => {
  console.log(`\n  MAAI is running: http://localhost:${config.port}   [${ai}]`);
  console.log(`  Admin portal:    http://localhost:${config.port}/#/admin\n`);
});

if (phoneMode) {
  const { pin, key, cert, ips } = await phoneSetup();
  const phone = express();
  phone.use(express.json({ limit: '1mb' }));
  // The public certificate, so the phone can trust it; it holds no secret.
  phone.get('/maai-cert.crt', (_req, res) => {
    res.attachment('MAAI.crt').setHeader('Content-Type', 'application/x-x509-ca-cert');
    res.send(Buffer.from(cert));
  });
  phone.use(requirePin);
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
