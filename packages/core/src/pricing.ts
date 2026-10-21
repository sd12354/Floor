import { effectiveVariablePct, perOrderFeeCents, SMALL_ORDER_THRESHOLD_CENTS } from './fees.js';
import { computeMargin } from './margin.js';
import { assertCents } from './money.js';
import type { Cents, FeeConfig, Pct, PricingRule, RoundTo } from './types.js';

export interface DerivePriceInput {
  supplierCostCents: Cents;
  supplierShippingCents: Cents;
  toolFeeCents: Cents;
  fees: FeeConfig;
  rule: PricingRule;
  buyerShippingCents: Cents;
}

export interface PriceFloorInput {
  supplierCostCents: Cents;
  supplierShippingCents: Cents;
  toolFeeCents: Cents;
  fees: FeeConfig;
  floorPct: Pct;
  buyerShippingCents: Cents;
}

/**
 * Solve for the order total R such that netMargin == marginPct exactly:
 *
 *   netProfit = R - (R*v + f) - C          (v: effective variable fee, f: per-order fee, C: landed cost)
 *   netProfit / R = m  =>  R = (f + C) / (1 - v - m)
 *
 * The per-order fee is a step function of R (30c at or below $10, else 40c), so we solve once with
 * each step and keep the self-consistent answer. Result is ceil'd so the margin is never under m.
 */
function solveOrderTotal(costCents: Cents, fees: FeeConfig, marginPct: Pct): Cents {
  const v = effectiveVariablePct(fees);
  const denom = 1 - v - marginPct;
  if (denom <= 0) {
    throw new RangeError(`Target margin ${marginPct} is unreachable with a ${v} fee rate`);
  }
  const fullFee = perOrderFeeCents(SMALL_ORDER_THRESHOLD_CENTS + 1, fees);
  const smallFee = perOrderFeeCents(SMALL_ORDER_THRESHOLD_CENTS, fees);
  const rFull = Math.ceil((fullFee + costCents) / denom);
  if (rFull > SMALL_ORDER_THRESHOLD_CENTS) return rFull;
  const rSmall = Math.ceil((smallFee + costCents) / denom);
  if (rSmall <= SMALL_ORDER_THRESHOLD_CENTS) return rSmall;
  // Gap between the two steps: the cheapest consistent total is just above the threshold.
  return SMALL_ORDER_THRESHOLD_CENTS + 1;
}

function landedCost(i: { supplierCostCents: Cents; supplierShippingCents: Cents; toolFeeCents: Cents }): Cents {
  assertCents(i.supplierCostCents, 'supplierCostCents');
  assertCents(i.supplierShippingCents, 'supplierShippingCents');
  assertCents(i.toolFeeCents, 'toolFeeCents');
  return i.supplierCostCents + i.supplierShippingCents + i.toolFeeCents;
}

/**
 * Walk from the continuous solution to the exact integer answer: the smallest item price whose
 * computed (rounded) margin is >= marginPct. Fee rounding can shift the boundary by a cent or two.
 */
function refineToExact(
  guessPrice: Cents,
  marginPct: Pct,
  i: { supplierCostCents: Cents; supplierShippingCents: Cents; toolFeeCents: Cents; fees: FeeConfig; buyerShippingCents: Cents },
): Cents {
  const at = (price: Cents) =>
    computeMargin({
      salePriceCents: price,
      buyerShippingCents: i.buyerShippingCents,
      supplierCostCents: i.supplierCostCents,
      supplierShippingCents: i.supplierShippingCents,
      toolFeeCents: i.toolFeeCents,
      fees: i.fees,
    }).netMarginPct;
  let price = Math.max(1, guessPrice);
  let guard = 0;
  while (at(price) < marginPct && guard++ < 1000) price += 1;
  while (price > 1 && at(price - 1) >= marginPct && guard++ < 2000) price -= 1;
  return price;
}

/** Minimum item price (cents) at which the net margin is still >= floorPct. */
export function priceFloor(input: PriceFloorInput): Cents {
  assertCents(input.buyerShippingCents, 'buyerShippingCents');
  const total = solveOrderTotal(landedCost(input), input.fees, input.floorPct);
  return refineToExact(total - input.buyerShippingCents, input.floorPct, input);
}

/** Suffix in cents for a rounding rule, or null for 'none'. */
function suffixCents(roundTo: RoundTo): number | null {
  if (roundTo === '0.99') return 99;
  if (roundTo === '0.95') return 95;
  return null;
}

/** Round to the nearest price ending in the rule's suffix (may round down). */
export function roundToRule(priceCents: Cents, roundTo: RoundTo): Cents {
  const suffix = suffixCents(roundTo);
  if (suffix === null) return priceCents;
  const dollars = Math.floor(priceCents / 100);
  const down = dollars * 100 + suffix - (suffix > priceCents % 100 ? 100 : 0);
  const up = down + 100;
  const candidate = priceCents - down <= up - priceCents ? down : up;
  return candidate < 1 ? up : candidate;
}

/** Round up to the next price ending in the rule's suffix (never down). */
export function roundUpToRule(priceCents: Cents, roundTo: RoundTo): Cents {
  const suffix = suffixCents(roundTo);
  if (suffix === null) return priceCents;
  const dollars = Math.floor(priceCents / 100);
  const sameDollar = dollars * 100 + suffix;
  return sameDollar >= priceCents ? sameDollar : sameDollar + 100;
}

/** Nearest-suffix rounding may round down; this is how far below the target that is tolerated. */
export const TARGET_ROUNDING_TOLERANCE_PCT: Pct = 0.005;

/**
 * List price that achieves rule.targetPct net margin, rounded per rule.roundTo, and guaranteed
 * to stay at or above the floor price (rounding down past the floor bumps up to the next suffix).
 * Nearest rounding may dip below the target, but never by more than TARGET_ROUNDING_TOLERANCE_PCT:
 * on cheap items a 50c round-down is worth several points, so those bump up to the next suffix.
 */
export function derivePrice(input: DerivePriceInput): Cents {
  assertCents(input.buyerShippingCents, 'buyerShippingCents');
  const cost = landedCost(input);
  const targetTotal = solveOrderTotal(cost, input.fees, input.rule.targetPct);
  const rawPrice = refineToExact(targetTotal - input.buyerShippingCents, input.rule.targetPct, input);
  const floor = priceFloor({ ...input, floorPct: input.rule.floorPct });
  let price = roundToRule(rawPrice, input.rule.roundTo);
  if (price < rawPrice && projectedMarginPct(price, input) < input.rule.targetPct - TARGET_ROUNDING_TOLERANCE_PCT) {
    price = roundUpToRule(rawPrice, input.rule.roundTo);
  }
  if (price < floor) price = roundUpToRule(floor, input.rule.roundTo);
  return price;
}

/**
 * Competitive repricing: undercut the competitor by `undercutCents` but never go below the floor,
 * and never raise above our own target (a far-away competitor is not a reason to overprice).
 */
export function repriceWithin(
  floorCents: Cents,
  targetCents: Cents,
  competitorPriceCents: Cents,
  undercutCents: Cents = 1,
): Cents {
  const ceiling = Math.max(floorCents, targetCents);
  const candidate = competitorPriceCents - undercutCents;
  return Math.max(floorCents, Math.min(candidate, ceiling));
}

/** Projected margin at a given price, convenience wrapper used by discovery. */
export function projectedMarginPct(
  priceCents: Cents,
  input: Omit<DerivePriceInput, 'rule'>,
): Pct {
  return computeMargin({
    salePriceCents: priceCents,
    buyerShippingCents: input.buyerShippingCents,
    supplierCostCents: input.supplierCostCents,
    supplierShippingCents: input.supplierShippingCents,
    toolFeeCents: input.toolFeeCents,
    fees: input.fees,
  }).netMarginPct;
}
