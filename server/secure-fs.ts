import fs from 'node:fs';
import path from 'node:path';

/**
 * Writes a file only its owner can read: the data store, the sign-in secret, the push keys, the
 * calendar link key. (Where file permissions mean nothing, such as Windows, this is harmless.)
 * Every file MAAI writes goes through here; a test checks that nothing else writes files.
 */
export function writePrivate(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, data, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600); // a file that already existed keeps its old permissions otherwise
  } catch {
    // not supported here; nothing to do
  }
}
