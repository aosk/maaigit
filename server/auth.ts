import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * A sign-in gate for /api: a PIN for phones on the home Wi-Fi, a password when
 * MAAI is online. The page itself always loads, so it can show the sign-in screen.
 * Mount it with `app.use('/api', guard)`: the paths it sees are relative to /api.
 */
type AuthKind = 'pin' | 'password';

const COOKIE = 'maai_session';
/** Proves the person unlocked MAAI recently (by Face ID or the password); only asked for once Face ID is set up. */
const FACE_COOKIE = 'maai_face';
/** Marks a device that unlocks with Face ID: only such a device locks itself when left alone. */
const FACE_DEVICE = 'maai_face_device';
const DAY = 24 * 60 * 60;
/** A session lasts 30 days, and is renewed on use once it has less than 15 days left. */
const SESSION_DAYS = 30;

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
interface GuardOptions {
  /** True when Face ID is set up: then a session also needs a recent unlock (see `lockMinutes`). */
  lockActive?: () => boolean;
  /** How long MAAI stays open without being used before it asks for Face ID again (read each time: the user can change it). */
  lockMinutes?: number | (() => number);
  /**
   * The sign-out counter. Every session is signed with its value, so raising it (Sign out) makes every session
   * issued before it stop working, even one that was copied. Kept between restarts by whoever builds the guard.
   */
  epoch?: { get: () => number; bump: () => void };
  /** Sessions signed out one by one (on one device), until they would have expired anyway. */
  revoked?: { has: (id: string) => boolean; add: (id: string, expires: number) => void };
}

export function createGuard(kind: AuthKind, passcode: string, secret: string, now: () => number = Date.now, options: GuardOptions = {}) {
  const hash = (value: string) => createHash('sha256').update(`${kind}:${value}:${secret}`).digest('hex');
  const wrong = kind === 'pin' ? 'Wrong PIN' : 'Wrong password';

  // The cookie is "expiry.signature": the signature covers the expiry and the passcode, so a
  // cookie can't be altered, expires by itself, and stops working when the passcode changes.
  // It never contains the passcode.
  const passcodeHash = hash(passcode);
  let localEpoch = 0;
  const epoch = options.epoch ?? { get: () => localEpoch, bump: () => void localEpoch++ };
  // Epoch 0 signs exactly as before, so sessions already issued stay valid until the first sign-out.
  const mark = () => (epoch.get() ? `|e${epoch.get()}` : '');
  // A random part makes every session its own, so one can be signed out alone. Sessions from before it had none.
  const sign = (expires: number, nonce = '') => createHmac('sha256', secret).update(`${kind}|${expires}|${passcodeHash}${mark()}${nonce ? `|${nonce}` : ''}`).digest('hex');
  const seconds = () => Math.floor(now() / 1000);
  const issue = () => {
    const expires = seconds() + SESSION_DAYS * DAY;
    const nonce = randomBytes(8).toString('hex');
    return `${COOKIE}=${expires}.${nonce}.${sign(expires, nonce)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * DAY}`;
  };
  /** The expiry (in seconds) of a good cookie value, or 0. */
  const revokedLocal = new Map<string, number>();
  const revoked = options.revoked ?? { has: (id: string) => revokedLocal.has(id), add: (id: string, expires: number) => void revokedLocal.set(id, expires) };
  /** A session's id for signing it out alone: a hash of its signature (the cookie itself is never kept). */
  const sessionId = (value: string) => createHash('sha256').update(value.split('.').at(-1) ?? '').digest('hex').slice(0, 32);
  const check = (value: string): number => {
    const parts = value.split('.');
    const [expiresText = '', nonce, signature = ''] = parts.length === 3 ? parts : [parts[0], '', parts[1]];
    const expires = /^\d{1,12}$/.test(expiresText) ? Number(expiresText) : 0;
    if (nonce && !/^[0-9a-f]{16}$/.test(nonce)) return 0;
    return expires > seconds() && expires <= seconds() + SESSION_DAYS * DAY && sameText(signature, sign(expires, nonce)) && !revoked.has(sessionId(value)) ? expires : 0;
  };

  // The "recent unlock" cookie works the same way but lasts only a few minutes of not being used.
  const lockSeconds = () => Math.max(60, Math.round((typeof options.lockMinutes === 'function' ? options.lockMinutes() : (options.lockMinutes ?? 30)) * 60));
  const signFace = (expires: number) => createHmac('sha256', secret).update(`face|${kind}|${expires}|${passcodeHash}${mark()}`).digest('hex');
  const issueFace = () => {
    const expires = seconds() + lockSeconds();
    return `${FACE_COOKIE}=${expires}.${signFace(expires)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${lockSeconds()}`;
  };
  const checkFace = (value: string): number => {
    const [expiresText = '', signature = ''] = value.split('.');
    const expires = /^\d{1,12}$/.test(expiresText) ? Number(expiresText) : 0;
    return expires > seconds() && expires <= seconds() + lockSeconds() && sameText(signature, signFace(expires)) ? expires : 0;
  };
  // A device that unlocks with Face ID carries this mark; only such a device locks when left alone. A computer
  // or phone without Face ID would otherwise ask for the full password every few minutes.
  const faceDevice = `${FACE_DEVICE}=1; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${400 * DAY}`;
  const usesFace = (req: Request) => new RegExp(`(?:^|;\\s*)${FACE_DEVICE}=1(?:;|$)`).test(req.headers.cookie ?? '');
  const cookieValue = (req: Request, name: string) => (req.headers.cookie ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([0-9a-f.]+)`))?.[1] ?? '';

  // Five wrong tries lock sign-in, and each further round of five locks it twice as long
  // (1 minute, 2, 4 … up to an hour), so a passcode can't be guessed by trying them all.
  let failures = 0;
  let rounds = 0;
  let lockedUntil = 0;

  function guard(req: Request, res: Response, next: NextFunction) {
    if (req.path === '/unlock' && req.method === 'POST') {
      const wait = lockedUntil - now();
      if (wait > 0) {
        res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
        return res.status(429).json({ error: `Too many wrong tries. Try again in ${Math.ceil(wait / 60_000)} minute${wait > 60_000 ? 's' : ''}.` });
      }
      const given = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
      if (!sameText(hash(given), passcodeHash)) {
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
      res.setHeader('Set-Cookie', [issue(), issueFace()]);
      return res.status(204).end();
    }

    if (req.path === '/logout' && req.method === 'POST') {
      const gone = (name: string) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
      // Signing out ends this device's session. "Everywhere" also ends every other session, even a copied one;
      // only a real session can do that, a stranger's request just clears their own cookies.
      const session = cookieValue(req, COOKIE);
      const expires = check(session);
      if (expires && req.body?.everywhere === true) epoch.bump();
      // This device's session stops working for good, even a copy of its cookie; other devices stay signed in.
      else if (expires) revoked.add(sessionId(session), expires);
      res.setHeader('Set-Cookie', [gone(COOKIE), gone(FACE_COOKIE)]);
      return res.status(204).end();
    }

    const expires = check(cookieValue(req, COOKIE));
    if (!expires) return res.status(401).json({ error: 'locked', kind });

    // Once Face ID is set up, being signed in is not enough: MAAI must also have been unlocked a few
    // minutes ago. Using the app keeps that going; leaving it for longer asks for Face ID again.
    if (options.lockActive?.() && usesFace(req)) {
      const face = checkFace(cookieValue(req, FACE_COOKIE));
      if (!face) return res.status(401).json({ error: 'locked', kind, face: true });
      // Only real use keeps it open: the app's own automatic refreshes (marked as background) do not,
      // or an app left open on a table would never lock.
      const background = req.get('x-maai-background') === '1';
      if (!background && face - seconds() < lockSeconds() / 2) res.append('Set-Cookie', issueFace());
    }
    // Using the app keeps you signed in: renew once half the time is gone.
    // A session from before sessions had their own id is swapped for one that has it.
    if (expires - seconds() < (SESSION_DAYS / 2) * DAY || cookieValue(req, COOKIE).split('.').length === 2) res.append('Set-Cookie', issue());
    res.locals.auth = kind;
    res.locals.startFace = () => res.append('Set-Cookie', [issueFace(), faceDevice]);
    next();
  }

  // Another way in (Face ID) gives out the very same session, and the "just unlocked" mark.
  return Object.assign(guard, { startSession: (res: Response) => void res.setHeader('Set-Cookie', [issue(), issueFace(), faceDevice]) });
}
