import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '../src/services/secretBox.js';
import { beginEbayConnect, OAUTH_STATE_TTL_MS } from '../src/services/ebayOAuth.js';
import { authed, createRealTestApp, SECRET_KEY, type RealTestApp } from './realHelpers.js';
import { createTestApp } from './helpers.js';

let t: RealTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const stateOf = (authorizeUrl: string): string => new URL(authorizeUrl).searchParams.get('state') ?? '';
const tokenCalls = (x: RealTestApp) => x.ebay.calls.filter((c) => c.url.endsWith('/oauth2/token'));

async function connect(x: RealTestApp): Promise<string> {
  const r = await x.api<{ authorizeUrl: string }>('POST', '/account/ebay/connect', undefined, authed(x));
  expect(r.status).toBe(200);
  return stateOf(r.body.authorizeUrl);
}

describe('secret box (AES-256-GCM)', () => {
  it('round-trips, uses a fresh IV, and rejects tampering, wrong keys and weak keys', () => {
    const a = encryptSecret('{"accessToken":"s3cret"}', SECRET_KEY);
    const b = encryptSecret('{"accessToken":"s3cret"}', SECRET_KEY);
    expect(a).not.toBe(b);
    expect(a).not.toContain('s3cret');
    expect(a.startsWith('v1:')).toBe(true);
    expect(decryptSecret(a, SECRET_KEY)).toBe('{"accessToken":"s3cret"}');
    const raw = Buffer.from(a.slice(3), 'base64');
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(`v1:${raw.toString('base64')}`, SECRET_KEY)).toThrow();
    expect(() => decryptSecret(a, Buffer.alloc(32, 9).toString('base64'))).toThrow();
    expect(() => encryptSecret('x', undefined)).toThrow(/FLOOR_SECRET_KEY/);
    expect(() => encryptSecret('x', 'too-short')).toThrow(/32 bytes/);
    expect(decryptSecret(encryptSecret('hex', 'ab'.repeat(32)), 'ab'.repeat(32))).toBe('hex');
  });
});

describe('POST /account/ebay/connect (real mode)', () => {
  it('returns a consent URL with a random state, stores only its hash, and a different state each time', async () => {
    t = await createRealTestApp();
    const s1 = await connect(t);
    const s2 = await connect(t);
    expect(s1).toMatch(/^[\w-]{40,}$/);
    expect(s1).not.toBe(s2);
    const rows = await t.db.ebayOAuthState.findMany();
    expect(rows.map((r) => r.id)).toContain(createHash('sha256').update(s1).digest('hex'));
    expect(rows.some((r) => r.id === s1)).toBe(false);
  });

  it('refuses without FLOOR_SECRET_KEY (501 NOT_CONFIGURED) and without a 32-byte key', async () => {
    t = await createRealTestApp({ config: { secretKey: undefined } });
    const r = await t.api<{ error: { code: string; message: string } }>('POST', '/account/ebay/connect', undefined, authed(t));
    expect(r.status).toBe(501);
    expect(r.body.error.code).toBe('NOT_CONFIGURED');
    expect(r.body.error.message).toContain('FLOOR_SECRET_KEY');
    expect(await t.db.ebayOAuthState.count()).toBe(0);
    await t.close();
    t = await createRealTestApp({ config: { secretKey: 'short' } });
    expect((await t.api('POST', '/account/ebay/connect', undefined, authed(t))).status).toBe(501);
  });

  it('requires a session', async () => {
    t = await createRealTestApp();
    expect((await t.api('POST', '/account/ebay/connect')).status).toBe(401);
  });
});

describe('GET /account/ebay/callback', () => {
  it('connects: no session needed, redirects to the web app, stores tokens encrypted, sets username', async () => {
    t = await createRealTestApp();
    const state = await connect(t);
    const res = await t.api('GET', `/account/ebay/callback?code=v%5E1.1%23abc&state=${state}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/settings?ebay=connected');
    const form = new URLSearchParams(tokenCalls(t)[0]?.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('v^1.1#abc');
    expect(form.get('redirect_uri')).toBe('Test-RuName');

    const acct = await t.db.account.findUniqueOrThrow({ where: { id: 'acc_demo' } });
    expect(acct).toMatchObject({ ebayConnected: true, ebayUsername: 'sandbox_seller' });

    const row = await t.db.ebayCredential.findUniqueOrThrow({ where: { accountId: 'acc_demo' } });
    expect(row.ciphertext).not.toContain('ACCESS-1');
    expect(row.ciphertext).not.toContain('REFRESH-1');
    expect(JSON.parse(decryptSecret(row.ciphertext, SECRET_KEY))).toEqual({ accessToken: 'ACCESS-1', refreshToken: 'REFRESH-1' });
    expect(row.refreshExpiresAt.getTime()).toBeGreaterThan(Date.now() + 40_000_000 * 1000);
  });

  it('rejects a replayed state and makes no second token request', async () => {
    t = await createRealTestApp();
    const state = await connect(t);
    expect((await t.api('GET', `/account/ebay/callback?code=c1&state=${state}`)).status).toBe(302);
    const again = await t.api<{ error: { code: string } }>('GET', `/account/ebay/callback?code=c2&state=${state}`);
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect(tokenCalls(t)).toHaveLength(1);
  });

  it('rejects missing, unknown and malformed state before touching eBay', async () => {
    t = await createRealTestApp();
    for (const q of ['code=c1', 'code=c1&state=', 'code=c1&state=nope', `code=c1&state=${'x'.repeat(500)}`]) {
      const r = await t.api<{ error: { code: string } }>('GET', `/account/ebay/callback?${q}`);
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_STATE');
    }
    expect(tokenCalls(t)).toHaveLength(0);
    expect((await t.db.account.findUniqueOrThrow({ where: { id: 'acc_demo' } })).ebayConnected).toBe(false);
  });

  it('rejects an expired state', async () => {
    t = await createRealTestApp();
    const old = new Date(Date.now() - OAUTH_STATE_TTL_MS - 60_000);
    const { authorizeUrl } = await beginEbayConnect(t.db, t.connectors, t.config, 'acc_demo', old);
    const r = await t.api<{ error: { code: string } }>('GET', `/account/ebay/callback?code=c1&state=${stateOf(authorizeUrl)}`);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_STATE');
    expect(tokenCalls(t)).toHaveLength(0);
  });

  it('burns the state when the seller denies consent, and when the token exchange fails', async () => {
    t = await createRealTestApp();
    const s1 = await connect(t);
    const denied = await t.api('GET', `/account/ebay/callback?error=access_denied&state=${s1}`);
    expect(denied.headers.location).toBe('http://localhost:5173/settings?ebay=denied');
    expect((await t.api('GET', `/account/ebay/callback?code=c&state=${s1}`)).status).toBe(400);

    t.ebay.add((r) => (r.url.endsWith('/oauth2/token') ? { status: 400, json: { error: 'invalid_grant', error_description: 'code expired' } } : undefined));
    const s2 = await connect(t);
    const failed = await t.api('GET', `/account/ebay/callback?code=bad&state=${s2}`);
    expect(failed.headers.location).toBe('http://localhost:5173/settings?ebay=failed');
    expect((await t.db.account.findUniqueOrThrow({ where: { id: 'acc_demo' } })).ebayConnected).toBe(false);
    expect(await t.db.ebayCredential.count()).toBe(0);
  });

  it('does not store tokens when the key is unset, even with a valid state', async () => {
    t = await createRealTestApp();
    const state = await connect(t);
    const unkeyed = { ...t.config, secretKey: undefined };
    await expect(import('../src/services/ebayOAuth.js').then((m) => m.completeEbayConnect(t!.db, t!.connectors, unkeyed, 'acc_demo', 'c'))).rejects.toThrow(/FLOOR_SECRET_KEY/);
    expect(await t.db.ebayCredential.count()).toBe(0);
    void state;
  });

  it('is real-mode only', async () => {
    const m = await createTestApp();
    const r = await m.anon<{ error: { code: string } }>('GET', '/account/ebay/callback?code=c&state=s');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('REAL_ONLY');
    await m.close();
  });

  it('stored tokens are refreshed through the encrypted store when the access token expires', async () => {
    t = await createRealTestApp();
    const state = await connect(t);
    await t.api('GET', `/account/ebay/callback?code=c&state=${state}`);
    const before = await t.db.ebayCredential.findUniqueOrThrow({ where: { accountId: 'acc_demo' } });
    await t.db.ebayCredential.update({ where: { accountId: 'acc_demo' }, data: { accessExpiresAt: new Date(Date.now() - 1000) } });
    t.ebay.add((r) => (r.url.endsWith('/oauth2/token') && new URLSearchParams(r.body).get('grant_type') === 'refresh_token' ? { json: { access_token: 'ACCESS-2', expires_in: 7200 } } : undefined));
    await (t.connectors.ebay as unknown as { getUsername(): Promise<string | null> }).getUsername();
    const after = await t.db.ebayCredential.findUniqueOrThrow({ where: { accountId: 'acc_demo' } });
    expect(after.ciphertext).not.toBe(before.ciphertext);
    expect(JSON.parse(decryptSecret(after.ciphertext, SECRET_KEY))).toEqual({ accessToken: 'ACCESS-2', refreshToken: 'REFRESH-1' });
    expect(t.ebay.calls.at(-1)?.headers.Authorization).toBe('Bearer ACCESS-2');
  });
});
