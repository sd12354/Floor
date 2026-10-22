import { afterEach, describe, expect, it } from 'vitest';
import { authed, createRealTestApp, type RealTestApp } from './realHelpers.js';

let t: RealTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('GET /account in real mode', () => {
  it('does not report eBay as connected from a flag left over by mock mode', async () => {
    t = await createRealTestApp();
    // What a dev.db that ran in mock mode first looks like.
    await t.db.account.update({ where: { id: 'acc_demo' }, data: { ebayConnected: true, ebayUsername: 'demo_seller' } });
    const r = await t.api<{ ebayConnected: boolean; ebayUsername?: string }>('GET', '/account', undefined, authed(t));
    expect(r.status).toBe(200);
    expect(r.body.ebayConnected).toBe(false);
    expect(r.body.ebayUsername).toBeUndefined();
  });

  it('reports connected once the OAuth callback has stored tokens', async () => {
    t = await createRealTestApp();
    const c = await t.api<{ authorizeUrl: string }>('POST', '/account/ebay/connect', undefined, authed(t));
    const state = new URL(c.body.authorizeUrl).searchParams.get('state');
    expect((await t.api('GET', `/account/ebay/callback?code=c&state=${state}`)).status).toBe(302);
    const r = await t.api<{ ebayConnected: boolean }>('GET', '/account', undefined, authed(t));
    expect(r.body.ebayConnected).toBe(true);
  });
});
