import { afterEach, describe, expect, it } from 'vitest';
import { authed, createRealTestApp, identityOk, tokenOk, type RealTestApp, type Responder } from './realHelpers.js';
import { createTestApp } from './helpers.js';

let t: RealTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const location = { addressLine1: '1 Main St', city: 'Austin', stateOrProvince: 'TX', postalCode: '78701', country: 'US' };
const A = '/sell/account/v1';

/** A tiny stateful fake of the eBay account, inventory-location and taxonomy endpoints Floor's setup uses. */
function fakeAccount() {
  const policies: Record<string, { name: string; id: string }[]> = { fulfillment_policy: [], payment_policy: [], return_policy: [] };
  const idField: Record<string, string> = { fulfillment_policy: 'fulfillmentPolicyId', payment_policy: 'paymentPolicyId', return_policy: 'returnPolicyId' };
  const listKey: Record<string, string> = { fulfillment_policy: 'fulfillmentPolicies', payment_policy: 'paymentPolicies', return_policy: 'returnPolicies' };
  const state = { optedIn: false, location: false, creates: 0 };
  const responder: Responder = (r) => {
    const u = new URL(r.url);
    const p = u.pathname;
    if (p === `${A}/program/get_opted_in_programs`) return { json: { programs: state.optedIn ? [{ programType: 'SELLING_POLICY_MANAGEMENT' }] : [] } };
    if (p === `${A}/program/opt_in`) return ((state.optedIn = true), { json: {} });
    const kind = Object.keys(policies).find((k) => p === `${A}/${k}`);
    if (kind) {
      const rows = policies[kind] ?? [];
      if (r.method === 'GET') return { json: { [listKey[kind] ?? '']: rows.map((x) => ({ name: x.name, [idField[kind] ?? '']: x.id })) } };
      state.creates += 1;
      const id = `${kind.slice(0, 2).toUpperCase()}${rows.length + 100}`;
      rows.push({ name: JSON.parse(r.body ?? '{}').name, id });
      return { status: 201, json: { [idField[kind] ?? '']: id } };
    }
    if (p === '/sell/inventory/v1/location/floor-default') {
      if (r.method === 'GET') return state.location ? { json: {} } : { status: 404, json: { errors: [{ errorId: 25805, message: 'nf' }] } };
      state.creates += 1;
      state.location = true;
      return { status: 204 };
    }
    if (p === '/commerce/taxonomy/v1/get_default_category_tree_id') return { json: { categoryTreeId: '0' } };
    if (p === '/commerce/taxonomy/v1/category_tree/0/get_category_suggestions') return { json: { categorySuggestions: [{ category: { categoryId: '36', categoryName: 'Sports > Yoga' } }, { category: { categoryId: '37', categoryName: 'Sports > Mats' } }] } };
    return undefined;
  };
  return { responder, state };
}

/** Real-mode app with eBay connected through the real callback flow. */
async function connected(extra: Responder[] = []): Promise<{ x: RealTestApp; fake: ReturnType<typeof fakeAccount> }> {
  const fake = fakeAccount();
  const x = await createRealTestApp({ responders: [tokenOk(), identityOk(), ...extra, fake.responder] });
  const c = await x.api<{ authorizeUrl: string }>('POST', '/account/ebay/connect', undefined, authed(x));
  const state = new URL(c.body.authorizeUrl).searchParams.get('state');
  expect((await x.api('GET', `/account/ebay/callback?code=c&state=${state}`)).status).toBe(302);
  return { x, fake };
}

describe('POST /account/ebay/setup (real mode)', () => {
  it('is 409 EBAY_NOT_CONNECTED before eBay is connected and makes no eBay request', async () => {
    t = await createRealTestApp({ responders: [] });
    const r = await t.api<{ error: { code: string; message: string } }>('POST', '/account/ebay/setup', { location }, authed(t));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EBAY_NOT_CONNECTED');
    expect(r.body.error.message).toMatch(/Connect your eBay account/);
    expect(t.ebay.calls).toHaveLength(0);
  });

  it('requires a session and validates the body (US address only)', async () => {
    t = await createRealTestApp({ responders: [] });
    expect((await t.api('POST', '/account/ebay/setup', { location })).status).toBe(401);
    for (const bad of [{}, { location: { ...location, city: '' } }, { location: { ...location, country: 'CA' } }, { location: { addressLine1: '1 Main' } }]) {
      const r = await t.api<{ error: { code: string } }>('POST', '/account/ebay/setup', bad, authed(t));
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('VALIDATION');
    }
    expect(t.ebay.calls).toHaveLength(0);
  });

  it('creates the basics, returns ids + env lines + suggestions, and is idempotent on a second run', async () => {
    const { x, fake } = await connected();
    t = x;
    const r = await x.api<{ fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string; merchantLocationKey: string; categorySuggestions: { categoryId: string; name: string }[]; envLines: string; reused: Record<string, boolean>; notes: string[] }>('POST', '/account/ebay/setup', { location, categoryQuery: 'yoga mat' }, authed(x));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ fulfillmentPolicyId: 'FU100', paymentPolicyId: 'PA100', returnPolicyId: 'RE100', merchantLocationKey: 'floor-default' });
    expect(r.body.categorySuggestions).toEqual([{ categoryId: '36', name: 'Sports > Yoga' }, { categoryId: '37', name: 'Sports > Mats' }]);
    expect(r.body.envLines).toBe(['EBAY_FULFILLMENT_POLICY_ID=FU100', 'EBAY_PAYMENT_POLICY_ID=PA100', 'EBAY_RETURN_POLICY_ID=RE100', 'EBAY_MERCHANT_LOCATION_KEY=floor-default', 'EBAY_DEFAULT_CATEGORY_ID=36'].join('\n'));
    expect(fake.state.creates).toBe(4);
    expect(r.body.reused).toEqual({ fulfillmentPolicy: false, paymentPolicy: false, returnPolicy: false, location: false });

    const again = await x.api<{ fulfillmentPolicyId: string; reused: Record<string, boolean> }>('POST', '/account/ebay/setup', { location }, authed(x));
    expect(again.status).toBe(200);
    expect(again.body.fulfillmentPolicyId).toBe('FU100');
    expect(again.body.reused).toEqual({ fulfillmentPolicy: true, paymentPolicy: true, returnPolicy: true, location: true });
    expect(fake.state.creates).toBe(4);
  });

  it('uses the connected user token and does not persist the returned ids as configuration', async () => {
    const { x } = await connected();
    t = x;
    await x.api('POST', '/account/ebay/setup', { location }, authed(x));
    const setupCalls = x.ebay.calls.filter((c) => c.url.includes('/sell/account/'));
    expect(setupCalls.length).toBeGreaterThan(0);
    expect(setupCalls.every((c) => c.headers.Authorization === 'Bearer ACCESS-1')).toBe(true);
    expect(x.connectors.mode).toBe('real');
    expect(x.config.ebay.fulfillmentPolicyId).toBeUndefined(); // config is env-only; the route returns, never stores
  });

  it('maps an eBay refusal of permissions to 409 EBAY_REAUTH_REQUIRED and other eBay errors to 502', async () => {
    const { x } = await connected([(r) => (r.url.includes('get_opted_in_programs') ? { status: 403, json: { errors: [{ errorId: 1100, message: 'Insufficient permissions' }] } } : undefined)]);
    t = x;
    const r = await x.api<{ error: { code: string; message: string } }>('POST', '/account/ebay/setup', { location }, authed(x));
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('EBAY_REAUTH_REQUIRED');
    expect(r.body.error.message).toMatch(/Reconnect eBay/);
    await x.close();

    const second = await connected([(r2) => (r2.url.includes('get_opted_in_programs') ? { status: 500, json: { errors: [{ errorId: 20500, message: 'System error' }] } } : undefined)]);
    t = second.x;
    const e = await second.x.api<{ error: { code: string } }>('POST', '/account/ebay/setup', { location }, authed(second.x));
    expect(e.status).toBe(502);
    expect(e.body.error.code).toBe('EBAY_API_ERROR');
  });
});

describe('POST /account/ebay/setup (mock mode)', () => {
  it('returns deterministic fake ids with no credentials and no eBay', async () => {
    const m = await createTestApp();
    const a = await m.api<{ fulfillmentPolicyId: string; envLines: string; categorySuggestions: { categoryId: string }[]; notes: string[] }>('POST', '/account/ebay/setup', { location, categoryQuery: 'yoga mat' });
    const b = await m.api('POST', '/account/ebay/setup', { location, categoryQuery: 'yoga mat' });
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(a.body.fulfillmentPolicyId).toBe('6000000001');
    expect(a.body.envLines).toContain('EBAY_MERCHANT_LOCATION_KEY=floor-default');
    expect(a.body.envLines).toContain('EBAY_DEFAULT_CATEGORY_ID=11700');
    expect(a.body.categorySuggestions.length).toBeGreaterThan(0);
    expect(a.body.notes[0]).toMatch(/Demo values/);
    const none = await m.api<{ envLines: string }>('POST', '/account/ebay/setup', { location });
    expect(none.body.envLines).toContain('# EBAY_DEFAULT_CATEGORY_ID=');
    expect((await m.api('POST', '/account/ebay/setup', { location: { ...location, country: 'CA' } })).status).toBe(400);
    await m.close();
  });
});
