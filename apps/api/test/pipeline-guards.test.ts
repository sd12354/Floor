import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STUCK_CHECKING_MS } from '../src/services/scheduler.js';
import { createTestApp, publishOne, type TestApp } from './helpers.js';

interface OrderShape {
  id: string;
  status: string;
  supplierOrderId?: string;
  ladderDecision?: { action: string; reason: string };
}

const shipTo = { name: 'Buyer', line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' };

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

describe('pipeline guards', () => {
  it('concurrent duplicate webhooks create one order and one supplier order', async () => {
    const listing = await publishOne(t, 'garden bed');
    const body = { ebayOrderId: 'ebay-race', listingId: listing.id, buyerName: 'Race', shipTo, salePriceCents: listing.priceCents };
    const before = t.connectors.mockSupplier?.orderCount ?? 0;
    const results = await Promise.all([1, 2, 3].map(() => t.api<{ duplicate: boolean; order: OrderShape }>('POST', '/webhooks/ebay', body)));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect(await t.db.order.count({ where: { ebayOrderId: 'ebay-race' } })).toBe(1);
    expect(t.connectors.mockSupplier?.orderCount).toBe(before + 1);
    const order = await t.db.order.findUniqueOrThrow({ where: { ebayOrderId: 'ebay-race' } });
    expect(order.status).toBe('ordered');
    expect(await t.db.ledgerEntry.count({ where: { orderId: order.id } })).toBe(4);
  });

  it('fulfil decision on a held order re-checks stock: 0 -> cancelled out_of_stock, no supplier order', async () => {
    const listing = await publishOne(t, 'garden bed');
    const sku = listing.product.supplierSku;
    const res = await t.api<OrderShape>('POST', '/orders/simulate', { listingId: listing.id, priceDriftPct: 60 });
    expect(res.body.status).toBe('held');
    t.connectors.mockSupplier?.setSku(sku, { stock: 0 });
    const before = t.connectors.mockSupplier?.orderCount ?? 0;
    const dec = await t.api<OrderShape>('POST', `/orders/${res.body.id}/decision`, { action: 'fulfil' });
    expect(dec.status).toBe(200);
    expect(dec.body.status).toBe('cancelled');
    expect(t.connectors.mockSupplier?.orderCount).toBe(before);
    expect(await t.db.ledgerEntry.count({ where: { orderId: res.body.id } })).toBe(0);
    t.connectors.mockSupplier?.setSku(sku, { costCents: listing.product.costCents, stock: 50 });
  });

  it('a held order approved under the cap is queued and drains as ordered (approval survives the drain)', async () => {
    const listing = await publishOne(t, 'garden bed');
    const sku = listing.product.supplierSku;
    const res = await t.api<OrderShape>('POST', '/orders/simulate', { listingId: listing.id, priceDriftPct: 60 });
    expect(res.body.status).toBe('held');
    await t.api('PATCH', '/account', { dailySpendCapCents: 1 });
    const dec = await t.api<OrderShape>('POST', `/orders/${res.body.id}/decision`, { action: 'fulfil' });
    expect(dec.body.status).toBe('queued');
    await t.app.jobs.drainQueue();
    expect((await t.db.order.findUniqueOrThrow({ where: { id: res.body.id } })).status).toBe('queued');
    await t.api('PATCH', '/account', { dailySpendCapCents: 1_000_000 });
    await t.app.jobs.drainQueue();
    const row = await t.db.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.status).toBe('ordered');
    expect(row.supplierOrderId).toMatch(/^MOCK-/);
    expect(await t.db.ledgerEntry.count({ where: { orderId: res.body.id } })).toBe(4);
    t.connectors.mockSupplier?.setSku(sku, { costCents: listing.product.costCents, stock: 50 });
  });

  it('an order stuck in checking is picked up by the drain, and the drain never double-books', async () => {
    const listing = await publishOne(t, 'garden bed');
    const res = await t.api<OrderShape>('POST', '/orders/simulate', { listingId: listing.id });
    expect(res.body.status).toBe('ordered');
    // Simulate a request that died after `checking` (supplier call threw before the ladder ran).
    const src = await t.db.order.findUniqueOrThrow({ where: { id: res.body.id } });
    const stuck = await t.db.order.create({
      data: {
        id: 'ord_stuck',
        accountId: src.accountId,
        listingId: src.listingId,
        ebayOrderId: 'ebay-stuck',
        buyerName: src.buyerName,
        shipTo: shipTo,
        salePriceCents: src.salePriceCents,
        buyerShippingCents: src.buyerShippingCents,
        status: 'checking',
        updatedAt: new Date(Date.now() - 2 * STUCK_CHECKING_MS),
      },
    });
    const before = t.connectors.mockSupplier?.orderCount ?? 0;
    await t.app.jobs.drainQueue();
    const row = await t.db.order.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(row.status).toBe('ordered');
    expect(t.connectors.mockSupplier?.orderCount).toBe(before + 1);
    // Re-running the drain is a no-op for already-ordered rows.
    await t.app.jobs.drainQueue();
    expect(await t.db.ledgerEntry.count({ where: { orderId: stuck.id } })).toBe(4);
    expect(await t.db.ledgerEntry.count({ where: { orderId: res.body.id } })).toBe(4);
  });

  it('a brand added to the blocklist after publish blocks the listing on the next sync and cancels its orders', async () => {
    const listing = await publishOne(t, 'headlamp');
    const row = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    const word = row.title.split(' ').find((w) => /^[A-Za-z]{4,}$/.test(w)) as string;
    await t.db.blockedBrand.create({ data: { id: 'brd_test', pattern: word, source: 'vero_notice' } });
    const sync = await t.api<{ blocked: number }>('POST', '/listings/sync');
    expect(sync.body.blocked).toBeGreaterThanOrEqual(1);
    const after = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(after.status).toBe('blocked');
    expect(after.pauseReason).toBe('VERO_MATCH');
    expect(t.connectors.mockEbay?.listings.get(after.ebayItemId as string)?.quantity).toBe(0);

    // Pre-order gate: a webhook for the blocked listing is cancelled, no supplier order.
    const before = t.connectors.mockSupplier?.orderCount ?? 0;
    const hook = await t.api<{ order: OrderShape }>('POST', '/webhooks/ebay', { ebayOrderId: 'ebay-blocked', listingId: listing.id, buyerName: 'B', shipTo, salePriceCents: listing.priceCents });
    expect(hook.body.order.status).toBe('cancelled');
    expect(t.connectors.mockSupplier?.orderCount).toBe(before);
    const ev = await t.db.event.findFirst({ where: { orderId: hook.body.order.id, type: 'order.cancelled' } });
    expect(ev?.payload).toMatchObject({ reason: 'compliance', compliance: { code: 'VERO_MATCH' } });

    // PATCH title into a blocked brand is refused.
    const other = await publishOne(t, 'yoga');
    const patched = await t.api<{ error: { code: string } }>('PATCH', `/listings/${other.id}`, { title: `Nike ${other.id} mat` });
    expect(patched.status).toBe(422);
    expect(patched.body.error.code).toBe('VERO_MATCH');
    await t.db.blockedBrand.delete({ where: { id: 'brd_test' } });
  });
});
