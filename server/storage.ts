import fs from 'node:fs';

/**
 * Whether the folder MAAI saves its data in is on a disk that survives updates.
 * On Render everything in the app's own folder is erased at every deploy; only a mounted disk is kept. A mounted disk is a
 * different device from the container's own root, so the same device number means the data is about to be lost.
 */
export function dataIsPersistent(dir: string, stat: (path: string) => { dev: number } = fs.statSync): boolean {
  try {
    return stat(dir).dev !== stat('/').dev;
  } catch {
    return false;
  }
}
