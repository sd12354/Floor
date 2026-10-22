import { ebayFeesCents } from './fees.js';
import { assertCents } from './money.js';
import type { Cents, FeeConfig, MarginInput, MarginResult, Pct } from './types.js';

/**
 * Margin engine. The final value fee applies to the full order total (item + buyer shipping).
 *
 *   netProfit = (sale + buyerShipping) - ebayFees - supplierCost - supplierShipping - toolFee
 *   netMarginPct = netProfit / (sale + buyerShipping)
 *
 * All cents are integers; fees are rounded half up once at the fee level.
 */
export function computeMargin(input: MarginInput): MarginResult {
  assertCents(input.salePriceCents, 'salePriceCents');
  assertCents(input.buyerShippingCents, 'buyerShippingCents');
  assertCents(input.supplierCostCents, 'supplierCostCents');
  assertCents(input.supplierShippingCents, 'supplierShippingCents');
  assertCents(input.toolFeeCents, 'toolFeeCents');

  const revenue = input.salePriceCents + input.buyerShippingCents;
  const fees = ebayFeesCents(revenue, input.fees);
  const netProfitCents = revenue - fees - input.supplierCostCents - input.supplierShippingCents - input.toolFeeCents;
  const netMarginPct = revenue === 0 ? (netProfitCents < 0 ? -1 : 0) : netProfitCents / revenue;
  return { ebayFeesCents: fees, netProfitCents, netMarginPct };
}

/** Convenience: is this order at or above the given margin floor? */
export function meetsFloor(result: MarginResult, floorPct: number): boolean {
  return result.netMarginPct >= floorPct;
}

export interface MaxSupplierCostInput {
  salePriceCents: Cents;
  buyerShippingCents: Cents;
  toolFeeCents: Cents;
  fees: FeeConfig;
  floorPct: Pct;
}

/**
 * The largest combined supplier cost + supplier shipping (cents) whose net margin is still >= floorPct.
 * Exact: found by binary search against `computeMargin` itself (net margin only falls as cost rises), so it
 * can never disagree with the engine by a cent. Returns 0 when even a free item misses the floor.
 */
export function maxSupplierCostForFloor(input: MaxSupplierCostInput): Cents {
  const revenue = input.salePriceCents + input.buyerShippingCents;
  const meets = (cost: Cents): boolean =>
    computeMargin({
      salePriceCents: input.salePriceCents,
      buyerShippingCents: input.buyerShippingCents,
      supplierCostCents: cost,
      supplierShippingCents: 0,
      toolFeeCents: input.toolFeeCents,
      fees: input.fees,
    }).netMarginPct >= input.floorPct;
  if (!meets(0)) return 0;
  // Continuous solution of (R - fees - tool - c) >= floor*R, padded so `hi` is certainly over the line.
  const estimate = revenue - ebayFeesCents(revenue, input.fees) - input.toolFeeCents - input.floorPct * revenue;
  let lo = 0; // meets
  let hi = Math.max(0, Math.ceil(estimate)) + 2; // does not meet
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (meets(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
