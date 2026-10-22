import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors.js';
import { toPublicUser, userForToken, type PublicUser } from '../services/auth.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Set on the few routes that must work before sign-in (status, signup, login). */
    public?: boolean;
  }
  interface FastifyRequest {
    user: PublicUser | null;
    /** The raw bearer token of this request, if one was sent. */
    sessionToken: string | null;
  }
}

export function bearerToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  const m = raw ? /^Bearer\s+(\S+)$/i.exec(raw.trim()) : null;
  return m?.[1] ?? null;
}

/** Requires `Authorization: Bearer <session token>` on every route in this scope unless the route sets `config.public`. */
export const authGuard = fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);
  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS' || req.routeOptions.config.public) return;
    const token = bearerToken(req.headers.authorization);
    const user = token ? await userForToken(app.db, token) : null;
    if (!token || !user) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    req.user = toPublicUser(user);
    req.sessionToken = token;
  });
}, { name: 'auth-guard', dependencies: ['prisma'] });
