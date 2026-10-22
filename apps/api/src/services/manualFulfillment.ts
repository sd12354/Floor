import { computeMargin, maxSupplierCostForFloor } from '@floor/core';
import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import { AppError, conflict, notFound, unprocessable } from '../errors.js';
import type { Account, Listing, Order, Product } from '../generated/prisma/client.js';
import { writeEvent, writeLedger } from './audit.js';
import { cancelOrder } from './orderPipeline.js';
import { runSync } from './syncService.js';
import { markDelivered, markShipped, NEW_SELLER_PAYOUT_DELAY_DAYS, PAYOUT_DELAY_DAYS } from './fulfillment.js';
import { sendOutbound } from './messages.js';
import { accountPricing } from './pricingService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

type OrderWithProduct = Order & { listing: Listing & { product: Product } };

async function loadOrder(db: Db, account: Account, orderId: string): Promise<OrderWithProduct> {
  const order = await db.order.findFirst({ where: { id: orderId, accountId: account.id }, include: { listing: { include: { product: true } } } });
  if (!order) throw notFound('Order', orderId);
  return order;
}

/** The most the seller can pay (item + supplier shipping) for this order and still meet the account margin floor. */
export function maxSupplierCostFor(order: Pick<Order, 'salePriceCents' | 'buyerShippingCents'>, account: Account): number {
  const pricing = accountPricing(account);
  return maxSupplierCostForFloor({
    salePriceCents: order.salePriceCents,
    buyerShippingCents: order.buyerShippingCents,
    toolFeeCents: pricing.toolFeeCents,
    fees: pricing.fees,
    floorPct: pricing.rule.floorPct,
  });
}

/** Extra GET /orders/:id fields for manual orders (empty object for everything else). */
export function manualOrderExtras(order: Order, product: Product, account: Account): Record<string, unknown> {
  if (product.supplier !== 'manual') return {};
  return {
    supplier: { kind: 'manual', ...(product.supplierUrl ? { url: product.supplierUrl } : {}), title: product.title, supplierSku: product.supplierSku },
    maxSupplierCostCents: maxSupplierCostFor(order, account),
  };
}

function marginFor(order: Order, account: Account, costCents: number, shippingCents: number) {
  const pricing = accountPricing(account);
  return computeMargin({
    salePriceCents: order.salePriceCents,
    buyerShippingCents: order.buyerShippingCents,
    supplierCostCents: costCents,
    supplierShippingCents: shippingCents,
    toolFeeCents: pricing.toolFeeCents,
    fees: pricing.fees,
  });
}

/**
 * Pipeline exit for manual products: the compliance gate, ladder and spend cap have all passed, so the order
 * waits for the seller to buy it by hand. Nothing touches the ledger yet. The cost and shipping on the order are
 * refreshed from the product row; the spend cap reserves them while the order is `awaiting_supplier`.
 * Compare-and-set, so a drain racing a request cannot move (or announce) an order twice.
 */
export async function moveToAwaitingSupplier(db: Db, connectors: Connectors, account: Account, order: Order, product: Product, now = new Date()): Promise<Order> {
  const margin = marginFor(order, account, product.costCents, product.shippingCents);
  const claimed = await db.order.updateMany({
    where: { id: order.id, supplierOrderId: null, status: { in: ['checking', 'queued', 'held'] } },
    data: {
      status: 'awaiting_supplier',
      holdDeadline: null,
      supplierCostCents: product.costCents,
      supplierShippingCents: product.shippingCents,
      ebayFeesCents: margin.ebayFeesCents,
      netProfitCents: margin.netProfitCents,
    },
  });
  if (claimed.count > 0) {
    // Take the unit: atomic, so two paid orders cannot both claim the last one.
    const taken = await db.product.updateMany({ where: { id: product.id, stock: { gt: 0 } }, data: { stock: { decrement: 1 } } });
    if (taken.count === 0) {
      return cancelOrder(db, connectors, account, order.id, 'out_of_stock', { decision: { action: 'cancel', reason: 'out_of_stock' } }, false);
    }
    await writeEvent(db, {
      accountId: order.accountId,
      orderId: order.id,
      type: 'order.awaiting_supplier',
      payload: { from: order.status, costCents: product.costCents, shippingCents: product.shippingCents, maxSupplierCostCents: maxSupplierCostFor(order, account) },
      at: now,
    });
    // Pause listings (out_of_stock) or lower the eBay quantity now that a unit is spoken for.
    await runSync(db, connectors, account, { productId: product.id });
  }
  return db.order.findUniqueOrThrow({ where: { id: order.id } });
}

function requireAwaiting(order: Order): void {
  if (order.status !== 'awaiting_supplier') {
    throw unprocessable('ORDER_NOT_AWAITING_SUPPLIER', `Order is ${order.status}, supplier details apply to orders awaiting the supplier only`);
  }
}

export interface SupplierQuote {
  netProfitCents: number;
  netMarginPct: number;
  ebayFeesCents: number;
  maxSupplierCostCents: number;
  meetsFloor: boolean;
}

/** What the margin would be at the numbers the seller is about to pay. Read-only. */
export async function quoteSupplier(db: Db, account: Account, orderId: string, costCents: number, shippingCents: number): Promise<SupplierQuote> {
  const order = await loadOrder(db, account, orderId);
  requireAwaiting(order);
  const m = marginFor(order, account, costCents, shippingCents);
  return {
    netProfitCents: m.netProfitCents,
    netMarginPct: m.netMarginPct,
    ebayFeesCents: m.ebayFeesCents,
    maxSupplierCostCents: maxSupplierCostFor(order, account),
    meetsFloor: m.netMarginPct >= accountPricing(account).rule.floorPct,
  };
}

export interface SupplierOrderInput {
  supplierOrderId: string;
  costCents: number;
  shippingCents: number;
  confirmBelowFloor?: boolean;
}

/**
 * The seller bought the item: re-check the margin with what they actually paid, then book it exactly like an
 * automatic order (sale, fee, supplier cost and shipping ledger entries, order_confirmed message).
 * Idempotent on supplierOrderId; a different id on an already-ordered order is a 409.
 */
export async function recordSupplierOrder(db: Db, connectors: Connectors, account: Account, orderId: string, input: SupplierOrderInput, now = new Date()): Promise<Order> {
  const order = await loadOrder(db, account, orderId);
  const replay = (o: Order): Order => {
    if (o.supplierOrderId === input.supplierOrderId) return o;
    throw conflict('SUPPLIER_ORDER_EXISTS', `Order already has supplier order ${o.supplierOrderId ?? '?'}; one eBay order maps to one supplier order`);
  };
  if (['ordered', 'shipped', 'delivered'].includes(order.status)) return replayRecorded(db, connectors, order, replay(order));
  requireAwaiting(order);

  const margin = marginFor(order, account, input.costCents, input.shippingCents);
  const floorPct = accountPricing(account).rule.floorPct;
  if (margin.netMarginPct < floorPct && input.confirmBelowFloor !== true) {
    throw new AppError(422, 'BELOW_FLOOR', 'Those costs put this order below your margin floor', {
      maxSupplierCostCents: maxSupplierCostFor(order, account),
      netMarginPct: margin.netMarginPct,
      netProfitCents: margin.netProfitCents,
    });
  }

  const revenue = order.salePriceCents + order.buyerShippingCents;
  const updated = await db.$transaction(async (tx) => {
    // Compare-and-set: two submissions racing past the status check cannot both book the order.
    const claimed = await tx.order.updateMany({
      where: { id: order.id, supplierOrderId: null, status: 'awaiting_supplier' },
      data: {
        status: 'ordered',
        supplierOrderId: input.supplierOrderId,
        supplierCostCents: input.costCents,
        supplierShippingCents: input.shippingCents,
        ebayFeesCents: margin.ebayFeesCents,
        netProfitCents: margin.netProfitCents,
      },
    });
    if (claimed.count === 0) return null;
    await writeLedger(tx, { accountId: account.id, orderId: order.id, kind: 'sale', amountCents: revenue, at: now });
    await writeLedger(tx, { accountId: account.id, orderId: order.id, kind: 'ebay_fee', amountCents: -margin.ebayFeesCents, at: now });
    await writeLedger(tx, { accountId: account.id, orderId: order.id, kind: 'supplier_cost', amountCents: -input.costCents, at: now });
    await writeLedger(tx, { accountId: account.id, orderId: order.id, kind: 'supplier_shipping', amountCents: -input.shippingCents, at: now });
    await writeEvent(tx, {
      accountId: account.id,
      orderId: order.id,
      type: 'order.supplier_ordered',
      payload: { confirmBelowFloor: input.confirmBelowFloor === true, supplierOrderId: input.supplierOrderId, costCents: input.costCents, shippingCents: input.shippingCents, netProfitCents: margin.netProfitCents, netMarginPct: margin.netMarginPct },
      at: now,
    });
    return tx.order.findUniqueOrThrow({ where: { id: order.id } });
  });
  if (!updated) {
    const current = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    if (['ordered', 'shipped', 'delivered'].includes(current.status)) return replayRecorded(db, connectors, current, replay(current));
    requireAwaiting(current);
    throw conflict('SUPPLIER_ORDER_EXISTS', 'Order already has a supplier order');
  }
  await sendOutbound(db, connectors, updated, order.listing.title, 'order_confirmed');
  return updated;
}

/**
 * A repeat of an already-recorded supplier order returns it unchanged. The buyer confirmation is sent after the
 * booking commits, so a crash in between would lose it; a replay resends it once if no confirmation exists yet.
 */
async function replayRecorded(db: Db, connectors: Connectors, order: Order, recorded: Order): Promise<Order> {
  const sent = await db.message.count({ where: { orderId: order.id, kind: 'order_confirmed' } });
  if (sent === 0) {
    const listing = await db.listing.findUniqueOrThrow({ where: { id: order.listingId }, select: { title: true } });
    await sendOutbound(db, connectors, order, listing.title, 'order_confirmed');
  }
  return recorded;
}

/** The seller got a tracking number from the supplier: push it to eBay like automatic tracking and mark shipped. */
export async function recordManualTracking(db: Db, connectors: Connectors, account: Account, orderId: string, trackingNumber: string, carrier: string, now = new Date()): Promise<Order> {
  const order = await loadOrder(db, account, orderId);
  if (order.status !== 'ordered' || order.listing.product.supplier !== 'manual') {
    throw unprocessable('TRACKING_NOT_MANUAL', 'Tracking can be added by hand only to ordered orders from a manual supplier');
  }
  const delayDays = account.newSeller ? NEW_SELLER_PAYOUT_DELAY_DAYS : PAYOUT_DELAY_DAYS;
  return markShipped(db, connectors, order, order.listing.title, trackingNumber, carrier, now.toISOString(), { payoutExpectedAt: new Date(now.getTime() + delayDays * DAY_MS) });
}

/** Delivery is never detected for manual orders: the seller confirms it. Idempotent once delivered. */
export async function markManualDelivered(db: Db, connectors: Connectors, account: Account, orderId: string, now = new Date()): Promise<Order> {
  const order = await loadOrder(db, account, orderId);
  if (order.listing.product.supplier !== 'manual') {
    throw unprocessable('DELIVERY_NOT_MANUAL', 'Delivery is confirmed by hand only for orders from a manual supplier');
  }
  if (order.status === 'delivered') return order;
  if (order.status !== 'shipped') throw unprocessable('ORDER_NOT_SHIPPED', `Order is ${order.status}, only shipped orders can be marked delivered`);
  const delivered = await markDelivered(db, connectors, account, order, order.listing.title, now);
  await writeEvent(db, { accountId: account.id, orderId: order.id, type: 'order.delivered_manual', payload: {}, at: now });
  return delivered;
}
