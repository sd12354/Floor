import { describe, expect, it } from 'vitest';
import { applyRounding, computeMargin, formatCents, formatPct, marginState, parseCents, priceForTarget } from './money';
import { defaultFees, defaultRule } from '@/mocks/fixtures/account';

describe('formatCents', () => {
  it('formats dollars and cents', () => {
    expect(formatCents(1234)).toBe('$12.34');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(100000)).toBe('$1,000.00');
  });
  it('keeps the sign on negatives and adds + when signed', () => {
    expect(formatCents(-300)).toBe('-$3.00');
    expect(formatCents(300, { signed: true })).toBe('+$3.00');
    expect(formatCents(0, { signed: true })).toBe('$0.00');
  });
  it('renders a dash for missing values', () => {
    expect(formatCents(undefined)).toBe('—');
    expect(formatCents(null)).toBe('—');
  });
  it('can drop cents', () => {
    expect(formatCents(50000, { whole: true })).toBe('$500');
  });
});

describe('formatPct', () => {
  it('turns decimals into percentages', () => {
    expect(formatPct(0.136)).toBe('13.6%');
    expect(formatPct(0.2, 0)).toBe('20%');
    expect(formatPct(-0.237)).toBe('-23.7%');
    expect(formatPct(undefined)).toBe('—');
  });
});

describe('marginState', () => {
  const rule = { floorPct: 0.1, targetPct: 0.2 };
  it('is good at or above target', () => {
    expect(marginState(0.2, rule)).toBe('good');
    expect(marginState(0.35, rule)).toBe('good');
  });
  it('is thin between floor and target', () => {
    expect(marginState(0.1, rule)).toBe('thin');
    expect(marginState(0.199, rule)).toBe('thin');
  });
  it('is below under the floor', () => {
    expect(marginState(0.099, rule)).toBe('below');
    expect(marginState(-0.5, rule)).toBe('below');
  });
});

describe('computeMargin', () => {
  it('applies the final value fee and per-order fee', () => {
    const r = computeMargin({ salePriceCents: 4000, buyerShippingCents: 0, supplierCostCents: 1200, supplierShippingCents: 0, toolFeeCents: 0, fees: defaultFees });
    expect(r.ebayFeesCents).toBe(Math.round(4000 * 0.136) + 40);
    expect(r.netProfitCents).toBe(4000 - r.ebayFeesCents - 1200);
    expect(r.netMarginPct).toBeCloseTo(r.netProfitCents / 4000, 6);
  });
  it('charges the reduced per-order fee on orders of $10 or less', () => {
    const r = computeMargin({ salePriceCents: 999, buyerShippingCents: 0, supplierCostCents: 500, supplierShippingCents: 0, toolFeeCents: 0, fees: defaultFees });
    expect(r.ebayFeesCents).toBe(Math.round(999 * 0.136) + 30);
  });
  it('honours store and top-rated discounts', () => {
    const fees = { ...defaultFees, storeDiscountPct: 0.009, topRatedDiscountPct: 0.1 };
    const r = computeMargin({ salePriceCents: 10000, buyerShippingCents: 0, supplierCostCents: 0, supplierShippingCents: 0, toolFeeCents: 0, fees });
    expect(r.ebayFeesCents).toBe(Math.round(10000 * (0.136 - 0.009) * 0.9) + 40);
  });
});

describe('priceForTarget', () => {
  it('finds a price that nets at least the target, rounded to .99', () => {
    const price = priceForTarget(1200, 0, defaultFees, defaultRule);
    expect(price % 100).toBe(99);
    const m = computeMargin({ salePriceCents: price, buyerShippingCents: 0, supplierCostCents: 1200, supplierShippingCents: 0, toolFeeCents: 0, fees: defaultFees });
    expect(m.netMarginPct).toBeGreaterThanOrEqual(0.2);
  });
  it('honours the $0.30 small-order fee step and the floor is minimal', () => {
    // $4.00 cost at 10%: the solution sits under $10 where the per-order fee is 30c, not 40c.
    const floor = priceForTarget(400, 0, defaultFees, { ...defaultRule, targetPct: 0.1, roundTo: 'none' });
    const at = (p: number) => computeMargin({ salePriceCents: p, buyerShippingCents: 0, supplierCostCents: 400, supplierShippingCents: 0, toolFeeCents: 0, fees: defaultFees }).netMarginPct;
    expect(floor).toBeLessThanOrEqual(1000);
    expect(at(floor)).toBeGreaterThanOrEqual(0.1);
    expect(at(floor - 1)).toBeLessThan(0.1);
  });
  it('matches the API worked example: $100 + $8 shipping -> $14.69 + $0.40 fees', () => {
    const r = computeMargin({ salePriceCents: 10000, buyerShippingCents: 800, supplierCostCents: 6000, supplierShippingCents: 500, toolFeeCents: 0, fees: defaultFees });
    expect(r.ebayFeesCents).toBe(1509);
    expect(r.netProfitCents).toBe(2791);
  });
  it('returns 0 when the target is impossible', () => {
    expect(priceForTarget(1200, 0, defaultFees, { ...defaultRule, targetPct: 0.9 })).toBe(0);
  });
});

describe('applyRounding', () => {
  it('rounds up to the chosen ending', () => {
    expect(applyRounding(1850, '0.99')).toBe(1899);
    expect(applyRounding(1899, '0.99')).toBe(1899);
    expect(applyRounding(1850, '0.95')).toBe(1895);
    expect(applyRounding(1896, '0.95')).toBe(1995);
    expect(applyRounding(1850, 'none')).toBe(1850);
  });
});

describe('parseCents', () => {
  it('reads typed dollars as exact integer cents', () => {
    expect(parseCents('19.99')).toBe(1999);
    expect(parseCents('0.29')).toBe(29);
    expect(parseCents('8.2')).toBe(820);
    expect(parseCents('12')).toBe(1200);
    expect(parseCents('12.')).toBe(1200);
    expect(parseCents(' $1,234.50 ')).toBe(123450);
    expect(parseCents('1,250')).toBe(125000);
    expect(parseCents('1,250.50')).toBe(125050);
  });
  it('rejects anything that is not a whole number of cents', () => {
    for (const bad of ['', 'abc', '-1', '1.234', '1e3', '1.2.3', '$', '.5', '12,50', ',5', '1,25,0', '1,2345', '1250,']) expect(parseCents(bad), bad).toBeNull();
  });
});
