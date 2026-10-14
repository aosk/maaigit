import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express, Router } from 'express';

/** Starts an Express app on a free port; returns its address and a way to stop it. */
export async function listen(app: Express): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

export interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: () => unknown;
}

/** A request sent exactly as written: no tidying of "//", "/./" or "%61" on the way (fetch would tidy them). */
export function raw(port: number, method: string, path: string, options: { headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(options.body ? { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(options.body)) } : {}), ...options.headers } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

/** Every route an Express router answers, with sample values filled in for the :params. */
export function listRoutes(router: Router): { method: string; path: string }[] {
  type Layer = { route?: { path: string; methods: Record<string, boolean> }; name?: string; handle?: { stack?: Layer[] } };
  const walk = (stack: Layer[]): { method: string; path: string }[] =>
    stack.flatMap((layer) => {
      if (layer.route) {
        const path = layer.route.path.replace(/:(\w+)/g, (_m, name: string) => (name === 'gid' ? '1209876543210' : name === 'id' ? 'abcd1234' : 'x'));
        return Object.keys(layer.route.methods).map((method) => ({ method: method.toUpperCase(), path }));
      }
      return layer.name === 'router' && layer.handle?.stack ? walk(layer.handle.stack) : [];
    });
  return walk((router as unknown as { stack: Layer[] }).stack);
}
