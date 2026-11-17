import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Client routes (no file extension) fall through to the dashboard. Missing hashed assets stay 404. */
export function isSpaRoute(method: string, url: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  const pathname = url.split('?')[0] ?? '';
  if (pathname.startsWith('/api') || pathname === '/health') return false;
  const base = path.posix.basename(pathname);
  return !base.includes('.');
}

/** Resolve a URL path under `root`, or null when it escapes the directory. */
export function safePublicFile(root: string, urlPath: string): string | null {
  let pathname = urlPath.split('?')[0] ?? '/';
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const rootResolved = path.resolve(root);
  const full = path.resolve(rootResolved, `.${pathname}`);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;
  return full;
}

function cacheControl(filePath: string): string | undefined {
  if (filePath.includes(`${path.sep}assets${path.sep}`)) return 'public, max-age=31536000, immutable';
  if (filePath.endsWith('.html')) return 'no-cache';
  return undefined;
}

/**
 * Serves the built dashboard from WEB_DIST on the same origin as the API.
 * Hashed files under /assets are cached for a year; index.html is always revalidated.
 */
export const webPlugin = fp(async (app: FastifyInstance) => {
  const root = app.config.webDist;
  if (!root) return;
  if (!existsSync(root)) throw new Error(`WEB_DIST does not exist: ${root}`);

  app.route({
    method: ['GET', 'HEAD'],
    url: '/*',
    handler(req, reply) {
      const pathname = req.url.split('?')[0] ?? '/';
      if (pathname.startsWith('/api') || pathname === '/health') {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } });
      }

      const file = safePublicFile(root, pathname);
      if (file && existsSync(file) && statSync(file).isFile()) {
        const cache = cacheControl(file);
        if (cache) reply.header('cache-control', cache);
        const ext = path.extname(file).toLowerCase();
        return reply.type(MIME[ext] ?? 'application/octet-stream').send(createReadStream(file));
      }

      if (!isSpaRoute(req.method, req.url)) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` } });
      }
      return reply
        .type('text/html; charset=utf-8')
        .header('cache-control', 'no-cache')
        .send(createReadStream(path.join(root, 'index.html')));
    },
  });
}, { name: 'web', dependencies: ['errors'] });
