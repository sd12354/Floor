import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, publishOne, type TestApp } from './helpers.js';

interface OrderShape {
  id: string;
  status: string;
  ebayOrderId: string;
  supplierOrderId?: string;
  salePriceCents?: number;
  supplierCostCents?: number;
  supplierShippingCents?: number;
  ebayFeesCents?: number;
  netProfitCents?: number;
  ladderDecision?: { action: string; reason: string };
  holdDeadline?: string;
  trackingNumber?: string;
  payoutExpectedAt?: string;
  paidOutAt?: string;
  listing: { title: string };
}

interface OrderDetail extends OrderShape {
  events: { type: string; payload: Record<string, unknown> }[];
  messages: { kind: string; direction: string }[];
  ledger: { kind: string; amountCents: number }[];
}

let t: TestApp;
let listingId: string;
let sku: string;
let baseCost: number;

beforeAll(async () => {
  t = await createTestApp({ trackingDelayMs: 1000 });
  // A pricier product (~$34 cost) so a 60% supplier drift clearly drops the order below the margin floor.
  const l = await publishOne(t, 'garden bed');
  listingId = l.id;
  sku = l.product.supplierSku;
  baseCost = l.product.costCents;
});
afterAll(async () => t.close());

const resetCost = () => t.connectors.mockSupplier?.setSku(sku, { costCents: baseCost, stock: 50 });

describe('order pipeline', () => {
  it('simulate -> ordered with ledger entries, events and confirmation message', async () => {
    resetCost();
    const res = await t.api<OrderShape>('POST', '/orders/simulate', { listingId, buyerName: 'Ada Lovelace' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ordered');
    expect(res.body.supplierOrderId).toMatch(/^MOCK-/);
    expect(res.body.ladderDecision).toEqual({ action: 'fulfil', reason: 'within_tolerance' });
    expect(res.body.ebayFeesCents).toBeGreaterThan(0);
    expect(res.body.netProfitCents).toBeGreaterThan(0);
    expect(res.body.listing.title).toBeTruthy();

    const detail = await t.api<OrderDetail>('GET', `/orders/${res.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.listing.title).toBe(res.body.listing.title);
    const kinds = detail.body.ledger.map((e) => e.kind).sort();
    expect(kinds).toEqual(['ebay_fee', 'sale', 'supplier_cost', 'supplier_shipping']);
    const sale = detail.body.ledger.find((e) => e.kind === 'sale')?.amountCents;
    const cost = detail.body.ledger.find((e) => e.kind === 'supplier_cost')?.amountCents;
    expect(sale).toBeGreaterThan(0);
    expect(cost).toBeLessThan(0);
    expect(cost).toBe(-(res.body.supplierCostCents ?? 0));
    const types = detail.body.events.map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['order.paid', 'order.checking', 'order.checked', 'order.ladder', 'order.ordered']));
    expect(detail.body.messages).toEqual([expect.objectContaining({ kind: 'order_confirmed', direction: 'out' })]);
    expect(t.connectors.mockEbay?.messages.some((m) => m.ebayOrderId === res.body.ebayOrderId)).toBe(true);
  });

  it('priceDriftPct 60 -> held with contract deadline; decision fulfil places the supplier order', async () => {
    resetCost();
    const res = await t.api<OrderShape>('POST', '/orders/simulate', { listingId, priceDriftPct: 60 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('held');
    expect(res.body.ladderDecision).toMatchObject({ action: 'hold', reason: 'below_floor' });
    expect(res.body.holdDeadline).toBeTruthy();
    const created = await t.db.order.findUniqueOrThrow({ where: { id: res.body.id } });
    const expected = new Date(created.createdAt.getTime() + 3 * 24 * 3600_000 - 12 * 3600_000).toISOString();
    expect(res.body.holdDeadline).toBe(expected);
    expect(res.body.supplierOrderId).toBeUndefined();
    const ledgerBefore = await t.db.ledgerEntry.count({ where: { orderId: res.body.id } });
    expect(ledgerBefore).toBe(0);

    const dec = await t.api<OrderShape>('POST', `/orders/${res.body.id}/decision`, { action: 'fulfil' });
    expect(dec.status).toBe(200);
    expect(dec.body.status).toBe('ordered');
    expect(dec.body.supplierOrderId).toMatch(/^MOCK-/);
    expect(dec.body.netProfitCents).toBeLessThan(0);
    expect(await t.db.ledgerEntry.count({ where: { orderId: res.body.id } })).toBe(4);

    const again = await t.api<{ error: { code: string } }>('POST', `/orders/${res.body.id}/decision`, { action: 'cancel' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('ORDER_NOT_HELD');
  });

  it('decision cancel on a held order -> cancelled, no supplier order, no ledger', async () => {
    resetCost();
    const res = await t.api<OrderShape>('POST', '/orders/simulate', { listingId, priceDriftPct: 60 });
    expect(res.body.status).toBe('held');
    const before = t.connectors.mockSupplier?.orderCount ?? 0;
    const dec = await t.api<OrderShape>('POST', `/orders/${res.body.id}/decision`, { action: 'cancel' });
    expect(dec.body.status).toBe('cancelled');
    expect(t.connectors.mockSupplier?.orderCount).toBe(before);
    expect(await t.db.ledgerEntry.count({ where: { orderId: res.body.id } })).toBe(0);
    const detail = await t.api<OrderDetail>('GET', `/orders/${res.body.id}`);
    expect(detail.body.events.at(-1)?.type).toBe('order.cancelled');
  });

  it('a profitable order below the margin floor is held, never auto-fulfilled', async () => {
    resetCost();
    // Drift the cost so net profit lands at about +3% of the sale price: above zero, below the 10% floor.
    const probe = await t.api<OrderShape>('POST', '/orders/simulate', { listingId });
    const profit = probe.body.netProfitCents ?? 0;
    const sale = probe.body.salePriceCents ?? 0;
    const driftPct = ((profit - Math.round(sale * 0.03)) / baseCost) * 100;
    const res = await t.api<OrderShape>('POST', '/orders/simulate', { listingId, priceDriftPct: driftPct });
    expect(res.body.netProfitCents).toBeGreaterThan(0);
    expect(res.body.status).toBe('held');
    expect(res.body.ladderDecision).toMatchObject({ action: 'hold', reason: 'below_floor' });
    expect(res.body.supplierOrderId).toBeUndefined();
  });

  it('out of stock -> cancelled (out_of_stock)', async () => {
    resetCost();
    t.connectors.mockSupplier?.setSku(sku, { stock: 0 });
    const res = await t.api<OrderShape>('POST', '/orders/simulate', { listingId });
    expect(res.body.status).toBe('cancelled');
    expect(res.body.ladderDecision).toBeUndefined();
    const detail = await t.api<OrderDetail>('GET', `/orders/${res.body.id}`);
    expect(detail.body.events.find((e) => e.type === 'order.cancelled')?.payload).toMatchObject({ reason: 'out_of_stock' });
    resetCost();
  });

  it('held orders past deadline are cancelled by the scheduler (no_decision)', async () => {
    resetCost();
    const res = await t.api<OrderShape>('POST', '/orders/simulate', { listingId, priceDriftPct: 60 });
    expect(res.body.status).toBe('held');
    await t.app.jobs.cancelExpiredHolds(new Date(Date.now() + 10 * 24 * 3600_000));
    const row = await t.db.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.status).toBe('cancelled');
    const ev = await t.db.event.findFirst({ where: { orderId: res.body.id, type: 'order.cancelled' } });
    expect(ev?.payload).toMatchObject({ reason: 'no_decision' });
  });

  it('tracking poll -> shipped (eBay fulfillment + message); delivery -> payout when due', async () => {
    resetCost();
    const res = await t.api<OrderShape>('POST', '/orders/simulate', { listingId });
    expect(res.body.status).toBe('ordered');
    await t.app.jobs.runTrackingPoll(new Date());
    expect((await t.db.order.findUniqueOrThrow({ where: { id: res.body.id } })).status).toBe('ordered');

    const later = new Date(Date.now() + 5000);
    await t.app.jobs.runTrackingPoll(later);
    let row = await t.db.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.status).toBe('shipped');
    expect(row.trackingNumber).toMatch(/^9400/);
    expect(t.connectors.mockEbay?.fulfillments.some((f) => f.ebayOrderId === res.body.ebayOrderId)).toBe(true);

    // Mock delivery after MOCK_DELIVERY_DELAY_MS (default 60s): advance the clock.
    const afterDelivery = new Date(Date.now() + 2 * 60_000);
    await t.app.jobs.runTrackingPoll(afterDelivery);
    row = await t.db.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.status).toBe('delivered');
    expect(row.payoutExpectedAt?.getTime()).toBe(afterDelivery.getTime() + 3 * 24 * 3600_000);
    expect(row.paidOutAt).toBeNull();

    await t.app.jobs.runTrackingPoll(new Date(afterDelivery.getTime() + 4 * 24 * 3600_000));
    row = await t.db.order.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.paidOutAt).not.toBeNull();
    const payout = await t.db.ledgerEntry.findFirst({ where: { orderId: res.body.id, kind: 'payout' } });
    expect(payout?.amountCents).toBe(row.salePriceCents + row.buyerShippingCents - (row.ebayFeesCents ?? 0));
    const msgs = await t.db.message.findMany({ where: { orderId: res.body.id }, orderBy: { at: 'asc' } });
    expect(msgs.map((m) => m.kind)).toEqual(['order_confirmed', 'shipped', 'delivered']);
  });

  it('GET /orders lists with listing title and filters by status', async () => {
    const res = await t.api<{ items: OrderShape[]; total: number }>('GET', '/orders?status=cancelled');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.items.every((o) => o.status === 'cancelled')).toBe(true);
    expect(res.body.items[0]?.listing.title).toBeTruthy();
  });

  it('simulate validates listing state', async () => {
    const nope = await t.api<{ error: { code: string } }>('POST', '/orders/simulate', { listingId: 'lst_nope' });
    expect(nope.status).toBe(404);
  });
});
