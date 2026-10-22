import { normalizeFees, type Address, type FeeConfig, type LadderDecision, type PricingRule } from '@floor/core';
import type {
  Account,
  Event,
  LedgerEntry,
  Listing,
  Message,
  Order,
  Product,
  SupplierConnection,
} from './generated/prisma/client.js';

/* Prisma Json columns come back as JsonValue; these helpers narrow them to contract types. */

export const DEFAULT_PRICING_RULE: PricingRule = { floorPct: 0.1, targetPct: 0.2, roundTo: '0.99' };

export function asPricingRule(v: unknown): PricingRule {
  const o = (v ?? {}) as Partial<PricingRule>;
  return {
    floorPct: typeof o.floorPct === 'number' ? o.floorPct : DEFAULT_PRICING_RULE.floorPct,
    targetPct: typeof o.targetPct === 'number' ? o.targetPct : DEFAULT_PRICING_RULE.targetPct,
    roundTo: o.roundTo === 'none' || o.roundTo === '0.95' || o.roundTo === '0.99' ? o.roundTo : DEFAULT_PRICING_RULE.roundTo,
  };
}

export function asFees(v: unknown): FeeConfig {
  return normalizeFees((v ?? {}) as Partial<FeeConfig>);
}

export function asImages(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function asAddress(v: unknown): Address {
  return (v ?? {}) as Address;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function serializeAccount(a: Account, extra: { supplierConnections: SupplierConnection[]; mode: 'mock' | 'real'; promotedAdsPending?: number }) {
  return {
    id: a.id,
    name: a.name,
    mode: extra.mode,
    ebayConnected: a.ebayConnected,
    ebayUsername: a.ebayUsername ?? undefined,
    pricingRule: asPricingRule(a.pricingRule),
    fees: asFees(a.fees),
    dailySpendCapCents: a.dailySpendCapCents,
    smallLossToleranceCents: a.smallLossToleranceCents,
    handlingTimeDays: a.handlingTimeDays,
    newSeller: a.newSeller,
    promotedAdsEnabled: a.promotedAdsEnabled,
    promotedAdRatePct: a.promotedAdRatePct,
    promotedAdsPending: extra.promotedAdsPending ?? 0,
    createdAt: a.createdAt.toISOString(),
    supplierConnections: extra.supplierConnections.map(serializeSupplierConnection),
  };
}

export function serializeSupplierConnection(s: SupplierConnection) {
  return { id: s.id, accountId: s.accountId, supplier: s.supplier, status: s.status, label: s.label, createdAt: s.createdAt.toISOString() };
}

export function serializeProduct(p: Product) {
  return {
    id: p.id,
    supplier: p.supplier,
    supplierSku: p.supplierSku,
    title: p.title,
    description: p.description,
    images: asImages(p.images),
    costCents: p.costCents,
    shippingCents: p.shippingCents,
    stock: p.stock,
    warehouseCountry: p.warehouseCountry,
    handlingDays: p.handlingDays,
    brand: p.brand ?? undefined,
    categoryHint: p.categoryHint ?? undefined,
    supplierUrl: p.supplierUrl ?? undefined,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function serializeListing(l: Listing) {
  return {
    id: l.id,
    accountId: l.accountId,
    productId: l.productId,
    ebayItemId: l.ebayItemId ?? undefined,
    title: l.title,
    description: l.description,
    priceCents: l.priceCents,
    floorPriceCents: l.floorPriceCents,
    buyerShippingCents: l.buyerShippingCents,
    quantity: l.quantity,
    status: l.status,
    pauseReason: l.pauseReason ?? undefined,
    projectedMarginPct: l.projectedMarginPct,
    promoted: l.promotedRatePct !== null,
    promotedRatePct: l.promotedRatePct ?? undefined,
    lastSyncAt: iso(l.lastSyncAt),
    createdAt: l.createdAt.toISOString(),
  };
}

export function serializeOrder(o: Order) {
  return {
    id: o.id,
    accountId: o.accountId,
    listingId: o.listingId,
    ebayOrderId: o.ebayOrderId,
    buyerName: o.buyerName,
    shipTo: asAddress(o.shipTo),
    salePriceCents: o.salePriceCents,
    buyerShippingCents: o.buyerShippingCents,
    status: o.status,
    supplierOrderId: o.supplierOrderId ?? undefined,
    supplierCostCents: o.supplierCostCents ?? undefined,
    supplierShippingCents: o.supplierShippingCents ?? undefined,
    ebayFeesCents: o.ebayFeesCents ?? undefined,
    trackingNumber: o.trackingNumber ?? undefined,
    carrier: o.carrier ?? undefined,
    ladderDecision: (o.ladderDecision ?? undefined) as LadderDecision | undefined,
    holdDeadline: iso(o.holdDeadline) ?? undefined,
    payoutExpectedAt: iso(o.payoutExpectedAt) ?? undefined,
    paidOutAt: iso(o.paidOutAt) ?? undefined,
    deliveredAt: iso(o.deliveredAt) ?? undefined,
    netProfitCents: o.netProfitCents ?? undefined,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function serializeLedger(e: LedgerEntry) {
  return { id: e.id, accountId: e.accountId, orderId: e.orderId ?? undefined, kind: e.kind, amountCents: e.amountCents, at: e.at.toISOString() };
}

export function serializeEvent(e: Event) {
  return {
    id: e.id,
    accountId: e.accountId,
    orderId: e.orderId ?? undefined,
    listingId: e.listingId ?? undefined,
    type: e.type,
    payload: e.payload,
    at: e.at.toISOString(),
  };
}

export function serializeMessage(m: Message) {
  return {
    id: m.id,
    accountId: m.accountId,
    orderId: m.orderId,
    direction: m.direction,
    kind: m.kind,
    body: m.body,
    suggestedReply: m.suggestedReply ?? undefined,
    answered: m.answered,
    at: m.at.toISOString(),
  };
}
