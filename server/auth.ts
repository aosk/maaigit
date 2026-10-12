import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * A sign-in gate for /api: a PIN for phones on the home Wi-Fi, a password when
 * MAAI is online. The page itself always loads, so it can show the sign-in screen.
 */
export type AuthKind = 'pin' | 'password';

const COOKIE = 'maai_session';
const YEAR = 60 * 60 * 24 * 365;

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createGuard(kind: AuthKind, passcode: string, secret: string) {
  // The cookie holds a hash, never the passcode; changing the passcode signs everyone out.
  const hash = (value: string) => createHash('sha256').update(`${kind}:${value}:${secret}`).digest('hex');
  const session = hash(passcode);
  const wrong = kind === 'pin' ? 'Wrong PIN' : 'Wrong password';

  // Five wrong tries lock sign-in for a minute, so a code can't be guessed by trying them all.
  let failures = 0;
  let lockedUntil = 0;

  return function guard(req: Request, res: Response, next: NextFunction) {
    if (!req.path.startsWith('/api')) return next();

    if (req.path === '/api/unlock' && req.method === 'POST') {
      if (Date.now() < lockedUntil) return res.status(429).json({ error: 'Too many wrong tries. Wait a minute and try again.' });
      const given = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
      if (!sameText(hash(given), session)) {
        failures += 1;
        if (failures >= 5) {
          failures = 0;
          lockedUntil = Date.now() + 60_000;
        }
        return res.status(401).json({ error: wrong, kind });
      }
      failures = 0;
      res.setHeader('Set-Cookie', `${COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${YEAR}`);
      return res.status(204).end();
    }

    if (req.path === '/api/logout' && req.method === 'POST') {
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
      return res.status(204).end();
    }

    const cookie = (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`))?.[1] ?? '';
    if (sameText(cookie, session)) {
      res.locals.auth = kind;
      return next();
    }
    res.status(401).json({ error: 'locked', kind });
  };
}
