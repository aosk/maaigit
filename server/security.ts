import type { ErrorRequestHandler, RequestHandler } from 'express';

/**
 * Browser-side protections, sent with every response. Apart from the Content-Security-Policy
 * (which only suits the built app) they are harmless anywhere.
 */

/** What the page may load: only itself, plus Google Fonts for the typeface. No inline scripts, no framing. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(options: { csp?: boolean; hsts?: boolean } = {}): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // Links that carry a secret (the calendar address) must never leak in a Referer header.
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), payment=(), usb=(), microphone=(self)');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (options.csp) res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    if (options.hsts) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  };
}

/** Answers from the API are private: never kept by a browser or a proxy. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};

/** A request whose body could not be read, answered plainly (and never with a stack trace). */
export const bodyErrors: ErrorRequestHandler = (error: { type?: string; status?: number }, _req, res, next) => {
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'That is too much to send.' });
  if (error.type === 'entity.parse.failed' || error.type === 'encoding.unsupported' || error.type === 'charset.unsupported') {
    return res.status(400).json({ error: 'The request could not be read.' });
  }
  next(error);
};

/** The last stop for anything unexpected: say so briefly, keep the details in the server log. */
export const lastResort: ErrorRequestHandler = (error: { status?: unknown }, _req, res, _next) => {
  if (res.headersSent) return res.end();
  // A request Express itself refused (such as an address that is not valid text) is the sender's mistake.
  if (typeof error.status === 'number' && error.status >= 400 && error.status < 500) return res.status(error.status).json({ error: 'The request could not be read.' });
  console.error('Unexpected error:', error);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
};
