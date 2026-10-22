import { afterEach, describe, expect, it } from 'vitest';
import { pollEbayOrders } from '../src/services/ebayIngest.js';
import { authed, createRealTestApp, type RealTestApp, type Responder } from './realHelpers.js';

let t: RealTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const ebayOrder = (orderId: string, itemId = '110001', over: Record<string, unknown> = {}) => ({
  orderId, creationDate: new Date().toISOString(), orderPaymentStatus: 'PAID', orderFulfillmentStatus: 'NOT_STARTED', cancelStatus: { cancelState: 'NONE_REQUESTED' },
  pricingSummary: { priceSubtotal: { value: '30.00', currency: 'USD' }, deliveryCost: { value: '0.00', currency: 'USD' } },
  lineItems: [{ lineItemId: 'li1', legacyItemId: itemId, quantity: 1 }],
  fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: 'Jane Doe', contactAddress: { addressLine1: '1 Main St', city: 'Austin', stateOrProvince: 'TX', postalCode: '78701', countryCode: 'US' } } } }],
  ...over,
});
const ordersReply = (orders: unknown[]): Responder => (r) => (r.url.includes('/sell/fulfillment/v1/order?') ? { json: { total: orders.length, orders } } : undefined);

/** The pipeline's stock sync writes quantity to eBay: answer the offer lookup and the bulk update. */
const inventoryOk: Responder = (r) => {
  if (r.url.includes('/sell/inventory/v1/offer?sku=')) return { json: { offers: [{ offerId: 'OFF1', sku: 'man_abc', status: 'PUBLISHED', listing: { listingId: '110001' } }] } };
  if (r.url.endsWith('/bulk_update_price_quantity')) return { json: { responses: [{ statusCode: 200 }] } };
  return undefined;
};

/** A connected seller with one active manual-product listing carrying eBay item 110001 (manual products need no supplier call). */
async function setup(orders: unknown[]): Promise<RealTestApp> {
  const x = await createRealTestApp({ responders: [ordersReply(orders), inventoryOk] });
  await x.db.product.create({ data: { id: 'prd_1', supplier: 'manual', supplierSku: 'man_abc', title: 'Widget', description: 'd', images: ['https://i/1.jpg'], costCents: 1000, shippingCents: 200, stock: 10, warehouseCountry: 'CN', handlingDays: 3 } });
  await x.db.listing.create({ data: { id: 'lst_1', accountId: 'acc_demo', productId: 'prd_1', ebayItemId: '110001', title: 'Widget', priceCents: 3000, floorPriceCents: 2000, status: 'active', projectedMarginPct: 0.4 } });
  await x.db.ebayCredential.create({ data: { accountId: 'acc_demo', ciphertext: 'unused', accessExpiresAt: new Date(Date.now() + 3600_000), refreshExpiresAt: new Date(Date.now() + 86_400_000), ordersSyncedAt: new Date(Date.now() - 3600_000) } });
  // the poller's listNewOrders needs a token: static fallback keeps this test independent of encryption
  (x.connectors.ebay as unknown as { auth: { config: { userToken?: string; tokenStore?: unknown } } }).auth.config.tokenStore = undefined;
  (x.connectors.ebay as unknown as { auth: { config: { userToken?: string } } }).auth.config.userToken = 'STATIC';
  return x;
}

const account = (x: RealTestApp) => x.db.account.findUniqueOrThrow({ where: { id: 'acc_demo' } });

describe('eBay order poller', () => {
  it('imports a paid eBay order through the pipeline once; a second poll is a no-op', async () => {
    t = await setup([ebayOrder('12-001')]);
    const first = await pollEbayOrders(t.db, t.connectors, await account(t));
    expect(first).toMatchObject({ fetched: 1, created: 1, duplicates: 0, unmatched: 0, failed: 0 });
    const orders = await t.db.order.findMany();
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ ebayOrderId: '12-001', salePriceCents: 3000, buyerShippingCents: 0, buyerName: 'Jane Doe', status: 'awaiting_supplier' });

    const second = await pollEbayOrders(t.db, t.connectors, await account(t));
    expect(second).toMatchObject({ created: 0, duplicates: 1 });
    expect(await t.db.order.count()).toBe(1);
    expect(await t.db.ledgerEntry.count()).toBe(0); // manual flow: nothing bought, nothing booked
  });

  it('sends the filter since the cursor (with overlap) and advances the cursor', async () => {
    t = await setup([]);
    const cursor = (await t.db.ebayCredential.findUniqueOrThrow({ where: { accountId: 'acc_demo' } })).ordersSyncedAt;
    const now = new Date();
    await pollEbayOrders(t.db, t.connectors, await account(t), now);
    const url = new URL(t.ebay.calls.find((c) => c.url.includes('/sell/fulfillment/v1/order?'))?.url ?? '');
    expect(url.searchParams.get('filter')).toContain(`creationdate:[${new Date(cursor.getTime() - 10 * 60_000).toISOString()}..]`);
    expect((await t.db.ebayCredential.findUniqueOrThrow({ where: { accountId: 'acc_demo' } })).ordersSyncedAt.getTime()).toBe(now.getTime());
  });

  it('counts orders for unknown items as unmatched and records unsupported orders once, never creating orders', async () => {
    t = await setup([ebayOrder('12-002', '999999'), ebayOrder('12-003', '110001', { lineItems: [{ lineItemId: 'a', legacyItemId: '110001', quantity: 3 }] })]);
    const a = await pollEbayOrders(t.db, t.connectors, await account(t));
    expect(a).toMatchObject({ fetched: 2, created: 0, unmatched: 1, skipped: 1 });
    await pollEbayOrders(t.db, t.connectors, await account(t));
    expect(await t.db.order.count()).toBe(0);
    expect(await t.db.event.count({ where: { type: 'ebay.order_skipped' } })).toBe(1);
  });

  it('a margin-negative eBay order is held, not fulfilled (gate and margin engine still apply)', async () => {
    t = await setup([ebayOrder('12-004', '110001', { pricingSummary: { priceSubtotal: { value: '13.00', currency: 'USD' } } })]);
    await pollEbayOrders(t.db, t.connectors, await account(t));
    const o = await t.db.order.findUniqueOrThrow({ where: { ebayOrderId: '12-004' } });
    expect(o.status).toBe('held');
    expect(o.supplierOrderId).toBeNull();
  });

  it('does nothing in mock mode or without a connected eBay account', async () => {
    t = await createRealTestApp({ responders: [] });
    expect(await pollEbayOrders(t.db, t.connectors, await account(t))).toBeNull(); // no credential row
    expect(t.ebay.calls).toHaveLength(0);
  });
});

describe('POST /webhooks/ebay authentication', () => {
  const body = (orderId: string) => ({ ebayOrderId: orderId, ebayItemId: '110001', buyerName: 'Jane', shipTo: { line1: '1 Main', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' }, salePriceCents: 3000 });

  it('accepts the shared secret header or a session, rejects everything else; replays are no-ops', async () => {
    t = await setup([]);
    const ok = await t.api<{ duplicate: boolean }>('POST', '/webhooks/ebay', body('w-1'), { 'x-floor-webhook-secret': 'whsec-test' });
    expect(ok.status).toBe(201);
    const replay = await t.api<{ duplicate: boolean }>('POST', '/webhooks/ebay', body('w-1'), { 'x-floor-webhook-secret': 'whsec-test' });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect((await t.api('POST', '/webhooks/ebay', body('w-2'), authed(t))).status).toBe(201);

    for (const headers of <Record<string, string>[]>[{}, { 'x-floor-webhook-secret': 'wrong' }, { 'x-floor-webhook-secret': '' }, { authorization: 'Bearer nope' }]) {
      expect((await t.api('POST', '/webhooks/ebay', body('w-3'), headers)).status).toBe(401);
    }
    expect(await t.db.order.count()).toBe(2);
  });

  it('a configured-less server never accepts the header', async () => {
    t = await createRealTestApp({ config: { webhookSecret: undefined }, responders: [] });
    expect((await t.api('POST', '/webhooks/ebay', body('w-1'), { 'x-floor-webhook-secret': 'anything' })).status).toBe(401);
  });
});
