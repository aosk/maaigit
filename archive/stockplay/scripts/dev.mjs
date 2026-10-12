#!/usr/bin/env node
/** Runs the API and the Vite dev server together, and makes sure that killing
 *  one kills the other — a stray API process holding port 4000 is the usual
 *  reason a restart appears to hang. */
import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const npm = isWindows ? 'npm.cmd' : 'npm';

const children = [
  { name: 'api', args: ['run', 'dev', '--workspace=server'] },
  { name: 'web', args: ['run', 'dev', '--workspace=web'] },
].map(({ name, args }) => {
  // Node refuses to spawn a .cmd file directly on Windows (EINVAL), so it has
  // to go through the shell there. The arguments are fixed, so this is safe.
  const child = spawn(npm, args, { stdio: 'inherit', env: process.env, shell: isWindows });
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      console.error(`\n[dev] ${name} exited (${signal ?? code}); stopping the other process.`);
      shutdown(typeof code === 'number' ? code : 1);
    }
  });
  return child;
});

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
