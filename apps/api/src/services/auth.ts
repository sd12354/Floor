import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/client.js';
import type { User } from '../generated/prisma/client.js';
import { id as newId } from './audit.js';

export const SESSION_TTL_MS = 30 * 24 * 3600_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_FAILURES = 5;

export const normaliseEmail = (email: string): string => email.trim().toLowerCase();
const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface PublicUser {
  id: string;
  email: string;
}
export const toPublicUser = (u: Pick<User, 'id' | 'email'>): PublicUser => ({ id: u.id, email: u.email });

/** Create a session and return the raw bearer token (only its hash is stored). */
export async function createSession(db: Db, userId: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  return { token, expiresAt };
}

export async function userForToken(db: Db, token: string, now = new Date()): Promise<User | null> {
  const session = await db.session.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= now.getTime()) {
    await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.session.deleteMany({ where: { id: hashToken(token) } });
}

export async function createUser(db: Db, email: string, passwordHash: string): Promise<User> {
  return db.user.create({ data: { id: newId('usr'), email: normaliseEmail(email), passwordHash } });
}

/** In-memory brute-force brake: 5 failed sign-ins per email per 15 minutes. Resets on restart, which is fine for one seller. */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  blocked(email: string, now = Date.now()): boolean {
    const f = this.failures.get(email);
    if (!f) return false;
    if (f.resetAt <= now) {
      this.failures.delete(email);
      return false;
    }
    return f.count >= LOGIN_MAX_FAILURES;
  }

  fail(email: string, now = Date.now()): void {
    const f = this.failures.get(email);
    if (!f || f.resetAt <= now) this.failures.set(email, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    else f.count += 1;
  }

  clear(email: string): void {
    this.failures.delete(email);
  }
}
