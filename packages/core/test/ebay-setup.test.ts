import { describe, expect, it } from 'vitest';
import { EbayReauthRequiredError, RealEbay, SETUP_NAMES, type FetchLike } from '../src/index.js';
import { NOW, baseCfg, fresh, memoryStore } from './ebayFakes.js';

interface Call { method: string; path: string; query: URLSearchParams; body: any } // eslint-disable-line @typescript-eslint/no-explicit-any -- test record
type Handler = (c: Call) => { status?: number; json?: unknown } | undefined;

/** Routes by "METHOD /path"; unmatched requests throw. Records every call. */
function router(handlers: Handler[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    const call: Call = { method: init?.method ?? 'GET', path: u.pathname, query: u.searchParams, body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const hit = handlers.map((h) => h(call)).find((x) => x !== undefined);
    if (!hit) throw new Error(`unexpected ${call.method} ${call.path}`);
    return { status: hit.status ?? 200, headers: { get: () => null }, text: async () => (hit.json === undefined ? '' : JSON.stringify(hit.json)) };
  };
  return { fetch, calls };
}
const on = (method: string, path: string, reply: { status?: number; json?: unknown }): Handler => (c) => (c.method === method && c.path === path ? reply : undefined);
const location = { addressLine1: '1 Main St', city: 'Austin', stateOrProvince: 'TX', postalCode: '78701', country: 'US' };
const make = (f: ReturnType<typeof router>, env: 'sandbox' | 'production' = 'production') =>
  new RealEbay({ ...baseCfg, env, fetch: f.fetch, tokenStore: memoryStore(fresh()), now: () => NOW });

const A = '/sell/account/v1';
const emptyLists: Handler[] = [
  on('GET', `${A}/fulfillment_policy`, { json: { fulfillmentPolicies: [], total: 0 } }),
  on('GET', `${A}/payment_policy`, { json: { paymentPolicies: [] } }),
  on('GET', `${A}/return_policy`, { json: { returnPolicies: [] } }),
  on('GET', '/sell/inventory/v1/location/floor-default', { status: 404, json: { errors: [{ errorId: 25805, message: 'not found' }] } }),
];

describe('setupListingBasics', () => {
  it('creates everything on a fresh account: opt-in, three policies, location; exact request bodies', async () => {
    const f = router([
      on('GET', `${A}/program/get_opted_in_programs`, { json: { programs: [] } }),
      on('POST', `${A}/program/opt_in`, { json: {} }),
      ...emptyLists,
      on('POST', `${A}/fulfillment_policy`, { status: 201, json: { fulfillmentPolicyId: 'FP1' } }),
      on('POST', `${A}/payment_policy`, { status: 201, json: { paymentPolicyId: 'PP1' } }),
      on('POST', `${A}/return_policy`, { status: 201, json: { returnPolicyId: 'RP1' } }),
      on('POST', '/sell/inventory/v1/location/floor-default', { status: 204 }),
    ]);
    const r = await make(f).setupListingBasics({ location });
    expect(r).toMatchObject({ fulfillmentPolicyId: 'FP1', paymentPolicyId: 'PP1', returnPolicyId: 'RP1', merchantLocationKey: 'floor-default', categorySuggestions: [] });
    expect(r.reused).toEqual({ fulfillmentPolicy: false, paymentPolicy: false, returnPolicy: false, location: false });
    expect(r.notes[0]).toMatch(/24 hours/);
    const body = (m: string, p: string) => f.calls.find((c) => c.method === m && c.path === p)?.body;
    expect(body('POST', `${A}/program/opt_in`)).toEqual({ programType: 'SELLING_POLICY_MANAGEMENT' });
    expect(f.calls.find((c) => c.path === `${A}/fulfillment_policy` && c.method === 'GET')?.query.get('marketplace_id')).toBe('EBAY_US');
    expect(body('POST', `${A}/fulfillment_policy`)).toMatchObject({
      name: SETUP_NAMES.fulfillment, marketplaceId: 'EBAY_US', categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }], handlingTime: { value: 3, unit: 'DAY' },
      shippingOptions: [{ optionType: 'DOMESTIC', costType: 'FLAT_RATE', shippingServices: [{ sortOrder: 1, shippingCarrierCode: 'USPS', shippingServiceCode: 'USPSPriority', freeShipping: true }] }],
    });
    expect(body('POST', `${A}/payment_policy`)).toMatchObject({ name: SETUP_NAMES.payment, marketplaceId: 'EBAY_US', immediatePay: true });
    expect(body('POST', `${A}/return_policy`)).toMatchObject({ name: SETUP_NAMES.return, returnsAccepted: true, returnPeriod: { value: 30, unit: 'DAY' }, refundMethod: 'MONEY_BACK', returnShippingCostPayer: 'BUYER' });
    expect(body('POST', '/sell/inventory/v1/location/floor-default')).toEqual({
      name: 'Floor default location', merchantLocationStatus: 'ENABLED', locationTypes: ['WAREHOUSE'], location: { address: location },
    });
    expect(f.calls.some((c) => c.path.includes('taxonomy'))).toBe(false);
  });

  it('reuses existing Floor resources and creates nothing (idempotent re-run)', async () => {
    const f = router([
      on('GET', `${A}/program/get_opted_in_programs`, { json: { programs: [{ programType: 'SELLING_POLICY_MANAGEMENT' }] } }),
      on('GET', `${A}/fulfillment_policy`, { json: { fulfillmentPolicies: [{ name: 'Other', fulfillmentPolicyId: 'X' }, { name: SETUP_NAMES.fulfillment, fulfillmentPolicyId: 'FP9' }] } }),
      on('GET', `${A}/payment_policy`, { json: { paymentPolicies: [{ name: 'Floor - old payment name', paymentPolicyId: 'PP9' }] } }), // any "Floor ..." name is reused
      on('GET', `${A}/return_policy`, { json: { returnPolicies: [{ name: SETUP_NAMES.return, returnPolicyId: 'RP9' }] } }),
      on('GET', '/sell/inventory/v1/location/floor-default', { json: { merchantLocationKey: 'floor-default' } }),
    ]);
    const r = await make(f).setupListingBasics({ location });
    expect(r).toMatchObject({ fulfillmentPolicyId: 'FP9', paymentPolicyId: 'PP9', returnPolicyId: 'RP9', reused: { fulfillmentPolicy: true, paymentPolicy: true, returnPolicy: true, location: true }, notes: [] });
    expect(f.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('ignores policies that are not named Floor and treats a 204 list as empty', async () => {
    const f = router([
      on('GET', `${A}/program/get_opted_in_programs`, { json: { programs: [{ programType: 'SELLING_POLICY_MANAGEMENT' }] } }),
      on('GET', `${A}/fulfillment_policy`, { json: { fulfillmentPolicies: [{ name: 'My policy', fulfillmentPolicyId: 'MINE' }] } }),
      on('GET', `${A}/payment_policy`, { status: 204 }),
      on('GET', `${A}/return_policy`, { json: {} }),
      on('GET', '/sell/inventory/v1/location/floor-default', { json: {} }),
      on('POST', `${A}/fulfillment_policy`, { json: { fulfillmentPolicyId: 'NEW1' } }),
      on('POST', `${A}/payment_policy`, { json: { paymentPolicyId: 'NEW2' } }),
      on('POST', `${A}/return_policy`, { json: { returnPolicyId: 'NEW3' } }),
    ]);
    const r = await make(f).setupListingBasics({ location });
    expect([r.fulfillmentPolicyId, r.paymentPolicyId, r.returnPolicyId]).toEqual(['NEW1', 'NEW2', 'NEW3']);
  });

  it('tolerates an already-opted-in 409 and a duplicate-name create error by re-listing', async () => {
    let created = false;
    const f = router([
      on('GET', `${A}/program/get_opted_in_programs`, { json: { programs: [] } }),
      on('POST', `${A}/program/opt_in`, { status: 409, json: { errors: [{ errorId: 25803, message: 'already exists' }] } }),
      (c) => (c.method === 'GET' && c.path === `${A}/fulfillment_policy` ? { json: { fulfillmentPolicies: created ? [{ name: SETUP_NAMES.fulfillment, fulfillmentPolicyId: 'RACE1' }] : [] } } : undefined),
      (c) => { if (c.method === 'POST' && c.path === `${A}/fulfillment_policy`) { created = true; return { status: 400, json: { errors: [{ errorId: 20400, message: 'A policy with this name already exists' }] } }; } return undefined; },
      on('GET', `${A}/payment_policy`, { json: { paymentPolicies: [{ name: SETUP_NAMES.payment, paymentPolicyId: 'P' }] } }),
      on('GET', `${A}/return_policy`, { json: { returnPolicies: [{ name: SETUP_NAMES.return, returnPolicyId: 'R' }] } }),
      on('GET', '/sell/inventory/v1/location/floor-default', { json: {} }),
    ]);
    const r = await make(f).setupListingBasics({ location });
    expect(r.fulfillmentPolicyId).toBe('RACE1');
    expect(r.reused.fulfillmentPolicy).toBe(true);
    expect(r.notes).toEqual([]); // 409 means it was already opted in, so no "24 hours" note
  });

  it('a genuine create failure is surfaced with the eBay message', async () => {
    const f = router([
      on('GET', `${A}/program/get_opted_in_programs`, { json: { programs: [{ programType: 'SELLING_POLICY_MANAGEMENT' }] } }),
      ...emptyLists,
      on('POST', `${A}/fulfillment_policy`, { status: 400, json: { errors: [{ errorId: 20403, longMessage: 'Please select a valid shipping service' }] } }),
    ]);
    await expect(make(f).setupListingBasics({ location, shippingServiceCode: 'Bogus' })).rejects.toThrow(/valid shipping service/);
    expect(f.calls.find((c) => c.method === 'POST')?.body.shippingOptions[0].shippingServices[0].shippingServiceCode).toBe('Bogus');
  });

  it('a location create that loses a race to another run is reused', async () => {
    let made = false;
    const f = router([
      on('GET', `${A}/program/get_opted_in_programs`, { json: { programs: [{ programType: 'SELLING_POLICY_MANAGEMENT' }] } }),
      on('GET', `${A}/fulfillment_policy`, { json: { fulfillmentPolicies: [{ name: SETUP_NAMES.fulfillment, fulfillmentPolicyId: 'F' }] } }),
      on('GET', `${A}/payment_policy`, { json: { paymentPolicies: [{ name: SETUP_NAMES.payment, paymentPolicyId: 'P' }] } }),
      on('GET', `${A}/return_policy`, { json: { returnPolicies: [{ name: SETUP_NAMES.return, returnPolicyId: 'R' }] } }),
      (c) => (c.method === 'GET' && c.path.endsWith('/location/floor-default') ? (made ? { json: {} } : { status: 404, json: {} }) : undefined),
      (c) => (c.method === 'POST' && c.path.endsWith('/location/floor-default') ? ((made = true), { status: 409, json: { errors: [{ errorId: 25802, message: 'exists' }] } }) : undefined),
    ]);
    expect((await make(f).setupListingBasics({ location })).reused.location).toBe(true);
  });

  it('returns top category suggestions via the taxonomy default tree; notes the sandbox limitation', async () => {
    const mk = () => router([
      on('GET', `${A}/program/get_opted_in_programs`, { json: { programs: [{ programType: 'SELLING_POLICY_MANAGEMENT' }] } }),
      on('GET', `${A}/fulfillment_policy`, { json: { fulfillmentPolicies: [{ name: SETUP_NAMES.fulfillment, fulfillmentPolicyId: 'F' }] } }),
      on('GET', `${A}/payment_policy`, { json: { paymentPolicies: [{ name: SETUP_NAMES.payment, paymentPolicyId: 'P' }] } }),
      on('GET', `${A}/return_policy`, { json: { returnPolicies: [{ name: SETUP_NAMES.return, returnPolicyId: 'R' }] } }),
      on('GET', '/sell/inventory/v1/location/floor-default', { json: {} }),
      on('GET', '/commerce/taxonomy/v1/get_default_category_tree_id', { json: { categoryTreeId: '0', categoryTreeVersion: '131' } }),
      on('GET', '/commerce/taxonomy/v1/category_tree/0/get_category_suggestions', { json: { categorySuggestions: Array.from({ length: 7 }, (_, i) => ({ category: { categoryId: String(100 + i), categoryName: `Cat ${i}` } })) } }),
    ]);
    const f = mk();
    const r = await make(f).setupListingBasics({ location, categoryQuery: ' yoga mat ' });
    expect(r.categorySuggestions).toHaveLength(5);
    expect(r.categorySuggestions[0]).toEqual({ categoryId: '100', name: 'Cat 0' });
    expect(f.calls.find((c) => c.path.endsWith('get_default_category_tree_id'))?.query.get('marketplace_id')).toBe('EBAY_US');
    expect(f.calls.find((c) => c.path.endsWith('get_category_suggestions'))?.query.get('q')).toBe('yoga mat');
    expect(r.notes).toEqual([]);
    const sb = await make(mk(), 'sandbox').setupListingBasics({ location, categoryQuery: 'yoga mat' });
    expect(sb.notes[0]).toMatch(/sandbox/);
  });

  it('a 403 becomes a reconnect message', async () => {
    const f = router([on('GET', `${A}/program/get_opted_in_programs`, { status: 403, json: { errors: [{ errorId: 1100, message: 'Insufficient permissions' }] } })]);
    const err = await make(f).setupListingBasics({ location }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EbayReauthRequiredError);
    expect((err as Error).message).toMatch(/Reconnect eBay/);
  });
});
