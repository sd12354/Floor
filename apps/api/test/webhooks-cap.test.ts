import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, publishOne, type TestApp } from './helpers.js';

interface OrderShape {
  id: string;
  status: string;
  supplierOrderId?: string;
  supplierCostCents?: number;
  supplierShippingCents?: number;
}

const shipTo = { name: 'Buyer', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' };

describe('webhook idempotency', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => t.close());

  it('duplicate eBay notification is a no-op (one supplier order, one set of ledger entries)', async () => {
    const listing = await publishOne(t, 'yoga');
    const body = { ebayOrderId: 'ebay-123', listingId: listing.id, buyerName: 'Grace Hopper', shipTo, salePriceCents: listing.priceCents, buyerShippingCents: 0 };
    const first = await t.api<{ duplicate: boolean; order: OrderShape }>('POST', '/webhooks/ebay', body);
    expect(first.status).toBe(201);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.order.status).toBe('ordered');
    const supplierOrders = t.connectors.mockSupplier?.orderCount;

    const second = await t.api<{ duplicate: boolean; order: OrderShape }>('POST', '/webhooks/ebay', body);
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.order.id).toBe(first.body.order.id);
    expect(second.body.order.supplierOrderId).toBe(first.body.order.supplierOrderId);
    expect(t.connectors.mockSupplier?.orderCount).toBe(supplierOrders);
    expect(await t.db.order.count({ where: { ebayOrderId: 'ebay-123' } })).toBe(1);
    expect(await t.db.ledgerEntry.count({ where: { orderId: first.body.order.id } })).toBe(4);
    expect(await t.db.event.count({ where: { orderId: first.body.order.id, type: 'order.ordered' } })).toBe(1);
  });

  it('resolves listings by ebayItemId and validates payloads', async () => {
    const listing = await publishOne(t, 'headlamp');
    const row = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    const res = await t.api<{ order: OrderShape }>('POST', '/webhooks/ebay', { ebayOrderId: 'ebay-456', ebayItemId: row.ebayItemId, buyerName: 'B', shipTo, salePriceCents: listing.priceCents });
    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe('ordered');
    const bad = await t.api<{ error: { code: string } }>('POST', '/webhooks/ebay', { ebayOrderId: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION');
  });
});

describe('daily spend cap', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ dailySpendCapCents: 2000 });
  });
  afterAll(async () => t.close());

  it('queues when today\'s spend + cost exceeds the cap and drains after the cap is raised', async () => {
    const listing = await publishOne(t, 'massage');
    const first = await t.api<OrderShape>('POST', '/orders/simulate', { listingId: listing.id });
    const landed = (first.body.supplierCostCents ?? 0) + (first.body.supplierShippingCents ?? 0);
    if (first.body.status === 'queued') {
      // Product too expensive for a single order under the cap: fine, that is a queue too.
      expect(landed).toBeGreaterThan(2000);
    } else {
      expect(first.body.status).toBe('ordered');
      const second = await t.api<OrderShape>('POST', '/orders/simulate', { listingId: listing.id });
      expect(second.body.status).toBe('queued');
      expect(second.body.supplierOrderId).toBeUndefined();
    }
    const queuedBefore = await t.db.order.count({ where: { status: 'queued' } });
    expect(queuedBefore).toBeGreaterThanOrEqual(1);

    // Draining with the same cap does nothing.
    await t.app.jobs.drainQueue();
    expect(await t.db.order.count({ where: { status: 'queued' } })).toBe(queuedBefore);

    await t.api('PATCH', '/account', { dailySpendCapCents: 1_000_000 });
    await t.app.jobs.drainQueue();
    expect(await t.db.order.count({ where: { status: 'queued' } })).toBe(0);
    const ordered = await t.db.order.findMany({ where: { status: 'ordered' } });
    expect(ordered.every((o) => o.supplierOrderId)).toBe(true);
    for (const o of ordered) expect(await t.db.ledgerEntry.count({ where: { orderId: o.id } })).toBe(4);
  });
});
