import { MockEbay } from '@floor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountPricing } from '../src/services/pricingService.js';
import { runSync } from '../src/services/syncService.js';
import { createTestApp, publishOne, type TestApp } from './helpers.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => t.close());

const mock = () => t.connectors.ebay as MockEbay;
const listing = (id: string) => t.db.listing.findUniqueOrThrow({ where: { id } });
const account = () => t.db.account.findUniqueOrThrow({ where: { id: 'acc_demo' } });
const events = (type: string) => t.db.event.findMany({ where: { type } });
type Acc = { promotedAdsEnabled: boolean; promotedAdRatePct: number; promotedAdsPending: number; fees: { promotedPct: number } };

describe('promoted ads settings', () => {
  it('are off by default at 2%, and validate the rate against eBay bounds', async () => {
    const a = await t.api<Acc>('GET', '/account');
    expect(a.body).toMatchObject({ promotedAdsEnabled: false, promotedAdRatePct: 0.02, promotedAdsPending: 0 });
    expect((await t.api('PATCH', '/account', { promotedAdRatePct: 0.01 })).status).toBe(400);
    expect((await t.api('PATCH', '/account', { promotedAdRatePct: 1.5 })).status).toBe(400);
    expect((await t.api('PATCH', '/account', { promotedAdsEnabled: 'yes' })).status).toBe(400);
    const ok = await t.api<Acc>('PATCH', '/account', { promotedAdRatePct: 0.0254 });
    expect(ok.body.promotedAdRatePct).toBe(0.025);
  });

  it('the ad rate replaces (never adds to) the stored promotedPct, and only while the switch is on', async () => {
    await t.api('PATCH', '/account', { fees: { promotedPct: 0.03 } });
    expect(accountPricing(await account()).fees.promotedPct).toBe(0.03);
    await t.api('PATCH', '/account', { promotedAdsEnabled: true, promotedAdRatePct: 0.05 });
    expect(accountPricing(await account()).fees.promotedPct).toBe(0.05);
    const shown = await t.api<Acc>('GET', '/account');
    expect(shown.body.fees.promotedPct).toBe(0.03); // the stored table is untouched
    await t.api('PATCH', '/account', { promotedAdsEnabled: false });
    expect(accountPricing(await account()).fees.promotedPct).toBe(0.03);
  });
});

describe('promoted ads on listings', () => {
  it('a listing published while off is not promoted', async () => {
    const l = await publishOne(t);
    expect((await listing(l.id)).promotedRatePct).toBeNull();
    expect(mock().promoted.size).toBe(0);
  });

  it('switching on reprices live listings up, promotes them at the rate; switching off reprices down and removes the ads', async () => {
    const l = await publishOne(t);
    const before = await listing(l.id);
    const on = await t.api<Acc>('PATCH', '/account', { promotedAdsEnabled: true, promotedAdRatePct: 0.05 });
    expect(on.status).toBe(200);
    const after = await listing(l.id);
    expect(after.priceCents).toBeGreaterThan(before.priceCents);
    expect(after.floorPriceCents).toBeGreaterThan(before.floorPriceCents);
    expect(after.status).toBe('active');
    expect(after.promotedRatePct).toBe(0.05);
    expect(mock().promoted.get(after.ebayItemId as string)?.ratePct).toBe(0.05);
    expect(mock().listings.get(after.ebayItemId as string)?.priceCents).toBe(after.priceCents);
    expect(after.projectedMarginPct).toBeGreaterThanOrEqual(0.19);
    const api = await t.api<{ items: { id: string; promoted: boolean; promotedRatePct?: number }[] }>('GET', '/listings');
    expect(api.body.items.find((x) => x.id === l.id)).toMatchObject({ promoted: true, promotedRatePct: 0.05 });

    await t.api('PATCH', '/account', { promotedAdsEnabled: false });
    const off = await listing(l.id);
    expect(off.priceCents).toBe(before.priceCents);
    expect(off.promotedRatePct).toBeNull();
    expect(mock().promoted.size).toBe(0);
  });

  it('a listing published while on is promoted right away, at the rate', async () => {
    await t.api('PATCH', '/account', { promotedAdsEnabled: true, promotedAdRatePct: 0.03 });
    const l = await publishOne(t);
    const row = await listing(l.id);
    expect(row.promotedRatePct).toBe(0.03);
    expect(row.promotedAdId).toBeTruthy();
    expect(row.priceCents).toBeGreaterThanOrEqual(row.floorPriceCents);
  });

  it('changing the rate re-rates the ad and reprices', async () => {
    await t.api('PATCH', '/account', { promotedAdsEnabled: true, promotedAdRatePct: 0.03 });
    const l = await publishOne(t);
    const p3 = (await listing(l.id)).priceCents;
    await t.api('PATCH', '/account', { promotedAdRatePct: 0.08 });
    const row = await listing(l.id);
    expect(row.priceCents).toBeGreaterThan(p3);
    expect(row.promotedRatePct).toBe(0.08);
    expect(mock().promoted.get(row.ebayItemId as string)?.ratePct).toBe(0.08);
  });

  it('a listing that cannot clear the floor at the new rate is paused with its ad removed, never left selling below floor', async () => {
    const l = await publishOne(t);
    const before = await listing(l.id);
    const tooHigh = await t.api<{ error: { message: string } }>('PATCH', '/account', { promotedAdsEnabled: true, promotedAdRatePct: 0.9 });
    expect(tooHigh.status).toBe(400); // fees + ad rate + target margin >= 100%: refused up front
    expect(tooHigh.body.error.message).toMatch(/too high/);
    expect((await account()).promotedAdsEnabled).toBe(false);
    await t.api('PATCH', '/account', { promotedAdsEnabled: true, promotedAdRatePct: 0.5 });
    const row = await listing(l.id);
    expect(row.status).toBe('paused');
    expect(row.pauseReason).toBe('below_floor');
    expect(row.priceCents).toBe(before.priceCents); // a jump this big needs a human: price untouched
    expect(row.floorPriceCents).toBeGreaterThan(row.priceCents);
    expect(row.promotedRatePct).toBeNull();
    expect(mock().promoted.size).toBe(0);
    expect(mock().listings.get(row.ebayItemId as string)?.quantity).toBe(0); // nothing can sell
    // back to a sane rate: it reprices within the step limit and resumes
    await t.api('PATCH', '/account', { promotedAdsEnabled: false });
    expect((await listing(l.id)).status).toBe('active');
  });

  it('pausing a listing by hand removes its ad; resuming puts it back', async () => {
    await t.api('PATCH', '/account', { promotedAdsEnabled: true });
    const l = await publishOne(t);
    await t.api('PATCH', `/listings/${l.id}`, { status: 'paused' });
    expect((await listing(l.id)).promotedRatePct).toBeNull();
    expect(mock().promoted.size).toBe(0);
    await t.api('PATCH', `/listings/${l.id}`, { status: 'active' });
    expect((await listing(l.id)).promotedRatePct).toBe(0.02);
  });
});

describe('unreachable fees', () => {
  it('the sweep pauses (instead of failing) when no price can reach the floor margin under the fees', async () => {
    const l = await publishOne(t);
    // bypass the API guard: a fee table that leaves no room (13.6% + 90% ad rate)
    await t.db.account.update({ where: { id: 'acc_demo' }, data: { promotedAdsEnabled: true, promotedAdRatePct: 0.9 } });
    const r = await runSync(t.db, t.connectors, await account());
    expect(r.paused).toBe(1);
    const row = await listing(l.id);
    expect(row).toMatchObject({ status: 'paused', pauseReason: 'below_floor', promotedRatePct: null });
    expect(mock().listings.get(row.ebayItemId as string)?.quantity).toBe(0);
  });
});

describe('promoted ads failures never block a listing', () => {
  it('publish succeeds when the ad call fails; it logs listing.promote_failed and the next sync retries', async () => {
    await t.api('PATCH', '/account', { promotedAdsEnabled: true });
    const spy = vi.spyOn(mock(), 'promoteListing').mockRejectedValue(new Error('Reconnect eBay: marketing permission missing'));
    const l = await publishOne(t);
    const row = await listing(l.id);
    expect(row.status).toBe('active');
    expect(row.ebayItemId).toMatch(/^mock-/);
    expect(row.promotedRatePct).toBeNull();
    const failed = await events('listing.promote_failed');
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0]?.payload)).toContain('Reconnect eBay');
    expect((await t.api<Acc>('GET', '/account')).body.promotedAdsPending).toBe(1);

    spy.mockRestore();
    await runSync(t.db, t.connectors, await account());
    expect((await listing(l.id)).promotedRatePct).toBe(0.02);
    expect(mock().promoted.size).toBe(1);
    expect((await t.api<Acc>('GET', '/account')).body.promotedAdsPending).toBe(0);
  });

  it('a failed ad removal is retried and keeps the listing state', async () => {
    await t.api('PATCH', '/account', { promotedAdsEnabled: true });
    const l = await publishOne(t);
    vi.spyOn(mock(), 'unpromoteListing').mockRejectedValueOnce(new Error('eBay is down'));
    await t.api('PATCH', '/account', { promotedAdsEnabled: false });
    expect((await listing(l.id)).promotedRatePct).toBe(0.02);
    expect(await events('listing.unpromote_failed')).toHaveLength(1);
    await runSync(t.db, t.connectors, await account());
    expect((await listing(l.id)).promotedRatePct).toBeNull();
  });

  it('a repricing failure still saves the setting', async () => {
    vi.spyOn(t.connectors, 'mockSupplier', 'get').mockReturnValue(undefined);
    const res = await t.api<Acc>('PATCH', '/account', { promotedAdsEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body.promotedAdsEnabled).toBe(true);
  });
});
