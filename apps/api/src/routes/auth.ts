import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors.js';
import { parse } from '../plugins/validate.js';
import { createSession, createUser, deleteSession, LoginThrottle, normaliseEmail, toPublicUser } from '../services/auth.js';
import { decoyHash, hashPassword, PASSWORD_MAX, PASSWORD_MIN, verifyPassword } from '../services/password.js';

const emailSchema = z.string().trim().min(3).max(254).email('Enter a valid email address');
const signupSchema = z.object({ email: emailSchema, password: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(PASSWORD_MAX) });
const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(PASSWORD_MAX) });

const invalid = (): AppError => new AppError(401, 'INVALID_CREDENTIALS', 'Wrong email or password');

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const throttle = new LoginThrottle();
  const open = { config: { public: true } } as const;
  void decoyHash(); // warm it so the first unknown-email login is not slower than later ones

  /** Tells the sign-in page whether to show "Sign in" or the one-time "Create your account". */
  app.get('/auth/status', open, async () => ({ hasUsers: (await app.db.user.count()) > 0 }));

  /** Floor is single-seller: signup works only until the first user exists. */
  app.post('/auth/signup', open, async (req, reply) => {
    const body = parse(signupSchema, req.body ?? {});
    if ((await app.db.user.count()) > 0) {
      throw new AppError(403, 'SIGNUP_CLOSED', 'An account already exists. Sign in instead.');
    }
    const passwordHash = await hashPassword(body.password);
    // The unique `slot` column makes a racing second signup fail here instead of creating a second account.
    const user = await createUser(app.db, body.email, passwordHash).catch((err: unknown) => {
      if ((err as { code?: string }).code === 'P2002') throw new AppError(403, 'SIGNUP_CLOSED', 'An account already exists. Sign in instead.');
      throw err;
    });
    const { token, expiresAt } = await createSession(app.db, user.id);
    return reply.code(201).send({ token, expiresAt: expiresAt.toISOString(), user: toPublicUser(user) });
  });

  app.post('/auth/login', open, async (req) => {
    const body = parse(loginSchema, req.body ?? {});
    const email = normaliseEmail(body.email);
    if (!throttle.tryAttempt(email)) {
      throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed sign-ins. Try again in 15 minutes.');
    }
    const user = await app.db.user.findUnique({ where: { email } });
    // Always run one scrypt verify so an unknown email takes as long as a wrong password.
    const ok = await verifyPassword(body.password, user?.passwordHash ?? (await decoyHash()));
    if (!user || !ok) throw invalid();
    throttle.clear(email);
    const { token, expiresAt } = await createSession(app.db, user.id);
    return { token, expiresAt: expiresAt.toISOString(), user: toPublicUser(user) };
  });

  app.get('/auth/me', async (req) => ({ user: req.user }));

  app.post('/auth/logout', async (req, reply) => {
    if (req.sessionToken) await deleteSession(app.db, req.sessionToken);
    return reply.code(204).send();
  });
}
