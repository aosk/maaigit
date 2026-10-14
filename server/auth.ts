import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * A sign-in gate for /api: a PIN for phones on the home Wi-Fi, a password when
 * MAAI is online. The page itself always loads, so it can show the sign-in screen.
 * Mount it with `app.use('/api', guard)`: the paths it sees are relative to /api.
 */
export type AuthKind = 'pin' | 'password';

const COOKIE = 'maai_session';
const YEAR = 60 * 60 * 24 * 365;

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Build the guard and mount it on the API itself: `app.use('/api', guard)`. It sits in front of
 * the very same route the API is mounted on, so a path can never reach the API without
 * passing it, whatever its capitalisation or shape. Everything not listed here is denied.
 */
export function createGuard(kind: AuthKind, passcode: string, secret: string, now: () => number = Date.now) {
  // The cookie holds a hash, never the passcode; changing the passcode signs everyone out.
  const hash = (value: string) => createHash('sha256').update(`${kind}:${value}:${secret}`).digest('hex');
  const session = hash(passcode);
  const wrong = kind === 'pin' ? 'Wrong PIN' : 'Wrong password';

  // Five wrong tries lock sign-in, and each further round of five locks it twice as long
  // (1 minute, 2, 4 … up to an hour), so a passcode can't be guessed by trying them all.
  let failures = 0;
  let rounds = 0;
  let lockedUntil = 0;

  return function guard(req: Request, res: Response, next: NextFunction) {
    if (req.path === '/unlock' && req.method === 'POST') {
      const wait = lockedUntil - now();
      if (wait > 0) {
        res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
        return res.status(429).json({ error: `Too many wrong tries. Try again in ${Math.ceil(wait / 60_000)} minute${wait > 60_000 ? 's' : ''}.` });
      }
      const given = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
      if (!sameText(hash(given), session)) {
        failures += 1;
        if (failures >= 5) {
          failures = 0;
          rounds += 1;
          lockedUntil = now() + Math.min(60 * 60_000, 60_000 * 2 ** (rounds - 1));
        }
        return res.status(401).json({ error: wrong, kind });
      }
      failures = 0;
      rounds = 0;
      res.setHeader('Set-Cookie', `${COOKIE}=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${YEAR}`);
      return res.status(204).end();
    }

    if (req.path === '/logout' && req.method === 'POST') {
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
