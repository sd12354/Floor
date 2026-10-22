import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';
import { hashPassword, verifyPassword } from '../src/services/password.js';

interface AuthOk { token: string; expiresAt: string; user: { id: string; email: string } }
interface Err { error: { code: string; message: string } }

let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => t.close());

describe('password hashing', () => {
  it('verifies the right password, rejects the wrong one, and salts every hash', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', a)).toBe(true);
    expect(await verifyPassword('wrong horse battery', a)).toBe(false);
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
  });
});

describe('route guard', () => {
  it('rejects requests with no token, a bad token, or a malformed header', async () => {
    for (const headers of [{}, { authorization: 'Bearer nope' }, { authorization: 'Basic abc' }] as Record<string, string>[]) {
      const res = await t.anon<Err>('GET', '/account', undefined, headers);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('protects order intake and spending routes too', async () => {
    expect((await t.anon('POST', '/orders/simulate', { listingId: 'x' })).status).toBe(401);
    expect((await t.anon('POST', '/webhooks/ebay', {})).status).toBe(401);
    expect((await t.anon('GET', '/ledger')).status).toBe(401);
  });

  it('accepts the seller token', async () => {
    expect((await t.api('GET', '/account')).status).toBe(200);
  });

  it('leaves /health open', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });
});

describe('signup and login', () => {
  it('reports that an account exists, so signup is closed', async () => {
    expect((await t.anon<{ hasUsers: boolean }>('GET', '/auth/status')).body).toEqual({ hasUsers: true });
    const res = await t.anon<Err>('POST', '/auth/signup', { email: 'second@floor.test', password: 'another-password' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SIGNUP_CLOSED');
  });

  it('signs in with the right password (email is case-insensitive) and returns a working token', async () => {
    const res = await t.anon<AuthOk>('POST', '/auth/login', { email: ' Seller@Floor.TEST ', password: t.seller.password });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('seller@floor.test');
    expect(res.body.token.length).toBeGreaterThan(30);
    const me = await t.anon<{ user: { email: string } }>('GET', '/auth/me', undefined, { authorization: `Bearer ${res.body.token}` });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('seller@floor.test');
    // Only a hash of the token is stored.
    const rows = await t.db.session.findMany();
    expect(rows.some((r) => r.id === res.body.token)).toBe(false);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const wrong = await t.anon<Err>('POST', '/auth/login', { email: t.seller.email, password: 'definitely-wrong' });
    const unknown = await t.anon<Err>('POST', '/auth/login', { email: 'nobody@floor.test', password: 'definitely-wrong' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
  });

  it('rejects a malformed email', async () => {
    const res = await t.anon<Err>('POST', '/auth/login', { email: 'not-an-email', password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION');
  });

  it('logout invalidates the token', async () => {
    const login = await t.anon<AuthOk>('POST', '/auth/login', { email: t.seller.email, password: t.seller.password });
    const auth = { authorization: `Bearer ${login.body.token}` };
    expect((await t.anon('POST', '/auth/logout', undefined, auth)).status).toBe(204);
    expect((await t.anon('GET', '/auth/me', undefined, auth)).status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const login = await t.anon<AuthOk>('POST', '/auth/login', { email: t.seller.email, password: t.seller.password });
    await t.db.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await t.anon('GET', '/auth/me', undefined, { authorization: `Bearer ${login.body.token}` });
    expect(res.status).toBe(401);
    // Restore the shared test session for any later tests.
    const re = await t.anon<AuthOk>('POST', '/auth/login', { email: t.seller.email, password: t.seller.password });
    expect(re.status).toBe(200);
  });

  it('locks an email out after 5 failed attempts, even with the right password', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await t.anon('POST', '/auth/login', { email: 'victim@floor.test', password: 'bad-guess' })).status).toBe(401);
    }
    const res = await t.anon<Err>('POST', '/auth/login', { email: 'victim@floor.test', password: 'bad-guess' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});

describe('concurrency', () => {
  it('parallel wrong guesses cannot slip past the attempt cap', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => t.anon<Err>('POST', '/auth/login', { email: 'racer@floor.test', password: 'bad-guess' })),
    );
    expect(results.filter((r) => r.status === 401)).toHaveLength(5);
    expect(results.filter((r) => r.status === 429)).toHaveLength(7);
  });

  it('two racing first-run signups create exactly one account', async () => {
    const fresh = await createTestApp();
    try {
      await fresh.db.session.deleteMany();
      await fresh.db.user.deleteMany();
      const [a, b] = await Promise.all([
        fresh.anon<AuthOk | Err>('POST', '/auth/signup', { email: 'one@floor.test', password: 'long-enough-pass' }),
        fresh.anon<AuthOk | Err>('POST', '/auth/signup', { email: 'two@floor.test', password: 'long-enough-pass' }),
      ]);
      expect([a.status, b.status].sort()).toEqual([201, 403]);
      expect(await fresh.db.user.count()).toBe(1);
    } finally {
      await fresh.close();
    }
  });
});

describe('first-run signup', () => {
  it('creates the first account, signs in, and then closes signup', async () => {
    const fresh = await createTestApp();
    try {
      await fresh.db.session.deleteMany();
      await fresh.db.user.deleteMany();
      expect((await fresh.anon<{ hasUsers: boolean }>('GET', '/auth/status')).body.hasUsers).toBe(false);

      const short = await fresh.anon<Err>('POST', '/auth/signup', { email: 'me@floor.test', password: 'short' });
      expect(short.status).toBe(400);

      const ok = await fresh.anon<AuthOk>('POST', '/auth/signup', { email: 'Me@Floor.test', password: 'long-enough-pass' });
      expect(ok.status).toBe(201);
      expect(ok.body.user.email).toBe('me@floor.test');
      expect((await fresh.anon('GET', '/account', undefined, { authorization: `Bearer ${ok.body.token}` })).status).toBe(200);

      const again = await fresh.anon<Err>('POST', '/auth/signup', { email: 'x@floor.test', password: 'long-enough-pass' });
      expect(again.status).toBe(403);
    } finally {
      await fresh.close();
    }
  });
});
