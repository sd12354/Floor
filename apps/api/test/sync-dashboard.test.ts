import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, publishOne, type TestApp } from './helpers.js';

interface Dashboard {
  float: { outstandingCents: number; byOrder: { orderId: string; amountCents: number; listingTitle: string; payoutExpectedAt: string | null }[] };
  today: { orders: number; revenueCents: number; profitCents: number; supplierSpendCents: number; spendCapCents: number };
  health: { lateShipmentPct: number; defectPct: number; casesOpen: number; thresholds: { lateShipmentPct: number; defectPct: number } };
  listings: { active: number; paused: number; draft: number; blocked: number };
  recentEvents: { type: string }[];
}

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

describe('sync', () => {
  it('pauses a listing when the supplier price jumps above the floor and resumes when it falls back', async () => {
    const listing = await publishOne(t, 'scale');
    const sku = listing.product.supplierSku;
    const baseCost = listing.product.costCents;

    // Big jump: target would move > 25%, so we do not silently reprice; the listing pauses instead.
    t.connectors.mockSupplier?.setSku(sku, { costCents: Math.round(baseCost * 2.2) });
    const s1 = await t.api<{ repriced: number; paused: number; resumed: number }>('POST', '/listings/sync');
    expect(s1.status).toBe(200);
    expect(s1.body.paused).toBe(1);
    let row = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.status).toBe('paused');
    expect(row.pauseReason).toBe('below_floor');
    expect(row.floorPriceCents).toBeGreaterThan(row.priceCents);
    expect(t.connectors.mockEbay?.listings.get(row.ebayItemId as string)?.quantity).toBe(0);

    // Price falls back: resumed, floor recomputed.
    t.connectors.mockSupplier?.setSku(sku, { costCents: baseCost });
    const s2 = await t.api<{ repriced: number; paused: number; resumed: number }>('POST', '/listings/sync');
    expect(s2.body.resumed).toBe(1);
    row = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.status).toBe('active');
    expect(row.pauseReason).toBeNull();
    expect(row.floorPriceCents).toBe(listing.floorPriceCents);
    expect(t.connectors.mockEbay?.listings.get(row.ebayItemId as string)?.quantity).toBeGreaterThan(0);

    // Small move: repriced in place, stays active.
    t.connectors.mockSupplier?.setSku(sku, { costCents: Math.round(baseCost * 1.1) });
    const s3 = await t.api<{ repriced: number; paused: number }>('POST', '/listings/sync');
    expect(s3.body.repriced).toBe(1);
    expect(s3.body.paused).toBe(0);
    row = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.priceCents).toBeGreaterThan(listing.priceCents);
    expect(row.status).toBe('active');
    expect(row.lastSyncAt).not.toBeNull();

    // Stock 0 pauses; manual pauses are never auto-resumed.
    t.connectors.mockSupplier?.setSku(sku, { costCents: baseCost, stock: 0 });
    await t.api('POST', '/listings/sync');
    row = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.pauseReason).toBe('out_of_stock');
    t.connectors.mockSupplier?.setSku(sku, { stock: 40 });
    await t.api('POST', '/listings/sync');
    await t.api('PATCH', `/listings/${listing.id}`, { status: 'paused' });
    await t.api('POST', '/listings/sync');
    row = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row.status).toBe('paused');
    expect(row.pauseReason).toBe('manual');
    const events = await t.db.event.findMany({ where: { listingId: listing.id } });
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['listing.paused', 'listing.resumed', 'listing.repriced']));
  });

  it('scheduler sync drifts the mock supplier and sweeps every account', async () => {
    const before = await t.db.event.count({ where: { type: 'sync.completed' } });
    await t.app.jobs.sync();
    expect(await t.db.event.count({ where: { type: 'sync.completed' } })).toBe(before + 1);
  });
});

describe('dashboard & ledger', () => {
  it('float = supplier spend not yet paid out; today totals; listing counts', async () => {
    const listing = await publishOne(t, 'bowl');
    const a = await t.api<{ id: string; supplierCostCents: number; supplierShippingCents: number; salePriceCents: number; ebayFeesCents: number; netProfitCents: number }>('POST', '/orders/simulate', { listingId: listing.id });
    const b = await t.api<{ id: string; supplierCostCents: number; supplierShippingCents: number; salePriceCents: number; ebayFeesCents: number; netProfitCents: number }>('POST', '/orders/simulate', { listingId: listing.id });
    const landed = (o: typeof a.body) => o.supplierCostCents + o.supplierShippingCents;

    let d = await t.api<Dashboard>('GET', '/dashboard');
    expect(d.status).toBe(200);
    expect(d.body.float.outstandingCents).toBe(landed(a.body) + landed(b.body));
    expect(d.body.float.byOrder).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ orderId: a.body.id, amountCents: landed(a.body), listingTitle: expect.any(String) }),
        expect.objectContaining({ orderId: b.body.id, amountCents: landed(b.body) }),
      ]),
    );
    expect(d.body.today.orders).toBe(2);
    expect(d.body.today.revenueCents).toBe(a.body.salePriceCents + b.body.salePriceCents);
    expect(d.body.today.supplierSpendCents).toBe(landed(a.body) + landed(b.body));
    expect(d.body.today.profitCents).toBe(a.body.netProfitCents + b.body.netProfitCents);
    expect(d.body.today.spendCapCents).toBe(50000);
    expect(d.body.health.thresholds).toEqual({ lateShipmentPct: 0.03, defectPct: 0.005 });
    expect(d.body.listings.active).toBeGreaterThanOrEqual(1);
    expect(d.body.recentEvents.length).toBeGreaterThan(0);

    // Ship + deliver + pay out order A: it leaves the float, B stays.
    const t1 = new Date(Date.now() + 5000);
    await t.app.jobs.runTrackingPoll(t1);
    const t2 = new Date(t1.getTime() + 2 * 60_000);
    await t.app.jobs.runTrackingPoll(t2);
    d = await t.api<Dashboard>('GET', '/dashboard');
    expect(d.body.float.outstandingCents).toBe(landed(a.body) + landed(b.body));
    expect(d.body.float.byOrder.every((r) => r.payoutExpectedAt)).toBe(true);
    await t.app.jobs.runTrackingPoll(new Date(t2.getTime() + 4 * 24 * 3600_000));
    d = await t.api<Dashboard>('GET', '/dashboard');
    expect(d.body.float.outstandingCents).toBe(0);
    expect(d.body.float.byOrder).toHaveLength(0);

    const ledger = await t.api<{ entries: { kind: string }[]; totals: { revenueCents: number; feesCents: number; costCents: number; profitCents: number } }>('GET', '/ledger');
    expect(ledger.body.totals.revenueCents).toBe(a.body.salePriceCents + b.body.salePriceCents);
    expect(ledger.body.totals.feesCents).toBe(a.body.ebayFeesCents + b.body.ebayFeesCents);
    expect(ledger.body.totals.costCents).toBe(landed(a.body) + landed(b.body));
    expect(ledger.body.totals.profitCents).toBe(a.body.netProfitCents + b.body.netProfitCents);
    expect(ledger.body.entries.filter((e) => e.kind === 'payout')).toHaveLength(2);

    const csv = await t.app.inject({ method: 'GET', url: '/api/v1/ledger/export.csv', headers: { 'x-account-id': 'acc_demo', authorization: `Bearer ${t.seller.token}` } });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\n')[0]).toBe('id,at,kind,orderId,amountCents,amountUsd');
    const ranged = await t.api<{ entries: unknown[] }>('GET', '/ledger?from=2099-01-01');
    expect(ranged.body.entries).toHaveLength(0);
  });
});

describe('messages', () => {
  it('classifies inbound, suggests a reply, and reply marks it answered', async () => {
    const order = await t.db.order.findFirstOrThrow({ where: { status: { in: ['ordered', 'shipped', 'delivered'] } } });
    const inbound = await t.api<{ id: string; kind: string; suggestedReply: string; answered: boolean }>('POST', '/messages/inbound', { orderId: order.id, body: 'Where is my package?? tracking shows nothing' });
    expect(inbound.status).toBe(201);
    expect(inbound.body.kind).toBe('wismo');
    expect(inbound.body.answered).toBe(false);
    expect(inbound.body.suggestedReply).toContain('Hi');
    const cancel = await t.api<{ kind: string }>('POST', '/messages/inbound', { orderId: order.id, body: 'Please cancel this, I changed my mind' });
    expect(cancel.body.kind).toBe('cancel');
    const ret = await t.api<{ kind: string }>('POST', '/messages/inbound', { orderId: order.id, body: 'It arrived broken, I want a refund' });
    expect(ret.body.kind).toBe('return');
    const other = await t.api<{ kind: string }>('POST', '/messages/inbound', { orderId: order.id, body: 'Does this come in blue?' });
    expect(other.body.kind).toBe('other');

    const unanswered = await t.api<{ id: string }[]>('GET', '/messages?unansweredOnly=true');
    expect(unanswered.body.map((m) => m.id)).toContain(inbound.body.id);
    const reply = await t.api<{ direction: string; answered: boolean; kind: string }>('POST', `/messages/${inbound.body.id}/reply`, { body: inbound.body.suggestedReply });
    expect(reply.status).toBe(201);
    expect(reply.body.direction).toBe('out');
    expect(reply.body.kind).toBe('wismo');
    const after = await t.api<{ id: string }[]>('GET', '/messages?unansweredOnly=true');
    expect(after.body.map((m) => m.id)).not.toContain(inbound.body.id);
    const forOrder = await t.api<{ orderId: string }[]>('GET', `/messages?orderId=${order.id}`);
    expect(forOrder.body.every((m) => m.orderId === order.id)).toBe(true);
    const d = await t.api<Dashboard>('GET', '/dashboard');
    expect(d.body.health.casesOpen).toBe(2);
  });
});
