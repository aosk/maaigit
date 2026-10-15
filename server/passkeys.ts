import express, { Router, type Request, type Response } from 'express';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { audit, save, state } from './store.js';
import { HttpError, errorHandler, find, text, wrap } from './routes/http.js';

/**
 * Face ID (or a fingerprint) instead of typing the password. The phone keeps a private key behind
 * Face ID and MAAI keeps only the matching public key: signing in is the phone proving, with a fresh
 * signature over a one-time challenge, that it holds that key. Nothing here can be replayed or guessed.
 * The password still works, and setting up Face ID needs a signed-in session.
 */

const MAX_PASSKEYS = 5;
const CHALLENGE_MS = 5 * 60_000;

const bytes = (base64url: string) => new Uint8Array(Buffer.from(base64url, 'base64url'));
const base64url = (data: Uint8Array) => Buffer.from(data).toString('base64url');

/** Where the page is served from. The phone refuses to sign for any other address, so this cannot be talked into a mismatch. */
function origin(req: Request): string {
  const configured = process.env.MAAI_PUBLIC_URL?.trim();
  if (configured) return new URL(configured).origin;
  return `${req.protocol}://${req.get('host') ?? 'localhost'}`;
}
const rpID = (req: Request) => new URL(origin(req)).hostname;

// ---------- One-time challenges ----------

const challenges = new Map<string, { kind: 'register' | 'login'; expires: number }>();

function rememberChallenge(challenge: string, kind: 'register' | 'login', now = Date.now()) {
  for (const [key, value] of challenges) if (value.expires < now) challenges.delete(key);
  // A bounded list: nobody can fill the server's memory by asking for challenges. When it is full of challenges still
  // in use, ask for patience rather than throw out the oldest one (which may be the owner's).
  if (challenges.size >= 200) throw new HttpError(429, 'Too many tries. Wait a few minutes, or use the password.');
  challenges.set(challenge, { kind, expires: now + CHALLENGE_MS });
}

/** At most `max` calls from one address in `windowMs`. */
const hits = new Map<string, number[]>();
function limited(ip: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => t > now - windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [key, list] of hits) if (!list.some((t) => t > now - windowMs)) hits.delete(key);
  return recent.length > max;
}

/** Accepts a challenge once, and only for what it was made for. */
function takeChallenge(kind: 'register' | 'login', now = Date.now()) {
  return (challenge: string) => {
    const found = challenges.get(challenge);
    challenges.delete(challenge);
    return Boolean(found) && found!.kind === kind && found!.expires > now;
  };
}

// ---------- Failed sign-ins ----------

// Counted per address, so someone else's wrong guesses cannot shut the owner's Face ID.
const failures = new Map<string, number[]>();
function tooManyFailures(ip: string, now = Date.now()) {
  const recent = (failures.get(ip) ?? []).filter((t) => t > now - 10 * 60_000);
  failures.set(ip, recent);
  return recent.length >= 10;
}
const addFailure = (ip: string) => failures.set(ip, [...(failures.get(ip) ?? []), Date.now()]);

// ---------- Setting up (needs a signed-in session: these live under /api) ----------

export const passkeyManagement = Router();

passkeyManagement.get('/passkeys', (_req, res) =>
  res.json(state.passkeys.map(({ id, name, createdAt, lastUsedAt }) => ({ id, name, createdAt, lastUsedAt }))),
);

passkeyManagement.post('/passkeys/options', wrap(async (req, res) => {
  if (state.passkeys.length >= MAX_PASSKEYS) throw new HttpError(409, `You can keep up to ${MAX_PASSKEYS} Face ID devices. Remove one first.`);
  const options = await generateRegistrationOptions({
    rpName: 'MAAI',
    rpID: rpID(req),
    userName: 'owner',
    userDisplayName: 'MAAI owner',
    userID: new Uint8Array(Buffer.from('maai-owner')),
    attestationType: 'none',
    excludeCredentials: state.passkeys.map((p) => ({ id: p.id, transports: p.transports as never })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required', authenticatorAttachment: 'platform' },
  });
  rememberChallenge(options.challenge, 'register');
  res.json(options);
}));

passkeyManagement.post('/passkeys', wrap(async (req, res) => {
  if (state.passkeys.length >= MAX_PASSKEYS) throw new HttpError(409, `You can keep up to ${MAX_PASSKEYS} Face ID devices. Remove one first.`);
  const response = req.body?.response as RegistrationResponseJSON | undefined;
  if (!response || typeof response !== 'object') throw new HttpError(400, 'Face ID setup was not understood.');
  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: takeChallenge('register'),
      expectedOrigin: origin(req),
      expectedRPID: rpID(req),
      requireUserVerification: true,
    });
  } catch {
    throw new HttpError(400, 'Face ID could not be set up. Try again.');
  }
  if (!verified.verified) throw new HttpError(400, 'Face ID could not be set up. Try again.');
  const { credential } = verified.registrationInfo;
  if (state.passkeys.some((p) => p.id === credential.id)) throw new HttpError(409, 'This device already has Face ID set up.');
  state.passkeys.push({
    id: credential.id,
    publicKey: base64url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
    name: text(req.body?.name, 60) || 'This device',
    createdAt: new Date().toISOString(),
  });
  audit('Set up Face ID sign-in', 'User', 'approved');
  // Setting it up was an unlock: do not ask for Face ID again straight away.
  (res.locals.startFace as (() => void) | undefined)?.();
  res.status(201).json({ id: credential.id });
}));

passkeyManagement.delete('/passkeys/:id', (req, res) => {
  const key = find(state.passkeys, req.params.id);
  state.passkeys = state.passkeys.filter((p) => p !== key);
  audit(`Removed Face ID sign-in (${key.name})`, 'User', 'done');
  res.status(204).end();
});

// ---------- Signing in (before the password check: it is how someone without a session gets one) ----------

/** `startSession` gives the caller the same signed session cookie the password does. */
export function passkeyLogin(startSession: (res: Response) => void): Router {
  const router = Router();

  router.post('/options', wrap(async (req, res) => {
    if (!state.passkeys.length) throw new HttpError(404, 'Face ID is not set up.');
    if (limited(req.ip ?? '', 20, 60_000)) throw new HttpError(429, 'Too many tries. Wait a minute, or use the password.');
    const options = await generateAuthenticationOptions({
      rpID: rpID(req),
      userVerification: 'required',
      allowCredentials: state.passkeys.map((p) => ({ id: p.id, transports: p.transports as never })),
    });
    rememberChallenge(options.challenge, 'login');
    res.json(options);
  }));

  router.post('/', express.json({ limit: '20kb' }), wrap(async (req, res) => {
    if (limited(req.ip ?? '', 30, 60_000) || tooManyFailures(req.ip ?? '')) throw new HttpError(429, 'Too many tries. Wait a few minutes, or use the password.');
    const response = req.body?.response as AuthenticationResponseJSON | undefined;
    const key = typeof response?.id === 'string' ? state.passkeys.find((p) => p.id === response.id) : undefined;
    const fail = () => {
      addFailure(req.ip ?? '');
      return new HttpError(401, 'Face ID did not match. Use the password instead.');
    };
    if (!response || !key) throw fail();
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: takeChallenge('login'),
        expectedOrigin: origin(req),
        expectedRPID: rpID(req),
        credential: { id: key.id, publicKey: bytes(key.publicKey), counter: key.counter, transports: key.transports },
        requireUserVerification: true,
      });
    } catch {
      throw fail();
    }
    if (!verified.verified) throw fail();
    key.counter = verified.authenticationInfo.newCounter;
    key.lastUsedAt = new Date().toISOString();
    save();
    startSession(res);
    res.status(204).end();
  }));

  router.use(errorHandler);
  return router;
}

/** For tests: forget every waiting challenge and failure. */
export function resetPasskeyState() {
  challenges.clear();
  failures.clear();
  hits.clear();
}

