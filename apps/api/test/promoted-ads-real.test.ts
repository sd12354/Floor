import { afterEach, describe, expect, it } from 'vitest';
import { runSync } from '../src/services/syncService.js';
import { authed, createRealTestApp, type RealTestApp, type Responder } from './realHelpers.js';

let t: RealTestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const inventoryOk: Responder = (r) => {
  if (r.url.includes('/sell/inventory/v1/offer?sku=')) return { json: { offers: [{ offerId: 'OFF1', sku: 'man_abc', status: 'PUBLISHED', listing: { listingId: '110001' } }] } };
  if (r.url.endsWith('/bulk_update_price_quantity')) return { json: { responses: [{ statusCode: 200 }] } };
  return undefined;
};
/** Marketing API that rejects every call, as eBay does for a token without the sell.marketing scope. */
const noMarketingScope: Responder = (r) => (r.url.includes('/sell/marketing/') ? { status: 403, json: { errors: [{ errorId: 1100, message: 'Insufficient permissions to fulfill the request.' }] } } : undefined);
const marketingOk = (calls: { url: string; method: string; body?: string | undefined }[]): Responder => (r) => {
  if (!r.url.includes('/sell/marketing/')) return undefined;
  const created = calls.some((c) => c.method === 'POST' && c.url.endsWith('/ad'));
  calls.push({ url: r.url, method: r.method, body: r.body });
  if (r.method === 'GET' && r.url.includes('/ad_campaign?')) return { json: { campaigns: [{ campaignId: 'C1', campaignName: 'Floor - promoted listings', campaignStatus: 'RUNNING' }] } };
  if (r.method === 'GET') return { json: { ads: created ? [{ adId: 'AD1', listingId: '110001', bidPercentage: '5.0' }] : [] } };
  return { status: 201 };
};

async function setup(): Promise<RealTestApp> {
  const x = await createRealTestApp({ responders: [inventoryOk] });
  await x.db.product.create({ data: { id: 'prd_1', supplier: 'manual', supplierSku: 'man_abc', title: 'Widget', description: 'd', images: ['https://i/1.jpg'], costCents: 1000, shippingCents: 200, stock: 10, warehouseCountry: 'CN', handlingDays: 3 } });
  await x.db.listing.create({ data: { id: 'lst_1', accountId: 'acc_demo', productId: 'prd_1', ebayItemId: '110001', title: 'Widget', priceCents: 1700, floorPriceCents: 1400, status: 'active', projectedMarginPct: 0.2 } });
  (x.connectors.ebay as unknown as { auth: { config: { userToken?: string; tokenStore?: unknown } } }).auth.config.tokenStore = undefined;
  (x.connectors.ebay as unknown as { auth: { config: { userToken?: string } } }).auth.config.userToken = 'STATIC';
  return x;
}

describe('promoted ads against the real adapter (fake eBay)', () => {
  it('a token without the marketing scope: prices still update, the failure says reconnect, then a reconnect clears it on the next sweep', async () => {
    t = await setup();
    t.ebay.add(noMarketingScope);
    const on = await t.api<{ promotedAdsEnabled: boolean; promotedAdsPending: number }>('PATCH', '/account', { promotedAdsEnabled: true, promotedAdRatePct: 0.05 }, authed(t));
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ promotedAdsEnabled: true, promotedAdsPending: 1 });
    const row = await t.db.listing.findUniqueOrThrow({ where: { id: 'lst_1' } });
    expect(row.status).toBe('active'); // the listing is not blocked
    expect(row.priceCents).toBeGreaterThan(1700); // repriced for the 5% fee even though the ad failed
    expect(row.promotedRatePct).toBeNull();
    const ev = await t.db.event.findMany({ where: { type: 'listing.promote_failed' } });
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev[0]?.payload)).toMatch(/Reconnect eBay/);

    // seller reconnects (scope granted): the next sweep creates the ad
    const calls: { url: string; method: string; body?: string | undefined }[] = [];
    t.ebay.add(marketingOk(calls));
    await runSync(t.db, t.connectors, await t.db.account.findUniqueOrThrow({ where: { id: 'acc_demo' } }));
    const after = await t.db.listing.findUniqueOrThrow({ where: { id: 'lst_1' } });
    expect(after.promotedRatePct).toBe(0.05);
    const create = calls.find((c) => c.method === 'POST' && c.url.endsWith('/ad_campaign/C1/ad'));
    expect(JSON.parse(create?.body ?? 'null')).toEqual({ listingId: '110001', bidPercentage: '5.0' });
  });
});
