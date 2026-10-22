import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import type { Account, Order } from '../generated/prisma/client.js';
import { writeEvent, writeLedger } from './audit.js';
import { sendOutbound } from './messages.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const PAYOUT_DELAY_DAYS = 3;
export const NEW_SELLER_PAYOUT_DELAY_DAYS = 30;

/** Poll the supplier for tracking on every `ordered` order; shipped ones get an eBay fulfillment + message. */
export async function pollTracking(db: Db, connectors: Connectors, account: Account, now = new Date()): Promise<{ shipped: number }> {
  const orders = await db.order.findMany({ where: { accountId: account.id, status: 'ordered', supplierOrderId: { not: null } }, include: { listing: { include: { product: true } } } });
  let shipped = 0;
  for (const order of orders) {
    const supplier = connectors.supplier(order.listing.product.supplier);
    const tracking = await supplier.getTracking(order.supplierOrderId as string, now);
    if (!tracking) continue;
    await markShipped(db, connectors, order, order.listing.title, tracking.trackingNumber, tracking.carrier, tracking.shippedAt);
    shipped += 1;
  }
  return { shipped };
}

export async function markShipped(db: Db, connectors: Connectors, order: Order, listingTitle: string, trackingNumber: string, carrier: string, shippedAt: string): Promise<Order> {
  if (order.status !== 'ordered') return order;
  await connectors.ebay.createShippingFulfillment({ ebayOrderId: order.ebayOrderId, trackingNumber, carrier, shippedAt });
  const updated = await db.order.update({ where: { id: order.id }, data: { status: 'shipped', trackingNumber, carrier } });
  await writeEvent(db, { accountId: order.accountId, orderId: order.id, type: 'order.shipped', payload: { trackingNumber, carrier, shippedAt } });
  await sendOutbound(db, connectors, updated, listingTitle, 'shipped');
  return updated;
}

/** Mark delivered and schedule the payout (+3 days, or +30 for new-seller accounts). */
export async function markDelivered(db: Db, connectors: Connectors, account: Account, order: Order, listingTitle: string, now = new Date()): Promise<Order> {
  if (order.status !== 'shipped') return order;
  const delayDays = account.newSeller ? NEW_SELLER_PAYOUT_DELAY_DAYS : PAYOUT_DELAY_DAYS;
  const payoutExpectedAt = new Date(now.getTime() + delayDays * DAY_MS);
  const updated = await db.order.update({ where: { id: order.id }, data: { status: 'delivered', deliveredAt: now, payoutExpectedAt } });
  await writeEvent(db, { accountId: order.accountId, orderId: order.id, type: 'order.delivered', payload: { payoutExpectedAt: payoutExpectedAt.toISOString() } });
  await sendOutbound(db, connectors, updated, listingTitle, 'delivered');
  return updated;
}

/** Mock mode: shipped orders are "delivered" after a configurable delay. */
export async function markDeliveriesDue(db: Db, connectors: Connectors, account: Account, deliveryDelayMs: number, now = new Date()): Promise<{ delivered: number }> {
  const cutoff = new Date(now.getTime() - deliveryDelayMs);
  // Manual orders are never auto-delivered: the seller confirms delivery by hand.
  const orders = await db.order.findMany({ where: { accountId: account.id, status: 'shipped', updatedAt: { lte: cutoff }, listing: { product: { supplier: { not: 'manual' } } } }, include: { listing: true } });
  for (const o of orders) await markDelivered(db, connectors, account, o, o.listing.title, now);
  return { delivered: orders.length };
}

/** Write `payout` ledger entries for delivered orders whose payoutExpectedAt has passed. */
export async function writePayoutsDue(db: Db, account: Account, now = new Date()): Promise<{ paidOut: number }> {
  const due = await db.order.findMany({ where: { accountId: account.id, status: 'delivered', paidOutAt: null, payoutExpectedAt: { lte: now } } });
  for (const o of due) {
    const amount = o.salePriceCents + o.buyerShippingCents - (o.ebayFeesCents ?? 0);
    await db.$transaction(async (tx) => {
      await tx.order.update({ where: { id: o.id }, data: { paidOutAt: now } });
      await writeLedger(tx, { accountId: account.id, orderId: o.id, kind: 'payout', amountCents: amount, at: now });
      await writeEvent(tx, { accountId: account.id, orderId: o.id, type: 'order.payout', payload: { amountCents: amount }, at: now });
    });
  }
  return { paidOut: due.length };
}
