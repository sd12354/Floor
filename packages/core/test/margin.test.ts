import { describe, expect, it } from 'vitest';
import {
  computeMargin,
  DEFAULT_FEES,
  ebayFeesCents,
  effectiveVariablePct,
  formatCents,
  perOrderFeeCents,
  roundHalfUp,
  withBelowStandardSurcharge,
  withStoreDiscount,
  withTopRatedDiscount,
} from '../src/index.js';

describe('roundHalfUp', () => {
  it('rounds .5 up and negatives symmetrically', () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(2.4999)).toBe(2);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(0)).toBe(0);
  });
  it('formats cents', () => {
    expect(formatCents(1234)).toBe('$12.34');
    expect(formatCents(-5)).toBe('-$0.05');
  });
});

describe('fees', () => {
  it('default FVF is 13.6% + $0.40', () => {
    expect(DEFAULT_FEES.finalValueFeePct).toBe(0.136);
    expect(DEFAULT_FEES.perOrderFeeCents).toBe(40);
  });
  it('uses $0.30 per order when total <= $10', () => {
    expect(perOrderFeeCents(1000, DEFAULT_FEES)).toBe(30);
    expect(perOrderFeeCents(1001, DEFAULT_FEES)).toBe(40);
  });
  it('applies store discount as 0.9 points', () => {
    expect(effectiveVariablePct(withStoreDiscount(DEFAULT_FEES))).toBeCloseTo(0.127, 10);
  });
  it('applies top rated discount as 10% off variable part', () => {
    expect(effectiveVariablePct(withTopRatedDiscount(DEFAULT_FEES))).toBeCloseTo(0.1224, 10);
  });
  it('adds below-standard surcharge', () => {
    expect(effectiveVariablePct(withBelowStandardSurcharge(DEFAULT_FEES))).toBeCloseTo(0.196, 10);
  });
  it('worked example: $100 item + $8 shipping -> $14.69 + $0.40', () => {
    expect(ebayFeesCents(10800, DEFAULT_FEES)).toBe(1469 + 40);
  });
});

describe('computeMargin', () => {
  it('worked example: $100 + $8 ship, $60 cost, $5 supplier ship', () => {
    const r = computeMargin({
      salePriceCents: 10000,
      buyerShippingCents: 800,
      supplierCostCents: 6000,
      supplierShippingCents: 500,
      toolFeeCents: 0,
      fees: DEFAULT_FEES,
    });
    expect(r.ebayFeesCents).toBe(1509);
    expect(r.netProfitCents).toBe(10800 - 1509 - 6500);
    expect(r.netMarginPct).toBeCloseTo(2791 / 10800, 10);
  });

  it('rounds the variable fee half up', () => {
    // 2537 * 0.136 = 345.032 -> 345 ; + 40
    expect(computeMargin({ salePriceCents: 2537, buyerShippingCents: 0, supplierCostCents: 0, supplierShippingCents: 0, toolFeeCents: 0, fees: DEFAULT_FEES }).ebayFeesCents).toBe(385);
    // 2555 * 0.136 = 347.48 -> 347 ; 2559*0.136 = 348.024 -> 348
    expect(computeMargin({ salePriceCents: 2559, buyerShippingCents: 0, supplierCostCents: 0, supplierShippingCents: 0, toolFeeCents: 0, fees: DEFAULT_FEES }).ebayFeesCents).toBe(388);
  });

  it('small orders use the 30c fee', () => {
    const r = computeMargin({ salePriceCents: 900, buyerShippingCents: 100, supplierCostCents: 500, supplierShippingCents: 0, toolFeeCents: 0, fees: DEFAULT_FEES });
    expect(r.ebayFeesCents).toBe(136 + 30);
  });

  it('includes tool fee and can go negative', () => {
    const r = computeMargin({ salePriceCents: 1000, buyerShippingCents: 0, supplierCostCents: 1200, supplierShippingCents: 0, toolFeeCents: 25, fees: DEFAULT_FEES });
    expect(r.netProfitCents).toBe(1000 - 166 - 1200 - 25);
    expect(r.netMarginPct).toBeLessThan(0);
  });

  it('rejects non-integer cents', () => {
    expect(() =>
      computeMargin({ salePriceCents: 10.5, buyerShippingCents: 0, supplierCostCents: 0, supplierShippingCents: 0, toolFeeCents: 0, fees: DEFAULT_FEES }),
    ).toThrow(TypeError);
  });
});
