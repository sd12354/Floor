import { ebayFeesCents } from './fees.js';
import { assertCents } from './money.js';
import type { MarginInput, MarginResult } from './types.js';

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
