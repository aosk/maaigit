import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomInt } from 'node:crypto';
import { generate } from 'selfsigned';
import { createGuard } from './auth.js';
import { writePrivate } from './secure-fs.js';
import { config } from './config.js';

/**
 * Phone access: MAAI is served over HTTPS on the local network so an iPhone can
 * open it (browsers only allow the microphone and home-screen install on HTTPS).
 * Anyone on the same Wi-Fi could reach it, so it asks for a PIN first.
 */

const PHONE_FILE = path.join(config.dataDir, 'phone.json');
const CERT_VERSION = 2;

/** The computer's addresses on the local network, e.g. 192.168.1.20. */
function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => Boolean(a && a.family === 'IPv4' && !a.internal))
    .map((a) => a.address);
}

interface PhoneFile {
  pin: string;
  secret: string;
  cert?: { ips: string[]; key: string; cert: string; expires: string; v?: number };
}

function readFile(): PhoneFile {
  try {
    return JSON.parse(fs.readFileSync(PHONE_FILE, 'utf8')) as PhoneFile;
  } catch {
    return { pin: String(randomInt(0, 1_000_000)).padStart(6, '0'), secret: randomBytes(32).toString('hex') };
  }
}

function savePhoneFile(file: PhoneFile) {
  writePrivate(PHONE_FILE, JSON.stringify(file, null, 2));
}

/** A self-signed certificate for this computer's addresses, reused until they change or it nears expiry. */
export async function phoneSetup(): Promise<{ pin: string; key: string; cert: string; ips: string[] }> {
  const file = readFile();
  if (process.env.MAAI_PIN) file.pin = process.env.MAAI_PIN;
  const ips = lanAddresses();
  const stale =
    !file.cert ||
    file.cert.v !== CERT_VERSION ||
    file.cert.ips.join() !== ips.join() ||
    new Date(file.cert.expires).getTime() < Date.now() + 7 * 86_400_000;
  if (stale) {
    const expires = new Date(Date.now() + 365 * 86_400_000);
    const pems = await generate([{ name: 'commonName', value: 'MAAI' }], {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: expires,
      extensions: [
        // Marked as its own authority so an iPhone can fully trust it (needed for notifications).
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7 as const, ip }))],
        },
      ],
    });
    file.cert = { ips, key: pems.private, cert: pems.cert, expires: expires.toISOString(), v: CERT_VERSION };
  }
  savePhoneFile(file);
  return { pin: file.pin, key: file.cert!.key, cert: file.cert!.cert, ips };
}

/** The sign-in gate for the phone server. */
export function pinGuard() {
  const file = readFile();
  return createGuard('pin', file.pin, file.secret);
}
