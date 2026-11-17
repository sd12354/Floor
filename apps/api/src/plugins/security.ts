import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Headers for a dashboard that serves its own JS and loads product images and the two Google font hosts.
 * script-src stays 'self': the production bundle has no inline scripts.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ');

export const securityPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('x-dns-prefetch-control', 'off');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
    reply.header('x-request-id', req.id);
    if (app.config.webOrigin.startsWith('https://')) {
      reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
    }
  });
}, { name: 'security' });
