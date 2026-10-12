import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { generate } from 'selfsigned';

/**
 * Phone access: MAAI is served over HTTPS on the local network so an iPhone can
 * open it (browsers only allow the microphone and home-screen install on HTTPS).
 * Anyone on the same Wi-Fi could reach it, so it asks for a PIN first.
 */

const DATA_DIR = path.resolve('data');
const PHONE_FILE = path.join(DATA_DIR, 'phone.json');
const COOKIE = 'maai_phone';

/** The computer's addresses on the local network, e.g. 192.168.1.20. */
export function lanAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a): a is os.NetworkInterfaceInfo => Boolean(a && a.family === 'IPv4' && !a.internal))
    .map((a) => a.address);
}

interface PhoneFile {
  pin: string;
  secret: string;
  cert?: { ips: string[]; key: string; cert: string; expires: string };
}

function readFile(): PhoneFile {
  try {
    return JSON.parse(fs.readFileSync(PHONE_FILE, 'utf8')) as PhoneFile;
  } catch {
    return { pin: String(randomInt(0, 1_000_000)).padStart(6, '0'), secret: randomBytes(32).toString('hex') };
  }
}

function writeFile(file: PhoneFile) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(PHONE_FILE, JSON.stringify(file, null, 2));
}

/** A self-signed certificate for this computer's addresses, reused until they change or it nears expiry. */
export async function phoneSetup(): Promise<{ pin: string; key: string; cert: string; ips: string[] }> {
  const file = readFile();
  if (process.env.MAAI_PIN) file.pin = process.env.MAAI_PIN;
  const ips = lanAddresses();
  const stale =
    !file.cert ||
    file.cert.ips.join() !== ips.join() ||
    new Date(file.cert.expires).getTime() < Date.now() + 7 * 86_400_000;
  if (stale) {
    const expires = new Date(Date.now() + 365 * 86_400_000);
    const pems = await generate([{ name: 'commonName', value: 'MAAI' }], {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: expires,
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map((ip) => ({ type: 7 as const, ip }))],
        },
      ],
    });
    file.cert = { ips, key: pems.private, cert: pems.cert, expires: expires.toISOString() };
  }
  writeFile(file);
  pinToken = token(file.pin, file.secret);
  return { pin: file.pin, key: file.cert!.key, cert: file.cert!.cert, ips };
}

let pinToken = '';
const token = (pin: string, secret: string) => createHash('sha256').update(`${pin}:${secret}`).digest('hex');

function cookieValue(req: Request): string {
  const match = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`));
  return match?.[1] ?? '';
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Five wrong PINs lock unlocking for a minute, so a 6-digit PIN can't be guessed by trying them all.
let failures = 0;
let lockedUntil = 0;

/** Guards every /api request on the phone server; the page itself loads so it can show the PIN screen. */
export function requirePin(req: Request, res: Response, next: NextFunction) {
  if (!req.path.startsWith('/api')) return next();

  if (req.path === '/api/unlock' && req.method === 'POST') {
    if (Date.now() < lockedUntil) {
      return res.status(429).json({ error: 'Too many wrong PINs. Wait a minute and try again.' });
    }
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!sameToken(token(pin, readFile().secret), pinToken)) {
      failures += 1;
      if (failures >= 5) {
        failures = 0;
        lockedUntil = Date.now() + 60_000;
      }
      return res.status(401).json({ error: 'Wrong PIN' });
    }
    failures = 0;
    res.setHeader('Set-Cookie', `${COOKIE}=${pinToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${60 * 60 * 24 * 365}`);
    return res.status(204).end();
  }

  if (sameToken(cookieValue(req), pinToken)) return next();
  res.status(401).json({ error: 'locked' });
}
