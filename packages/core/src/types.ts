/**
 * Core types shared with apps/api and apps/web. Mirrors docs/CONTRACT.md.
 * Money is integer cents; percentages are decimals (0.136 = 13.6%).
 */

export type Cents = number;
export type Pct = number;

export interface FeeConfig {
  finalValueFeePct: Pct;
  perOrderFeeCents: Cents;
  promotedPct: Pct;
  storeDiscountPct: Pct;
  topRatedDiscountPct: Pct;
  belowStandardSurchargePct: Pct;
}

export interface MarginInput {
  salePriceCents: Cents;
  buyerShippingCents: Cents;
  supplierCostCents: Cents;
  supplierShippingCents: Cents;
  toolFeeCents: Cents;
  fees: FeeConfig;
}

export interface MarginResult {
  ebayFeesCents: Cents;
  netProfitCents: Cents;
  netMarginPct: Pct;
}

export type RoundTo = 'none' | '0.99' | '0.95';

export interface PricingRule {
  floorPct: Pct;
  targetPct: Pct;
  roundTo: RoundTo;
}

export type LadderDecision =
  | { action: 'fulfil'; reason: 'within_tolerance' | 'small_loss' }
  | { action: 'hold'; reason: 'below_floor'; deadline: string }
  | { action: 'cancel'; reason: 'no_decision' | 'out_of_stock' };

export type ComplianceCode =
  | 'SUPPLIER_NOT_ALLOWED'
  | 'VERO_MATCH'
  | 'RESTRICTED_CATEGORY'
  | 'NO_IMAGES'
  | 'HANDLING_TIME_EXCEEDED';

export type ComplianceResult = { ok: true } | { ok: false; code: ComplianceCode; detail: string };

export type Supplier = 'mock' | 'cjdropshipping' | 'spocket';

export interface Address {
  name?: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export type OrderStatus =
  | 'paid'
  | 'checking'
  | 'held'
  | 'queued'
  | 'ordered'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type ListingStatus = 'draft' | 'active' | 'paused' | 'ended' | 'blocked';

export type LedgerKind = 'sale' | 'ebay_fee' | 'supplier_cost' | 'supplier_shipping' | 'refund' | 'payout';

export type MessageKind = 'order_confirmed' | 'shipped' | 'delivered' | 'wismo' | 'cancel' | 'return' | 'other';
