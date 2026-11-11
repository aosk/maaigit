import path from 'node:path';

/**
 * What the local Vite server must never hand out, on top of its own defaults (.env, keys). It serves the whole
 * project root, and the data folder holds the store, the push private key and the calendar-feed token.
 */
export function devDeny(dataDir: string): string[] {
  const posix = (p: string) => p.split(path.sep).join('/');
  return [
    '.env', '.env.*', '**/.env*', '*.{crt,pem}', '**/.git/**', '**/.ssh/**', '**/.npmrc',
    `${posix(path.resolve(dataDir))}/**`, // where the data really is, even outside the project
    `${posix(path.resolve('data'))}/**`,
    '**/data*/**', // the default folder and the test copies next to it
  ];
}
