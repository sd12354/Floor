import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

describe('account & setup', () => {
  it('GET /account returns the seeded demo account with mode and supplier connections', async () => {
    const res = await t.api<{ id: string; mode: string; ebayConnected: boolean; supplierConnections: { supplier: string; status: string }[]; fees: { finalValueFeePct: number } }>('GET', '/account');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('acc_demo');
    expect(res.body.mode).toBe('mock');
    expect(res.body.ebayConnected).toBe(false);
    expect(res.body.fees.finalValueFeePct).toBe(0.136);
    expect(res.body.supplierConnections).toEqual([expect.objectContaining({ supplier: 'mock', status: 'connected' })]);
  });

  it('defaults to acc_demo without the header and 404s for unknown accounts', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/account', headers: { authorization: `Bearer ${t.seller.token}` } });
    expect(res.statusCode).toBe(200);
    const bad = await t.api<{ error: { code: string } }>('GET', '/account', undefined, { 'x-account-id': 'acc_nope' });
    expect(bad.status).toBe(404);
    expect(bad.body.error.code).toBe('NOT_FOUND');
  });

  it('POST /account/ebay/connect marks connected in mock mode', async () => {
    const res = await t.api<{ ebayConnected: boolean; ebayUsername: string }>('POST', '/account/ebay/connect');
    expect(res.status).toBe(200);
    expect(res.body.ebayConnected).toBe(true);
    expect(res.body.ebayUsername).toBe('demo_seller');
  });

  it('PATCH /account updates pricing rule, fees and caps; validates', async () => {
    const res = await t.api<{ pricingRule: { targetPct: number; roundTo: string }; fees: { storeDiscountPct: number }; dailySpendCapCents: number }>('PATCH', '/account', {
      pricingRule: { targetPct: 0.25 },
      fees: { storeDiscountPct: 0.009 },
      dailySpendCapCents: 12345,
    });
    expect(res.status).toBe(200);
    expect(res.body.pricingRule).toMatchObject({ targetPct: 0.25, roundTo: '0.99', floorPct: 0.1 });
    expect(res.body.fees.storeDiscountPct).toBe(0.009);
    expect(res.body.dailySpendCapCents).toBe(12345);

    const bad = await t.api<{ error: { code: string } }>('PATCH', '/account', { handlingTimeDays: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
    const inverted = await t.api<{ error: { code: string } }>('PATCH', '/account', { pricingRule: { floorPct: 0.3, targetPct: 0.2 } });
    expect(inverted.status).toBe(400);
  });

  it('POST /suppliers rejects non-allowlisted and is idempotent for mock; DELETE removes', async () => {
    const bad = await t.api<{ error: { code: string } }>('POST', '/suppliers', { supplier: 'aliexpress' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('SUPPLIER_NOT_ALLOWED');
    const notAvail = await t.api<{ error: { code: string } }>('POST', '/suppliers', { supplier: 'cjdropshipping' });
    expect(notAvail.status).toBe(422);

    const ok = await t.api<{ id: string; supplier: string; status: string }>('POST', '/suppliers', { supplier: 'mock' });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('connected');
    const del = await t.api('DELETE', `/suppliers/${ok.body.id}`);
    expect(del.status).toBe(204);
    const acct = await t.api<{ supplierConnections: unknown[] }>('GET', '/account');
    expect(acct.body.supplierConnections).toHaveLength(0);
    // reconnect for later tests in this file
    await t.api('POST', '/suppliers', { supplier: 'mock' });
  });

  it('unknown routes use the contract error shape', async () => {
    const res = await t.api<{ error: { code: string; message: string } }>('GET', '/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('error shape', () => {
  it('maps malformed JSON bodies to the contract BAD_REQUEST code', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/listings', headers: { 'x-account-id': 'acc_demo', 'content-type': 'application/json', authorization: `Bearer ${t.seller.token}` }, payload: 'not json' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
    const empty = await t.app.inject({ method: 'POST', url: '/api/v1/listings/sync', headers: { 'x-account-id': 'acc_demo', 'content-type': 'application/json', authorization: `Bearer ${t.seller.token}` } });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe('BAD_REQUEST');
  });

  it('clamps pagination and tolerates garbage page params', async () => {
    const res = await t.api<{ page: number; pageSize: number }>('GET', '/orders?page=-3&pageSize=abc');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20 });
    const big = await t.api<{ pageSize: number }>('GET', '/listings?pageSize=5000');
    expect(big.body.pageSize).toBe(200);
  });
});
