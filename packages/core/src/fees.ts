import { roundHalfUp } from './money.js';
import type { Cents, FeeConfig, Pct } from './types.js';

/** Orders whose total (item + buyer shipping) is at or below this get the reduced per-order fee. */
export const SMALL_ORDER_THRESHOLD_CENTS: Cents = 1000;
/** Reduced per-order fee for small orders (US, 2026). */
export const SMALL_ORDER_FEE_CENTS: Cents = 30;

/** Store subscriber FVF reduction, in percentage points (12.7% vs 13.6%). */
export const STORE_DISCOUNT_PCT: Pct = 0.009;
/** Top Rated Seller discount: 10% off the variable part of the final value fee. */
export const TOP_RATED_DISCOUNT_PCT: Pct = 0.1;
/** Below-standard seller surcharge added to the variable rate. */
export const BELOW_STANDARD_SURCHARGE_PCT: Pct = 0.06;

/** eBay US "most categories" fee table, 2026. */
export const DEFAULT_FEES: Readonly<FeeConfig> = Object.freeze({
  finalValueFeePct: 0.136,
  perOrderFeeCents: 40,
  promotedPct: 0,
  storeDiscountPct: 0,
  topRatedDiscountPct: 0,
  belowStandardSurchargePct: 0,
});

export function withStoreDiscount(fees: FeeConfig, on = true): FeeConfig {
  return { ...fees, storeDiscountPct: on ? STORE_DISCOUNT_PCT : 0 };
}

export function withTopRatedDiscount(fees: FeeConfig, on = true): FeeConfig {
  return { ...fees, topRatedDiscountPct: on ? TOP_RATED_DISCOUNT_PCT : 0 };
}

export function withBelowStandardSurcharge(fees: FeeConfig, on = true): FeeConfig {
  return { ...fees, belowStandardSurchargePct: on ? BELOW_STANDARD_SURCHARGE_PCT : 0 };
}

export function withPromoted(fees: FeeConfig, promotedPct: Pct): FeeConfig {
  return { ...fees, promotedPct };
}

/**
 * Effective variable rate applied to (item + buyer shipping):
 * (FVF - store discount) x (1 - top rated discount) + below-standard surcharge + promoted ad rate.
 */
export function effectiveVariablePct(fees: FeeConfig): Pct {
  const base = Math.max(0, fees.finalValueFeePct - fees.storeDiscountPct);
  return base * (1 - fees.topRatedDiscountPct) + fees.belowStandardSurchargePct + fees.promotedPct;
}

/** Per-order fixed fee for a given order total. */
export function perOrderFeeCents(orderTotalCents: Cents, fees: FeeConfig): Cents {
  if (orderTotalCents <= SMALL_ORDER_THRESHOLD_CENTS) {
    return Math.min(fees.perOrderFeeCents, SMALL_ORDER_FEE_CENTS);
  }
  return fees.perOrderFeeCents;
}

/** Total eBay fees (variable + per-order) on an order total, integer cents, round half up. */
export function ebayFeesCents(orderTotalCents: Cents, fees: FeeConfig): Cents {
  const variable = roundHalfUp(orderTotalCents * effectiveVariablePct(fees));
  return variable + perOrderFeeCents(orderTotalCents, fees);
}

/** Normalise a possibly-partial fee config (e.g. from a JSON column) onto the defaults. */
export function normalizeFees(partial: Partial<FeeConfig> | null | undefined): FeeConfig {
  return { ...DEFAULT_FEES, ...(partial ?? {}) };
}
