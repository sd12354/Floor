import { describe, expect, it } from 'vitest';
import { AD_CAMPAIGN_NAME, DEFAULT_SCOPES, EbayApiError, EbayReauthRequiredError, MockEbay, RealEbay, bidPercentageString, normalizeAdRate } from '../src/index.js';
import { baseCfg, fakeFetch, fresh, jsonBody, listingInput, memoryStore } from './ebayFakes.js';

const MKT = 'https://api.sandbox.ebay.com/sell/marketing/v1';
const ebayWith = (replies: Parameters<typeof fakeFetch>[0]) => {
  const f = fakeFetch(replies);
  return { f, ebay: new RealEbay({ ...baseCfg, fetch: f.fetch, tokenStore: memoryStore(fresh()) }) };
};
const campaignRow = (status = 'RUNNING') => ({ campaigns: [{ campaignId: 'C1', campaignName: AD_CAMPAIGN_NAME, campaignStatus: status }] });

describe('ad rate helpers', () => {
  it('formats the bid percentage with one decimal and validates the range', () => {
    expect(bidPercentageString(0.02)).toBe('2.0');
    expect(bidPercentageString(0.025)).toBe('2.5');
    expect(bidPercentageString(0.1)).toBe('10.0');
    expect(normalizeAdRate(0.0254)).toBe(0.025);
    expect(() => normalizeAdRate(0.01)).toThrow(RangeError);
    expect(() => normalizeAdRate(1.01)).toThrow(RangeError);
    expect(() => normalizeAdRate(Number.NaN)).toThrow(RangeError);
  });
  it('the OAuth scopes include the marketing scope', () => {
    expect(DEFAULT_SCOPES).toContain('https://api.ebay.com/oauth/api_scope/sell.marketing');
  });
});

describe('RealEbay promoted ads', () => {
  it('creates the campaign and the ad when neither exists', async () => {
    const { f, ebay } = ebayWith([
      { json: { campaigns: [] } },
      { status: 201, headers: { location: `${MKT}/ad_campaign/C1` } },
      { json: { ads: [] } },
      { status: 201, headers: { location: `${MKT}/ad_campaign/C1/ad/AD1` } },
    ]);
    const r = await ebay.promoteListing('L1', 0.025);
    expect(r).toEqual({ campaignId: 'C1', adId: 'AD1', ratePct: 0.025 });
    const u = new URL(f.calls[0]?.url ?? '');
    expect(u.origin + u.pathname).toBe(`${MKT}/ad_campaign`);
    expect(u.searchParams.get('campaign_name')).toBe(AD_CAMPAIGN_NAME);
    expect(f.calls[1]?.method).toBe('POST');
    expect(jsonBody(f.calls[1])).toMatchObject({ campaignName: AD_CAMPAIGN_NAME, marketplaceId: 'EBAY_US', fundingStrategy: { fundingModel: 'COST_PER_SALE' } });
    expect(f.calls[2]?.url).toBe(`${MKT}/ad_campaign/C1/ad?listing_ids=L1`);
    expect(f.calls[3]?.url).toBe(`${MKT}/ad_campaign/C1/ad`);
    expect(jsonBody(f.calls[3])).toEqual({ listingId: 'L1', bidPercentage: '2.5' });
  });

  it('reuses an existing campaign and an existing ad at the same rate: no writes', async () => {
    const { f, ebay } = ebayWith([{ json: campaignRow() }, { json: { ads: [{ adId: 'AD9', listingId: 'L1', bidPercentage: '2.0', adStatus: 'ACTIVE' }] } }]);
    expect(await ebay.promoteListing('L1', 0.02)).toEqual({ campaignId: 'C1', adId: 'AD9', ratePct: 0.02 });
    expect(f.calls.map((c) => c.method)).toEqual(['GET', 'GET']);
  });

  it('changes the rate of an existing ad with update_bid', async () => {
    const { f, ebay } = ebayWith([{ json: campaignRow() }, { json: { ads: [{ adId: 'AD9', listingId: 'L1', bidPercentage: '2.0' }] } }, { status: 204 }]);
    await ebay.promoteListing('L1', 0.05);
    expect(f.calls[2]?.url).toBe(`${MKT}/ad_campaign/C1/ad/AD9/update_bid`);
    expect(jsonBody(f.calls[2])).toEqual({ bidPercentage: '5.0' });
  });

  it('caches the campaign id: a second promote does not look the campaign up again', async () => {
    const { f, ebay } = ebayWith([{ json: campaignRow() }, { json: { ads: [{ adId: 'A1', listingId: 'L1', bidPercentage: '2.0' }] } }, { json: { ads: [{ adId: 'A2', listingId: 'L2', bidPercentage: '2.0' }] } }]);
    await ebay.promoteListing('L1', 0.02);
    await ebay.promoteListing('L2', 0.02);
    expect(f.calls.filter((c) => c.url.includes('campaign_name'))).toHaveLength(1);
  });

  it('resumes a paused campaign', async () => {
    const { f, ebay } = ebayWith([{ json: campaignRow('PAUSED') }, { status: 204 }, { json: { ads: [{ adId: 'A1', listingId: 'L1', bidPercentage: '2.0' }] } }]);
    await ebay.promoteListing('L1', 0.02);
    expect(f.calls[1]?.url).toBe(`${MKT}/ad_campaign/C1/resume`);
  });

  it('recovers from a duplicate-campaign race by looking it up again', async () => {
    const { ebay } = ebayWith([
      { json: { campaigns: [] } },
      { status: 409, json: { errors: [{ errorId: 35002, message: 'duplicate name' }] } },
      { json: campaignRow() },
      { json: { ads: [{ adId: 'A1', listingId: 'L1', bidPercentage: '2.0' }] } },
    ]);
    expect((await ebay.promoteListing('L1', 0.02)).campaignId).toBe('C1');
  });

  it('recovers when the ad already exists (lost response on a previous try)', async () => {
    const { ebay } = ebayWith([{ json: campaignRow() }, { json: { ads: [] } }, { status: 409, json: { errors: [{ message: 'ad exists' }] } }, { json: { ads: [{ adId: 'A7', listingId: 'L1', bidPercentage: '2.0' }] } }]);
    expect((await ebay.promoteListing('L1', 0.02)).adId).toBe('A7');
  });

  it('falls back to a lookup when eBay sends no Location header', async () => {
    const { ebay } = ebayWith([{ json: campaignRow() }, { json: { ads: [] } }, { status: 201 }, { json: { ads: [{ adId: 'A8', listingId: 'L1', bidPercentage: '2.0' }] } }]);
    expect((await ebay.promoteListing('L1', 0.02)).adId).toBe('A8');
  });

  it('tells the seller to reconnect when the token lacks the marketing permission (403)', async () => {
    const { ebay } = ebayWith([{ status: 403, json: { errors: [{ errorId: 1100, message: 'Insufficient permissions' }] } }]);
    const err = await ebay.promoteListing('L1', 0.02).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EbayReauthRequiredError);
    expect((err as Error).message).toMatch(/Reconnect eBay/);
  });

  it('passes other eBay errors through', async () => {
    const { ebay } = ebayWith([{ json: campaignRow() }, { json: { ads: [] } }, { status: 500, json: { errors: [{ message: 'boom' }] } }]);
    await expect(ebay.promoteListing('L1', 0.02)).rejects.toBeInstanceOf(EbayApiError);
  });

  it('refuses a rate outside eBay bounds before any request', async () => {
    const { f, ebay } = ebayWith([]);
    await expect(ebay.promoteListing('L1', 0.01)).rejects.toThrow(RangeError);
    expect(f.calls).toHaveLength(0);
  });

  it('unpromoteListing deletes the ad, is a no-op when there is none, and never creates a campaign', async () => {
    const a = ebayWith([{ json: campaignRow() }, { json: { ads: [{ adId: 'AD1', listingId: 'L1' }] } }, { status: 204 }]);
    await a.ebay.unpromoteListing('L1');
    expect(a.f.calls[2]).toMatchObject({ method: 'DELETE', url: `${MKT}/ad_campaign/C1/ad/AD1` });
    const b = ebayWith([{ json: { campaigns: [] } }]);
    await b.ebay.unpromoteListing('L1');
    expect(b.f.calls).toHaveLength(1);
    const c = ebayWith([{ json: campaignRow() }, { json: { ads: [] } }]);
    await c.ebay.unpromoteListing('L1');
    expect(c.f.calls.every((x) => x.method === 'GET')).toBe(true);
  });

  it('endListing removes the ad first, and still ends the listing when the ad cleanup fails', async () => {
    const offers = { json: { offers: [{ offerId: 'OFF1', status: 'PUBLISHED', listing: { listingId: 'L1' } }] } };
    const ok = ebayWith([offers, { json: campaignRow() }, { json: { ads: [{ adId: 'AD1', listingId: 'L1' }] } }, { status: 204 }, { json: {} }]);
    await new RealEbay({ ...baseCfg, fetch: ok.f.fetch, tokenStore: memoryStore(fresh()), resolveSku: async () => 'S' }).endListing('L1');
    expect(ok.f.calls[3]?.method).toBe('DELETE');
    expect(ok.f.calls[4]?.url).toMatch(/withdraw$/);
    const bad = ebayWith([offers, { status: 403, json: { errors: [{ message: 'no scope' }] } }, { json: {} }]);
    await new RealEbay({ ...baseCfg, fetch: bad.f.fetch, tokenStore: memoryStore(fresh()), resolveSku: async () => 'S' }).endListing('L1');
    expect(bad.f.calls[2]?.url).toMatch(/withdraw$/);
  });
});

describe('MockEbay promoted ads', () => {
  it('records promoted listings, re-rates in place, and forgets them when the listing ends', async () => {
    const m = new MockEbay();
    const { ebayItemId } = await m.createListing(listingInput);
    const a = await m.promoteListing(ebayItemId, 0.03);
    expect(m.promoted.get(ebayItemId)).toEqual(a);
    const b = await m.promoteListing(ebayItemId, 0.04);
    expect(b.adId).toBe(a.adId);
    expect(m.promoted.get(ebayItemId)?.ratePct).toBe(0.04);
    await m.unpromoteListing(ebayItemId);
    expect(m.promoted.size).toBe(0);
    await m.promoteListing(ebayItemId, 0.03);
    await m.endListing(ebayItemId);
    expect(m.promoted.size).toBe(0);
    await expect(m.promoteListing(ebayItemId, 0.03)).rejects.toThrow(/ended/);
    await expect(m.promoteListing('nope', 0.03)).rejects.toThrow(/unknown/);
  });
});
