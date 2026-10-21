import { describe, expect, it } from 'vitest';
import {
  computeMargin,
  DEFAULT_FEES,
  derivePrice,
  priceFloor,
  repriceWithin,
  mulberry32,
  roundToRule,
  roundUpToRule,
  withBelowStandardSurcharge,
  withPromoted,
  withStoreDiscount,
  withTopRatedDiscount,
  type PricingRule,
} from '../src/index.js';

const rule: PricingRule = { floorPct: 0.1, targetPct: 0.2, roundTo: 'none' };

function marginAt(priceCents: number, cost: number, ship: number, buyerShip = 0, fees = DEFAULT_FEES) {
  return computeMargin({ salePriceCents: priceCents, buyerShippingCents: buyerShip, supplierCostCents: cost, supplierShippingCents: ship, toolFeeCents: 0, fees });
}

describe('rounding helpers', () => {
  it('roundToRule picks nearest .99', () => {
    expect(roundToRule(1250, '0.99')).toBe(1299);
    expect(roundToRule(1240, '0.99')).toBe(1199);
    expect(roundToRule(1299, '0.99')).toBe(1299);
    expect(roundToRule(50, '0.99')).toBe(99);
    expect(roundToRule(1250, 'none')).toBe(1250);
  });
  it('roundToRule picks nearest .95', () => {
    expect(roundToRule(1250, '0.95')).toBe(1295);
    expect(roundToRule(1240, '0.95')).toBe(1195);
  });
  it('roundUpToRule never rounds down', () => {
    expect(roundUpToRule(1240, '0.99')).toBe(1299);
    expect(roundUpToRule(1299, '0.99')).toBe(1299);
    expect(roundUpToRule(1300, '0.99')).toBe(1399);
    expect(roundUpToRule(1296, '0.95')).toBe(1395);
  });
});

describe('derivePrice', () => {
  const cases: [cost: number, ship: number, buyerShip: number][] = [
    [1140, 0, 0],
    [6000, 500, 800],
    [350, 150, 0],
    [2890, 0, 599],
    [50, 0, 0],
    [12345, 1234, 0],
  ];

  it.each(cases)('round-trips to >= target - 0.5pt (cost %i, ship %i, buyerShip %i)', (cost, ship, buyerShip) => {
    for (const roundTo of ['none', '0.99', '0.95'] as const) {
      const price = derivePrice({ supplierCostCents: cost, supplierShippingCents: ship, toolFeeCents: 0, fees: DEFAULT_FEES, rule: { ...rule, roundTo }, buyerShippingCents: buyerShip });
      const m = marginAt(price, cost, ship, buyerShip);
      expect(m.netMarginPct).toBeGreaterThanOrEqual(rule.targetPct - 0.005);
      expect(m.netMarginPct).toBeGreaterThanOrEqual(rule.floorPct);
      expect(Number.isInteger(price)).toBe(true);
      if (roundTo === '0.99') expect(price % 100).toBe(99);
      if (roundTo === '0.95') expect(price % 100).toBe(95);
    }
  });

  it('with no rounding hits the target almost exactly', () => {
    const price = derivePrice({ supplierCostCents: 6000, supplierShippingCents: 500, toolFeeCents: 0, fees: DEFAULT_FEES, rule, buyerShippingCents: 0 });
    const m = marginAt(price, 6000, 500);
    expect(m.netMarginPct).toBeGreaterThanOrEqual(0.2);
    expect(m.netMarginPct).toBeLessThan(0.202);
  });

  it('respects fee variants', () => {
    const fees = withStoreDiscount(DEFAULT_FEES);
    const price = derivePrice({ supplierCostCents: 2000, supplierShippingCents: 0, toolFeeCents: 0, fees, rule, buyerShippingCents: 0 });
    expect(marginAt(price, 2000, 0, 0, fees).netMarginPct).toBeGreaterThanOrEqual(0.2);
    const priceDefault = derivePrice({ supplierCostCents: 2000, supplierShippingCents: 0, toolFeeCents: 0, fees: DEFAULT_FEES, rule, buyerShippingCents: 0 });
    expect(price).toBeLessThan(priceDefault);
  });

  it('includes tool fee in the cost base', () => {
    const a = derivePrice({ supplierCostCents: 2000, supplierShippingCents: 0, toolFeeCents: 0, fees: DEFAULT_FEES, rule, buyerShippingCents: 0 });
    const b = derivePrice({ supplierCostCents: 2000, supplierShippingCents: 0, toolFeeCents: 100, fees: DEFAULT_FEES, rule, buyerShippingCents: 0 });
    expect(b).toBeGreaterThan(a);
  });

  it('floor guard: rounding down never breaks the floor', () => {
    // Target barely above floor so nearest-.99 rounding would dip under.
    const tight: PricingRule = { floorPct: 0.2, targetPct: 0.2, roundTo: '0.99' };
    for (let cost = 300; cost < 5000; cost += 137) {
      const price = derivePrice({ supplierCostCents: cost, supplierShippingCents: 0, toolFeeCents: 0, fees: DEFAULT_FEES, rule: tight, buyerShippingCents: 0 });
      expect(price % 100).toBe(99);
      expect(marginAt(price, cost, 0).netMarginPct).toBeGreaterThanOrEqual(0.2);
    }
  });

  it('throws when the target is unreachable', () => {
    expect(() => derivePrice({ supplierCostCents: 1000, supplierShippingCents: 0, toolFeeCents: 0, fees: DEFAULT_FEES, rule: { ...rule, targetPct: 0.9 }, buyerShippingCents: 0 })).toThrow(RangeError);
  });
});

describe('priceFloor', () => {
  it('is the minimum price meeting floorPct', () => {
    const floor = priceFloor({ supplierCostCents: 6000, supplierShippingCents: 500, toolFeeCents: 0, fees: DEFAULT_FEES, floorPct: 0.1, buyerShippingCents: 800 });
    expect(marginAt(floor, 6000, 500, 800).netMarginPct).toBeGreaterThanOrEqual(0.1);
    expect(marginAt(floor - 1, 6000, 500, 800).netMarginPct).toBeLessThan(0.1);
  });
  it('handles the small-order fee step', () => {
    const floor = priceFloor({ supplierCostCents: 400, supplierShippingCents: 0, toolFeeCents: 0, fees: DEFAULT_FEES, floorPct: 0.1, buyerShippingCents: 0 });
    expect(floor).toBeLessThanOrEqual(1000);
    expect(marginAt(floor, 400, 0).netMarginPct).toBeGreaterThanOrEqual(0.1);
    expect(marginAt(floor - 1, 400, 0).netMarginPct).toBeLessThan(0.1);
  });
});

describe('repriceWithin', () => {
  it('undercuts competitor by 1c by default', () => {
    expect(repriceWithin(1000, 1500, 1400)).toBe(1399);
  });
  it('never goes below floor', () => {
    expect(repriceWithin(1000, 1500, 900)).toBe(1000);
    expect(repriceWithin(1000, 1500, 1000)).toBe(1000);
  });
  it('never exceeds target when competitor is far above', () => {
    expect(repriceWithin(1000, 1500, 9000)).toBe(1500);
  });
  it('supports a custom undercut', () => {
    expect(repriceWithin(1000, 1500, 1400, 50)).toBe(1350);
  });
});

describe('derivePrice / priceFloor properties', () => {
  const feeSets = [
    DEFAULT_FEES,
    withStoreDiscount(DEFAULT_FEES),
    withTopRatedDiscount(DEFAULT_FEES),
    withBelowStandardSurcharge(DEFAULT_FEES),
    withPromoted(DEFAULT_FEES, 0.05),
  ];

  it('holds over 500 random cost/shipping/fee/rule combos', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i += 1) {
      const cost = 1 + Math.floor(rng() * 20000);
      const ship = Math.floor(rng() * 1500);
      const buyerShip = rng() < 0.5 ? 0 : Math.floor(rng() * 1500);
      const tool = rng() < 0.2 ? Math.floor(rng() * 100) : 0;
      const fees = feeSets[Math.floor(rng() * feeSets.length)] ?? DEFAULT_FEES;
      const floorPct = Math.round(rng() * 30) / 100;
      const targetPct = floorPct + Math.round(rng() * 30) / 100;
      const roundTo = (['none', '0.99', '0.95'] as const)[Math.floor(rng() * 3)] ?? 'none';
      const base = { supplierCostCents: cost, supplierShippingCents: ship, toolFeeCents: tool, fees, buyerShippingCents: buyerShip };
      const m = (p: number) => computeMargin({ salePriceCents: p, buyerShippingCents: buyerShip, supplierCostCents: cost, supplierShippingCents: ship, toolFeeCents: tool, fees }).netMarginPct;
      const label = JSON.stringify({ cost, ship, buyerShip, tool, floorPct, targetPct, roundTo });

      // priceFloor: minimum integer-cent price meeting the floor.
      const floor = priceFloor({ ...base, floorPct });
      expect(Number.isInteger(floor), label).toBe(true);
      expect(m(floor), label).toBeGreaterThanOrEqual(floorPct);
      if (floor > 1) expect(m(floor - 1), label).toBeLessThan(floorPct);

      // derivePrice: >= target - 0.5pt, never below the floor, correct suffix.
      const price = derivePrice({ ...base, rule: { floorPct, targetPct, roundTo } });
      expect(Number.isInteger(price), label).toBe(true);
      expect(price, label).toBeGreaterThanOrEqual(floor);
      expect(m(price), label).toBeGreaterThanOrEqual(targetPct - 0.005);
      expect(m(price), label).toBeGreaterThanOrEqual(floorPct);
      if (roundTo === '0.99') expect(price % 100, label).toBe(99);
      if (roundTo === '0.95') expect(price % 100, label).toBe(95);
    }
  });

  it('cheap items bump up to the next suffix instead of rounding several points under target', () => {
    // cost $8.65 + $1.43 ship, target 9%: nearest .99 is $12.99 (7.1%); $13.99 is required.
    const price = derivePrice({ supplierCostCents: 865, supplierShippingCents: 143, toolFeeCents: 0, fees: DEFAULT_FEES, rule: { floorPct: 0.03, targetPct: 0.09, roundTo: '0.99' }, buyerShippingCents: 0 });
    expect(price).toBe(1399);
    expect(marginAt(price, 865, 143).netMarginPct).toBeGreaterThanOrEqual(0.085);
  });
});
