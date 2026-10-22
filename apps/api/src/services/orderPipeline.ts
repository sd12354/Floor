import { computeMargin, decide, holdDeadline, type Address, type ComplianceCode, type LadderDecision } from '@floor/core';
import type { Connectors } from '../connectors.js';
import type { Db } from '../db/client.js';
import { notFound } from '../errors.js';
import { Prisma, type Account, type Order } from '../generated/prisma/client.js';
import { id, startOfUtcDay, writeEvent, writeLedger } from './audit.js';
import { moveToAwaitingSupplier } from './manualFulfillment.js';
import { sendOutbound } from './messages.js';
import { runSync } from './syncService.js';
import { accountPricing, gateProduct, loadBlockedBrands } from './pricingService.js';

export interface IncomingOrder {
  ebayOrderId: string;
  listingId: string;
  buyerName: string;
  shipTo: Address;
  salePriceCents: number;
  buyerShippingCents: number;
  createdAt?: Date;
}

/**
 * Intake: record a paid eBay order. Idempotent on ebayOrderId: a duplicate returns the existing order
 * untouched (`created: false`) so webhooks can be replayed safely.
 */
export async function intakeOrder(db: Db, account: Account, input: IncomingOrder): Promise<{ order: Order; created: boolean }> {
  const existing = await db.order.findUnique({ where: { ebayOrderId: input.ebayOrderId } });
  if (existing) return { order: existing, created: false };
  const listing = await db.listing.findFirst({ where: { id: input.listingId, accountId: account.id } });
  if (!listing) throw notFound('Listing', input.listingId);
  let order: Order;
  try {
    order = await db.order.create({
      data: {
        id: id('ord'),
        accountId: account.id,
        listingId: listing.id,
        ebayOrderId: input.ebayOrderId,
        buyerName: input.buyerName,
        shipTo: input.shipTo as unknown as Prisma.InputJsonValue,
        salePriceCents: input.salePriceCents,
        buyerShippingCents: input.buyerShippingCents,
        status: 'paid',
        createdAt: input.createdAt ?? new Date(),
      },
    });
  } catch (err) {
    // Two notifications for the same order racing past the lookup: the unique index on ebayOrderId
    // decides, and the loser reports the winner's row as a duplicate.
    if (isUniqueViolation(err)) {
      const winner = await db.order.findUnique({ where: { ebayOrderId: input.ebayOrderId } });
      if (winner) return { order: winner, created: false };
    }
    throw err;
  }
  await writeEvent(db, { accountId: account.id, orderId: order.id, listingId: listing.id, type: 'order.paid', payload: { ebayOrderId: order.ebayOrderId, salePriceCents: order.salePriceCents } });
  return { order, created: true };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Supplier spend counted against the daily cap (cost + shipping, positive cents): what was booked in the ledger
 * today, plus what manual orders currently `awaiting_supplier` have reserved (they enter the ledger, on the day
 * the seller actually pays, only once the seller records the supplier order).
 */
export async function supplierSpendToday(db: Db, accountId: string, now = new Date()): Promise<number> {
  const agg = await db.ledgerEntry.aggregate({
    where: { accountId, kind: { in: ['supplier_cost', 'supplier_shipping'] }, at: { gte: startOfUtcDay(now) } },
    _sum: { amountCents: true },
  });
  return Math.abs(agg._sum.amountCents ?? 0) + (await reservedSupplierSpend(db, accountId));
}

/** Cost + shipping reserved by manual orders that are waiting for the seller to buy them. */
export async function reservedSupplierSpend(db: Db, accountId: string): Promise<number> {
  const agg = await db.order.aggregate({ where: { accountId, status: 'awaiting_supplier' }, _sum: { supplierCostCents: true, supplierShippingCents: true } });
  return (agg._sum.supplierCostCents ?? 0) + (agg._sum.supplierShippingCents ?? 0);
}

/**
 * Run the pipeline from `paid` (or `queued`/`checking` on re-entry) as far as it can go:
 * checking -> compliance -> ladder -> spend cap -> ordered. Returns the final order row.
 * Safe to call repeatedly: terminal and in-flight states are returned as-is.
 */
export async function processOrder(db: Db, connectors: Connectors, account: Account, orderId: string, now = new Date()): Promise<Order> {
  let order = await db.order.findFirst({ where: { id: orderId, accountId: account.id }, include: { listing: { include: { product: true } } } });
  if (!order) throw notFound('Order', orderId);
  if (!['paid', 'queued', 'checking'].includes(order.status)) return order;

  const listing = order.listing;
  const product = listing.product;
  const pricing = accountPricing(account);

  // 1. paid -> checking: re-fetch supplier price/stock, compute margin with account fees.
  if (order.status === 'paid') {
    order = { ...order, ...(await transition(db, order, 'checking', {})) };
  }
  const supplier = connectors.supplier(product.supplier);
  const [fresh] = await supplier.getStockAndPrice([product.supplierSku]);
  const costCents = fresh?.costCents ?? product.costCents;
  const shippingCents = fresh?.shippingCents ?? product.shippingCents;
  const stock = fresh?.stock ?? 0;
  // Manual products: the Product row is the source of truth; writing it back would undo stock decrements or clobber a seller PATCH.
  if (fresh && product.supplier !== 'manual') await db.product.update({ where: { id: product.id }, data: { costCents, shippingCents, stock } });

  const margin = computeMargin({
    salePriceCents: order.salePriceCents,
    buyerShippingCents: order.buyerShippingCents,
    supplierCostCents: costCents,
    supplierShippingCents: shippingCents,
    toolFeeCents: pricing.toolFeeCents,
    fees: pricing.fees,
  });
  await db.order.update({ where: { id: order.id }, data: { supplierCostCents: costCents, supplierShippingCents: shippingCents, ebayFeesCents: margin.ebayFeesCents, netProfitCents: margin.netProfitCents } });
  await writeEvent(db, { accountId: account.id, orderId: order.id, type: 'order.checked', payload: { costCents, shippingCents, stock, ...margin } });

  // 2. Compliance gate re-run.
  const blockedBrands = await loadBlockedBrands(db);
  const compliance = listing.status === 'blocked'
    ? ({ ok: false, code: isComplianceCode(listing.pauseReason) ? listing.pauseReason : 'VERO_MATCH', detail: 'Listing is blocked' } as const)
    : gateProduct(product, pricing, blockedBrands, listing.title);
  if (!compliance.ok) {
    return cancelOrder(db, connectors, account, order.id, 'compliance', { compliance });
  }

  // 3. Ladder. A held order the seller already approved (then queued by the cap) must not be put
  // back on hold by the drain: the approval stands, but out_of_stock still cancels.
  const manuallyApproved = order.status === 'queued' && (await db.event.count({ where: { orderId: order.id, type: 'order.decision' } })) > 0;
  const decision: LadderDecision = decide({
    margin,
    floorPct: pricing.rule.floorPct,
    stock,
    now,
    orderCreatedAt: order.createdAt,
    handlingTimeDays: account.handlingTimeDays,
  });
  await writeEvent(db, { accountId: account.id, orderId: order.id, type: 'order.ladder', payload: { decision, manuallyApproved } });
  if (decision.action === 'cancel' && !(manuallyApproved && decision.reason === 'no_decision')) {
    return cancelOrder(db, connectors, account, order.id, decision.reason, { decision });
  }
  if (decision.action === 'hold' && !manuallyApproved) {
    return transition(db, order, 'held', { ladderDecision: decision as unknown as Prisma.InputJsonValue, holdDeadline: new Date(decision.deadline) });
  }
  if (decision.action === 'fulfil') {
    await db.order.update({ where: { id: order.id }, data: { ladderDecision: decision as unknown as Prisma.InputJsonValue } });
  }

  // 4. Daily spend cap.
  const spent = await supplierSpendToday(db, account.id, now);
  if (spent + costCents + shippingCents > account.dailySpendCapCents) {
    if (order.status !== 'queued') {
      return transition(db, order, 'queued', {}, { spentTodayCents: spent, capCents: account.dailySpendCapCents });
    }
    return (await db.order.findUniqueOrThrow({ where: { id: order.id } }));
  }

  // 5. ordered.
  return placeSupplierOrder(db, connectors, account, order.id, now);
}

/**
 * Approve a held order (manual fulfil): skips the margin ladder, but still re-checks stock and
 * honours the spend cap exactly like a fresh order.
 */
export async function fulfilHeldOrder(db: Db, connectors: Connectors, account: Account, orderId: string, now = new Date()): Promise<Order> {
  const order = await db.order.findFirst({ where: { id: orderId, accountId: account.id }, include: { listing: { include: { product: true } } } });
  if (!order) throw notFound('Order', orderId);
  await writeEvent(db, { accountId: account.id, orderId, type: 'order.decision', payload: { action: 'fulfil' } });
  const [fresh] = await connectors.supplier(order.listing.product.supplier).getStockAndPrice([order.listing.product.supplierSku]);
  if ((fresh?.stock ?? 0) <= 0) {
    return cancelOrder(db, connectors, account, orderId, 'out_of_stock', { decision: { action: 'cancel', reason: 'out_of_stock' } });
  }
  const spent = await supplierSpendToday(db, account.id, now);
  const cost = (fresh?.costCents ?? order.supplierCostCents ?? 0) + (fresh?.shippingCents ?? order.supplierShippingCents ?? 0);
  if (spent + cost > account.dailySpendCapCents) {
    return transition(db, order, 'queued', { holdDeadline: null }, { spentTodayCents: spent, capCents: account.dailySpendCapCents });
  }
  return placeSupplierOrder(db, connectors, account, orderId, now);
}

/**
 * `ordered`: supplier placeOrder exactly once (idempotent on ebayOrderId at the connector and guarded
 * by supplierOrderId here), store actual cost, write ledger entries, send order_confirmed.
 */
export async function placeSupplierOrder(db: Db, connectors: Connectors, account: Account, orderId: string, now = new Date()): Promise<Order> {
  const order = await db.order.findFirst({ where: { id: orderId, accountId: account.id }, include: { listing: { include: { product: true } } } });
  if (!order) throw notFound('Order', orderId);
  if (order.supplierOrderId || !['checking', 'queued', 'held'].includes(order.status)) return order;
  // Manual suppliers have no API: the order waits for the seller to buy it by hand (never calls placeOrder).
  if (order.listing.product.supplier === 'manual') return moveToAwaitingSupplier(db, connectors, account, order, order.listing.product, now);

  const supplier = connectors.supplier(order.listing.product.supplier);
  const placed = await supplier.placeOrder({
    idempotencyKey: order.ebayOrderId,
    supplierSku: order.listing.product.supplierSku,
    quantity: 1,
    shipTo: order.shipTo as unknown as Address,
    buyerName: order.buyerName,
    now,
  });
  const pricing = accountPricing(account);
  const margin = computeMargin({
    salePriceCents: order.salePriceCents,
    buyerShippingCents: order.buyerShippingCents,
    supplierCostCents: placed.costCents,
    supplierShippingCents: placed.shippingCents,
    toolFeeCents: pricing.toolFeeCents,
    fees: pricing.fees,
  });
  const revenue = order.salePriceCents + order.buyerShippingCents;
  const updated = await db.$transaction(async (tx) => {
    // Compare-and-set: a concurrent run (scheduler drain vs request) that already booked this order
    // must not produce a second set of ledger entries.
    const claimed = await tx.order.updateMany({
      where: { id: order.id, supplierOrderId: null, status: { in: ['checking', 'queued', 'held'] } },
      data: {
        status: 'ordered',
        supplierOrderId: placed.supplierOrderId,
        supplierCostCents: placed.costCents,
        supplierShippingCents: placed.shippingCents,
        ebayFeesCents: margin.ebayFeesCents,
        netProfitCents: margin.netProfitCents,
        holdDeadline: null,
      },
    });
    if (claimed.count === 0) return null;
    const u = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    await writeLedger(tx, { accountId: account.id, orderId: order.id, kind: 'sale', amountCents: revenue, at: now });
    await writeLedger(tx, { accountId: account.id, orderId: order.id, kind: 'ebay_fee', amountCents: -margin.ebayFeesCents, at: now });
    await writeLedger(tx, { accountId: account.id, orderId: order.id, kind: 'supplier_cost', amountCents: -placed.costCents, at: now });
    await writeLedger(tx, { accountId: account.id, orderId: order.id, kind: 'supplier_shipping', amountCents: -placed.shippingCents, at: now });
    await writeEvent(tx, { accountId: account.id, orderId: order.id, type: 'order.ordered', payload: { supplierOrderId: placed.supplierOrderId, costCents: placed.costCents, shippingCents: placed.shippingCents, netProfitCents: margin.netProfitCents }, at: now });
    return u;
  });
  if (!updated) return db.order.findUniqueOrThrow({ where: { id: order.id } });
  await sendOutbound(db, connectors, updated, order.listing.title, 'order_confirmed');
  return updated;
}

/**
 * Cancel an order (pre-shipment) with a reason; an already-ordered one becomes `refunded` with a refund ledger entry.
 * Compare-and-set on the status that was read: if another request (e.g. the seller recording the supplier order)
 * moved the order first, nothing is overwritten and the current row is returned. Cancelling an `awaiting_supplier`
 * order returns its reserved unit to stock unless `restock` is false (the out-of-stock path never held one).
 */
export async function cancelOrder(db: Db, connectors: Connectors, account: Account, orderId: string, reason: string, payload: Record<string, unknown> = {}, restock = true): Promise<Order> {
  const order = await db.order.findFirst({ where: { id: orderId, accountId: account.id }, include: { listing: { select: { productId: true } } } });
  if (!order) throw notFound('Order', orderId);
  if (['cancelled', 'refunded', 'shipped', 'delivered'].includes(order.status)) return order;
  // Revenue already booked (supplier order placed): the buyer is refunded and the order counts as a defect.
  const refunded = order.status === 'ordered';
  const releaseUnit = restock && order.status === 'awaiting_supplier';
  const updated = await db.$transaction(async (tx) => {
    const claimed = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: refunded ? 'refunded' : 'cancelled', holdDeadline: null } });
    if (claimed.count === 0) return null;
    if (refunded) {
      // Mock supplier has no cancel; log the refund so ledger totals and the float stay honest.
      await writeLedger(tx, { accountId: account.id, orderId, kind: 'refund', amountCents: -(order.salePriceCents + order.buyerShippingCents) });
    }
    if (releaseUnit) await tx.product.update({ where: { id: order.listing.productId }, data: { stock: { increment: 1 } } });
    await writeEvent(tx, { accountId: account.id, orderId, type: 'order.cancelled', payload: { reason, ...payload } });
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  });
  if (!updated) return db.order.findUniqueOrThrow({ where: { id: orderId } });
  if (releaseUnit) await runSync(db, connectors, account, { productId: order.listing.productId });
  return updated;
}

async function transition(db: Db, order: Order, status: Order['status'], data: Prisma.OrderUpdateInput, payload: Record<string, unknown> = {}): Promise<Order> {
  const updated = await db.order.update({ where: { id: order.id }, data: { status, ...data } });
  await writeEvent(db, { accountId: order.accountId, orderId: order.id, type: `order.${status}`, payload: { from: order.status, ...payload } });
  return updated;
}

function isComplianceCode(v: string | null): v is ComplianceCode {
  return v === 'SUPPLIER_NOT_ALLOWED' || v === 'VERO_MATCH' || v === 'RESTRICTED_CATEGORY' || v === 'NO_IMAGES' || v === 'HANDLING_TIME_EXCEEDED';
}

/** Re-derive the contract hold deadline (exposed for tests). */
export { holdDeadline };
