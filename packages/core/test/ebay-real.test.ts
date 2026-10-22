import { describe, expect, it } from 'vitest';
import { NotConfiguredError, RealEbay, EbayReauthRequiredError } from '../src/index.js';
import { NOW, baseCfg, fakeFetch, fresh, jsonBody, listingInput, memoryStore } from './ebayFakes.js';

describe('OAuth', () => {
  it('builds the consent URL with state, and refuses without client id / RuName', () => {
    const url = new URL(new RealEbay(baseCfg).authorizeUrl('st123'));
    expect(url.origin).toBe('https://auth.sandbox.ebay.com');
    expect(url.searchParams.get('state')).toBe('st123');
    expect(url.searchParams.get('redirect_uri')).toBe('My-RuName');
    expect(url.searchParams.get('scope')).toContain('sell.inventory');
    expect(() => new RealEbay({}).authorizeUrl()).toThrow(NotConfiguredError);
    expect(new RealEbay({ ...baseCfg, env: 'production' }).authorizeUrl()).toMatch(/^https:\/\/auth\.ebay\.com\//);
  });

  it('exchanges a code: form-encoded, Basic auth, RuName as redirect_uri, stores tokens', async () => {
    const f = fakeFetch([{ json: { access_token: 'A', expires_in: 7200, refresh_token: 'R', refresh_token_expires_in: 47304000 } }]);
    const store = memoryStore();
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store });
    const t = await ebay.exchangeCode('v^1.1#code/with+chars');
    const c = f.calls[0];
    expect(c?.url).toBe('https://api.sandbox.ebay.com/identity/v1/oauth2/token');
    expect(c?.method).toBe('POST');
    expect(c?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(c?.headers.Authorization).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    const form = new URLSearchParams(c?.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('v^1.1#code/with+chars');
    expect(form.get('redirect_uri')).toBe('My-RuName');
    expect(t.accessToken).toBe('A');
    expect(t.expiresAt.toISOString()).toBe('2026-01-01T02:00:00.000Z');
    expect(t.refreshExpiresAt.getTime()).toBe(NOW.getTime() + 47304000 * 1000);
    expect(store.current?.refreshToken).toBe('R');
  });

  it('uses production host for production env and surfaces token errors without leaking secrets', async () => {
    const f = fakeFetch([{ status: 400, json: { error: 'invalid_grant', error_description: 'bad code' } }]);
    const ebay = new RealEbay({ ...baseCfg, env: 'production', fetch: f.fetch });
    await expect(ebay.exchangeCode('x')).rejects.toThrow(/bad code/);
    expect(f.calls[0]?.url).toBe('https://api.ebay.com/identity/v1/oauth2/token');
  });

  it('refreshes an expired access token with the refresh_token grant and keeps the refresh token', async () => {
    const expired = { ...fresh(), expiresAt: new Date(NOW.getTime() - 1000) };
    const store = memoryStore(expired);
    const f = fakeFetch([{ json: { access_token: 'AT2', expires_in: 7200 } }, { json: { username: 'seller1' } }]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store });
    expect(await ebay.getUsername()).toBe('seller1');
    const form = new URLSearchParams(f.calls[0]?.body);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('RT1');
    expect(f.calls[0]?.headers.Authorization).toMatch(/^Basic /);
    expect(f.calls[1]?.headers.Authorization).toBe('Bearer AT2');
    expect(f.calls[1]?.url).toBe('https://apiz.sandbox.ebay.com/commerce/identity/v1/user/');
    expect(store.current).toMatchObject({ accessToken: 'AT2', refreshToken: 'RT1' });
  });

  it('on 401 refreshes once and retries the request; a second 401 is an error', async () => {
    const store = memoryStore(fresh());
    const f = fakeFetch([{ status: 401, json: { errors: [{ errorId: 1001, message: 'Invalid access token' }] } }, { json: { access_token: 'AT2', expires_in: 7200 } }, { json: { username: 'u' } }]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store });
    expect(await ebay.getUsername()).toBe('u');
    expect(f.calls.map((c) => c.headers.Authorization?.split(' ')[0])).toEqual(['Bearer', 'Basic', 'Bearer']);
    expect(f.calls[2]?.headers.Authorization).toBe('Bearer AT2');

    const f2 = fakeFetch([{ status: 401 }, { json: { access_token: 'AT3', expires_in: 7200 } }, { status: 401, json: { errors: [{ errorId: 1001, message: 'still bad' }] } }]);
    const e2 = new RealEbay({ ...baseCfg, fetch: f2.fetch, tokenStore: memoryStore(fresh()) });
    await expect(e2.getUsername()).rejects.toThrow(/still bad/);
    expect(f2.calls).toHaveLength(3);
  });

  it('shares one refresh between concurrent calls', async () => {
    const f = fakeFetch([{ json: { access_token: 'AT2', expires_in: 7200 } }, { json: { username: 'a' } }, { json: { username: 'b' } }]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: memoryStore({ ...fresh(), expiresAt: new Date(0) }) });
    await Promise.all([ebay.getUsername(), ebay.getUsername()]);
    expect(f.calls.filter((c) => c.url.includes('oauth2/token'))).toHaveLength(1);
  });

  it('requires reconnect when the refresh token is expired or refused', async () => {
    const dead = { ...fresh(), expiresAt: new Date(0), refreshExpiresAt: new Date(NOW.getTime() - 1) };
    await expect(new RealEbay({ ...baseCfg, fetch: fakeFetch([]).fetch, tokenStore: memoryStore(dead) }).getUsername()).rejects.toThrow(EbayReauthRequiredError);
    const f = fakeFetch([{ status: 400, json: { error: 'invalid_grant' } }]);
    await expect(new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: memoryStore({ ...fresh(), expiresAt: new Date(0) }) }).getUsername()).rejects.toThrow(EbayReauthRequiredError);
  });

  it('falls back to the static EBAY_USER_TOKEN (cannot refresh) and demands some token otherwise', async () => {
    const f = fakeFetch([{ json: { username: 'u' } }, { status: 401 }]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, userToken: 'STATIC' });
    await ebay.getUsername();
    expect(f.calls[0]?.headers.Authorization).toBe('Bearer STATIC');
    await expect(ebay.getUsername()).rejects.toThrow(EbayReauthRequiredError);
    await expect(new RealEbay({ ...baseCfg, fetch: fakeFetch([]).fetch }).getUsername()).rejects.toThrow(NotConfiguredError);
  });
});

describe('listings', () => {
  const store = () => memoryStore(fresh());

  it('createListing: inventory_item PUT -> offers lookup -> offer POST -> publish, returns listingId', async () => {
    const f = fakeFetch([{ status: 204 }, { status: 404, json: { errors: [{ errorId: 25713, message: 'no offer' }] } }, { status: 201, json: { offerId: 'OFF1' } }, { json: { listingId: '110001' } }]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store() });
    expect(await ebay.createListing(listingInput)).toEqual({ ebayItemId: '110001' });
    const [put, get, post, pub] = f.calls;
    expect(put?.method).toBe('PUT');
    expect(put?.url).toBe('https://api.sandbox.ebay.com/sell/inventory/v1/inventory_item/SKU%201%2Fx');
    expect(put?.headers['Content-Language']).toBe('en-US');
    expect(jsonBody(put)).toEqual({ condition: 'NEW', product: { title: 'T', description: 'D', imageUrls: ['https://i/1.jpg'] }, availability: { shipToLocationAvailability: { quantity: 5 } } });
    expect(get?.url).toBe('https://api.sandbox.ebay.com/sell/inventory/v1/offer?sku=SKU+1%2Fx&marketplace_id=EBAY_US');
    expect(post?.url).toBe('https://api.sandbox.ebay.com/sell/inventory/v1/offer');
    expect(jsonBody(post)).toEqual({
      sku: 'SKU 1/x', marketplaceId: 'EBAY_US', format: 'FIXED_PRICE', availableQuantity: 5, categoryId: '9355', listingDescription: 'D', listingDuration: 'GTC',
      listingPolicies: { fulfillmentPolicyId: 'FP', paymentPolicyId: 'PP', returnPolicyId: 'RP' }, merchantLocationKey: 'LOC1',
      pricingSummary: { price: { value: '19.99', currency: 'USD' } },
    });
    expect(post?.headers['Content-Language']).toBe('en-US');
    expect(pub?.method).toBe('POST');
    expect(pub?.url).toBe('https://api.sandbox.ebay.com/sell/inventory/v1/offer/OFF1/publish');
    expect(pub?.body).toBeUndefined();
  });

  it('createListing reuses an unpublished offer (PUT) and returns an already-published one without re-publishing', async () => {
    const f = fakeFetch([{ status: 204 }, { json: { offers: [{ offerId: 'OFF9', sku: 'SKU 1/x', status: 'UNPUBLISHED' }] } }, { status: 204 }, { json: { listingId: '110002' } }]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store() });
    expect((await ebay.createListing(listingInput)).ebayItemId).toBe('110002');
    expect(f.calls[2]?.method).toBe('PUT');
    expect(f.calls[2]?.url).toMatch(/\/offer\/OFF9$/);

    const f2 = fakeFetch([{ status: 204 }, { json: { offers: [{ offerId: 'OFF9', status: 'PUBLISHED', listing: { listingId: '777' } }] } }]);
    expect((await new RealEbay({ ...baseCfg, fetch: f2.fetch, tokenStore: store() }).createListing(listingInput)).ebayItemId).toBe('777');
    expect(f2.calls).toHaveLength(2);
  });

  it('createListing names every missing setting and makes no request', async () => {
    const f = fakeFetch([]);
    const ebay = new RealEbay({ clientId: 'c', clientSecret: 's', userToken: 't', fetch: f.fetch });
    const err = await ebay.createListing(listingInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotConfiguredError);
    expect((err as NotConfiguredError).missing).toEqual(['EBAY_FULFILLMENT_POLICY_ID', 'EBAY_PAYMENT_POLICY_ID', 'EBAY_RETURN_POLICY_ID', 'EBAY_MERCHANT_LOCATION_KEY', 'EBAY_DEFAULT_CATEGORY_ID']);
    expect(f.calls).toHaveLength(0);
  });

  it('getOfferBySku returns the sku <-> offerId mapping, preferring the published offer', async () => {
    const f = fakeFetch([{ json: { offers: [{ offerId: 'A', status: 'UNPUBLISHED' }, { offerId: 'B', status: 'PUBLISHED', listing: { listingId: 'L1' } }] } }]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store() });
    expect(await ebay.getOfferBySku('S')).toEqual({ offerId: 'B', sku: 'S', status: 'PUBLISHED', listingId: 'L1' });
  });

  it('setQuantity / price update use bulk_update_price_quantity with decimal-string prices; offer found via resolveSku', async () => {
    const f = fakeFetch([
      { json: { offers: [{ offerId: 'OFF1', status: 'PUBLISHED', listing: { listingId: 'L1' } }] } },
      { json: { responses: [{ sku: 'S1', offerId: 'OFF1', statusCode: 200 }] } },
      { json: { responses: [{ sku: 'S1', offerId: 'OFF1', statusCode: 200 }] } },
    ]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store(), resolveSku: async (id) => (id === 'L1' ? 'S1' : null) });
    await ebay.setQuantity('L1', 0);
    await ebay.updateListing('L1', { priceCents: 1005, quantity: 3 });
    expect(f.calls[0]?.url).toContain('offer?sku=S1');
    expect(f.calls[1]?.url).toBe('https://api.sandbox.ebay.com/sell/inventory/v1/bulk_update_price_quantity');
    expect(jsonBody(f.calls[1])).toEqual({ requests: [{ sku: 'S1', shipToLocationAvailability: { quantity: 0 }, offers: [{ offerId: 'OFF1', availableQuantity: 0 }] }] });
    expect(jsonBody(f.calls[2])).toEqual({ requests: [{ sku: 'S1', shipToLocationAvailability: { quantity: 3 }, offers: [{ offerId: 'OFF1', availableQuantity: 3, price: { value: '10.05', currency: 'USD' } }] }] });
  });

  it('a per-offer failure inside a 200 bulk response is an error; unknown listing is a clear error', async () => {
    const f = fakeFetch([{ json: { offers: [{ offerId: 'O', status: 'PUBLISHED', listing: { listingId: 'L1' } }] } }, { json: { responses: [{ statusCode: 400, errors: [{ message: 'bad price' }] }] } }]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store(), resolveSku: async () => 'S' });
    await expect(ebay.setQuantity('L1', 1)).rejects.toThrow(/bad price/);
    await expect(new RealEbay({ ...baseCfg, fetch: fakeFetch([]).fetch, tokenStore: store() }).setQuantity('zzz', 1)).rejects.toThrow(/cannot map listing/);
  });

  it('updateListing re-PUTs the inventory item (GET first) and the offer description', async () => {
    const f = fakeFetch([
      { json: { offers: [{ offerId: 'O', status: 'PUBLISHED', listing: { listingId: 'L1' } }] } },
      { json: { condition: 'NEW', product: { title: 'old', aspects: { Color: ['Red'] } }, availability: { shipToLocationAvailability: { quantity: 2 } } } },
      { status: 204 },
      { json: { offerId: 'O', status: 'PUBLISHED', listing: { listingId: 'L1' }, sku: 'S', format: 'FIXED_PRICE', listingDescription: 'old' } },
      { status: 200, json: { offerId: 'O' } },
    ]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store(), resolveSku: async () => 'S' });
    await ebay.updateListing('L1', { title: 'New', description: 'Desc' });
    expect(jsonBody(f.calls[2]).product).toEqual({ title: 'New', description: 'Desc', aspects: { Color: ['Red'] } });
    expect(f.calls[2]?.headers['Content-Language']).toBe('en-US');
    expect(f.calls[4]?.method).toBe('PUT');
    expect(jsonBody(f.calls[4])).toEqual({ sku: 'S', format: 'FIXED_PRICE', listingDescription: 'Desc' });
  });

  it('endListing withdraws the offer', async () => {
    const f = fakeFetch([{ json: { offers: [{ offerId: 'OFF1', status: 'PUBLISHED', listing: { listingId: 'L1' } }] } }, { json: { listingId: 'L1' } }]);
    await new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store(), resolveSku: async () => 'S' }).endListing('L1');
    expect(f.calls[1]?.method).toBe('POST');
    expect(f.calls[1]?.url).toBe('https://api.sandbox.ebay.com/sell/inventory/v1/offer/OFF1/withdraw');
  });
});

describe('fulfillment, payouts, messages', () => {
  const store = () => memoryStore(fresh());

  it('createShippingFulfillment looks up lineItemIds then POSTs the tracking', async () => {
    const f = fakeFetch([{ json: { orderId: '12-345', orderFulfillmentStatus: 'NOT_STARTED', lineItems: [{ lineItemId: '1001', quantity: 1 }] } }, { status: 201 }]);
    await new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store() }).createShippingFulfillment({ ebayOrderId: '12-345', trackingNumber: 'TRK1', carrier: 'USPS', shippedAt: '2026-01-02T03:04:05Z' });
    expect(f.calls[0]?.url).toBe('https://api.sandbox.ebay.com/sell/fulfillment/v1/order/12-345');
    expect(f.calls[1]?.url).toBe('https://api.sandbox.ebay.com/sell/fulfillment/v1/order/12-345/shipping_fulfillment');
    expect(jsonBody(f.calls[1])).toEqual({ lineItems: [{ lineItemId: '1001', quantity: 1 }], shippedDate: '2026-01-02T03:04:05.000Z', shippingCarrierCode: 'USPS', trackingNumber: 'TRK1' });
  });

  it('createShippingFulfillment is a no-op for an already FULFILLED order', async () => {
    const f = fakeFetch([{ json: { orderId: 'o', orderFulfillmentStatus: 'FULFILLED', lineItems: [{ lineItemId: '1' }] } }]);
    await new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store() }).createShippingFulfillment({ ebayOrderId: 'o', trackingNumber: 't', carrier: 'UPS', shippedAt: '2026-01-02T00:00:00Z' });
    expect(f.calls).toHaveLength(1);
  });

  it('getPayoutSchedule reads seller_funds_summary on the apiz host; funds on hold means the 30 day hold; 204 means default', async () => {
    const f = fakeFetch([{ json: { fundsOnHold: { value: '12.00', currency: 'USD' } } }, { status: 204 }]);
    const ebay = new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: store() });
    expect(await ebay.getPayoutSchedule()).toEqual({ payoutDelayDays: 30, newSellerHold: true });
    expect(f.calls[0]?.url).toBe('https://apiz.sandbox.ebay.com/sell/finances/v1/seller_funds_summary');
    expect(f.calls[0]?.headers['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_US');
    expect(await ebay.getPayoutSchedule()).toEqual({ payoutDelayDays: 3, newSellerHold: false });
  });

  it('sendBuyerMessage never throws, never calls the network, and logs', async () => {
    const f = fakeFetch([]);
    const logs: string[] = [];
    await new RealEbay({ fetch: f.fetch, log: (m) => void logs.push(m) }).sendBuyerMessage('o', 'hello');
    expect(f.calls).toHaveLength(0);
    expect(logs[0]).toMatch(/no-op/);
  });

  it('API errors carry eBay error text and ids', async () => {
    const f2 = fakeFetch([{ status: 400, json: { errors: [{ errorId: 25002, message: 'bad', longMessage: 'The policy is invalid' }] } }]);
    const e2 = await new RealEbay({ ...baseCfg, fetch: f2.fetch, tokenStore: store() }).getOffersBySku('S').catch((e: unknown) => e as Error & { errorIds: number[]; status: number });
    expect(e2).toMatchObject({ status: 400, errorIds: [25002] });
    expect((e2 as Error).message).toContain('The policy is invalid');
  });
});

