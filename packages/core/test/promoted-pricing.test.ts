import { describe, expect, it } from 'vitest';
import { computeMargin, DEFAULT_FEES, derivePrice, ebayFeesCents, effectiveVariablePct, priceFloor, withPromoted, type PricingRule } from '../src/index.js';

const rule: PricingRule = { floorPct: 0.1, targetPct: 0.2, roundTo: '0.99' };
const input = (fees = DEFAULT_FEES) => ({ supplierCostCents: 1200, supplierShippingCents: 0, toolFeeCents: 0, buyerShippingCents: 0, fees });
const marginOf = (priceCents: number, fees = DEFAULT_FEES) =>
  computeMargin({ salePriceCents: priceCents, buyerShippingCents: 0, supplierCostCents: 1200, supplierShippingCents: 0, toolFeeCents: 0, fees }).netMarginPct;

describe('promoted ad rate in the fee math', () => {
  it('is charged once, on the whole order total (item + buyer shipping), on top of the final value fee', () => {
    const fees = withPromoted(DEFAULT_FEES, 0.05);
    expect(effectiveVariablePct(fees)).toBeCloseTo(0.136 + 0.05, 10);
    expect(ebayFeesCents(10_000, fees) - ebayFeesCents(10_000, DEFAULT_FEES)).toBe(500);
    // with buyer shipping the ad rate applies to item + shipping, like the final value fee
    expect(ebayFeesCents(10_000 + 500, fees) - ebayFeesCents(10_000 + 500, DEFAULT_FEES)).toBe(525);
  });

  it('raises the target price and the floor so the margin holds at the new rate', () => {
    const rate = 0.05;
    const on = withPromoted(DEFAULT_FEES, rate);
    const offPrice = derivePrice({ ...input(), rule });
    const onPrice = derivePrice({ ...input(on), rule });
    expect(onPrice).toBeGreaterThan(offPrice);
    expect(priceFloor({ ...input(on), floorPct: rule.floorPct })).toBeGreaterThan(priceFloor({ ...input(), floorPct: rule.floorPct }));
    // the promoted price clears the target at the promoted fee; the old price does not
    expect(marginOf(onPrice, on)).toBeGreaterThanOrEqual(rule.targetPct - 0.005);
    expect(marginOf(offPrice, on)).toBeLessThan(rule.targetPct - 0.005);
  });

  it('a price that cleared the floor without ads falls below it once the ad rate is added (the sync must pause or reprice it)', () => {
    const on = withPromoted(DEFAULT_FEES, 0.1);
    const offFloor = priceFloor({ ...input(), floorPct: rule.floorPct });
    expect(marginOf(offFloor)).toBeGreaterThanOrEqual(rule.floorPct);
    expect(marginOf(offFloor, on)).toBeLessThan(rule.floorPct);
    const onFloor = priceFloor({ ...input(on), floorPct: rule.floorPct });
    expect(marginOf(onFloor, on)).toBeGreaterThanOrEqual(rule.floorPct);
  });

  it('every rate in the allowed range leaves the floor price at or above the floor margin', () => {
    for (let r = 0.02; r <= 0.3; r += 0.005) {
      const fees = withPromoted(DEFAULT_FEES, Math.round(r * 1000) / 1000);
      const floor = priceFloor({ ...input(fees), floorPct: rule.floorPct });
      expect(marginOf(floor, fees)).toBeGreaterThanOrEqual(rule.floorPct);
    }
  });
});
