import { describe, expect, it } from 'vitest';
import {
  complianceGate,
  computeMargin,
  DEFAULT_FEES,
  isAllowedSupplier,
  ManualSupplierConnector,
  ManualSupplierError,
  maxSupplierCostForFloor,
  SUPPLIER_ALLOWLIST,
  withStoreDiscount,
  withTopRatedDiscount,
  type ManualProductLookup,
  type SupplierProduct,
} from '../src/index.js';

const fees = DEFAULT_FEES;
const base = { toolFeeCents: 0, fees };

function meets(sale: number, ship: number, cost: number, floorPct: number, f = fees, tool = 0): boolean {
  return computeMargin({ salePriceCents: sale, buyerShippingCents: ship, supplierCostCents: cost, supplierShippingCents: 0, toolFeeCents: tool, fees: f }).netMarginPct >= floorPct;
}

describe('manual supplier allowlist', () => {
  it('allows manual and still passes the compliance gate', () => {
    expect(SUPPLIER_ALLOWLIST).toContain('manual');
    expect(isAllowedSupplier('manual')).toBe(true);
    expect(isAllowedSupplier('aliexpress')).toBe(false);
    const gate = complianceGate({ supplier: 'manual', title: 'Plain widget', images: ['https://x.test/a.jpg'], supplierHandlingDays: 9, accountHandlingTimeDays: 3, blockedBrands: [] });
    expect(gate).toMatchObject({ ok: false, code: 'HANDLING_TIME_EXCEEDED' });
  });
});

describe('maxSupplierCostForFloor', () => {
  it('is the exact boundary: max cost meets the floor, one cent more does not', () => {
    const sale = 2999;
    const max = maxSupplierCostForFloor({ salePriceCents: sale, buyerShippingCents: 0, floorPct: 0.1, ...base });
    expect(max).toBeGreaterThan(0);
    expect(meets(sale, 0, max, 0.1)).toBe(true);
    expect(meets(sale, 0, max + 1, 0.1)).toBe(false);
    expect(meets(sale, 0, max - 1, 0.1)).toBe(true);
  });

  it('accounts for buyer shipping and the tool fee', () => {
    const withShip = maxSupplierCostForFloor({ salePriceCents: 2000, buyerShippingCents: 500, floorPct: 0.1, ...base });
    const noShip = maxSupplierCostForFloor({ salePriceCents: 2000, buyerShippingCents: 0, floorPct: 0.1, ...base });
    expect(withShip).toBeGreaterThan(noShip);
    const tool = maxSupplierCostForFloor({ salePriceCents: 2000, buyerShippingCents: 0, floorPct: 0.1, toolFeeCents: 25, fees });
    expect(tool).toBeLessThan(noShip);
    expect(meets(2000, 0, tool, 0.1, fees, 25)).toBe(true);
    expect(meets(2000, 0, tool + 1, 0.1, fees, 25)).toBe(false);
  });

  it('clamps at 0 when even a free item misses the floor', () => {
    expect(maxSupplierCostForFloor({ salePriceCents: 100, buyerShippingCents: 0, floorPct: 0.99, ...base })).toBe(0);
    expect(maxSupplierCostForFloor({ salePriceCents: 0, buyerShippingCents: 0, floorPct: 0.1, ...base })).toBe(0);
    expect(maxSupplierCostForFloor({ salePriceCents: 1000, buyerShippingCents: 0, floorPct: Number.NaN, ...base })).toBe(0);
  });

  it('handles a zero floor and the small-order fee step', () => {
    const zero = maxSupplierCostForFloor({ salePriceCents: 1000, buyerShippingCents: 0, floorPct: 0, ...base });
    expect(meets(1000, 0, zero, 0)).toBe(true);
    expect(meets(1000, 0, zero + 1, 0)).toBe(false);
    const big = maxSupplierCostForFloor({ salePriceCents: 1001, buyerShippingCents: 0, floorPct: 0, ...base });
    expect(big).toBeLessThan(zero + 5);
  });

  it('property sweep: agrees with computeMargin at +/-1 cent across prices, floors and fee configs', () => {
    const configs = [fees, withStoreDiscount(fees), withTopRatedDiscount(withStoreDiscount(fees)), { ...fees, promotedPct: 0.05 }];
    let checked = 0;
    for (const f of configs) {
      for (const floorPct of [0, 0.05, 0.1, 0.1337, 0.25, 0.5]) {
        for (let sale = 1; sale <= 20000; sale += sale < 2500 ? 37 : 613) {
          for (const ship of [0, 399]) {
            const max = maxSupplierCostForFloor({ salePriceCents: sale, buyerShippingCents: ship, toolFeeCents: 0, fees: f, floorPct });
            expect(Number.isInteger(max) && max >= 0).toBe(true);
            if (max > 0) {
              expect(meets(sale, ship, max, floorPct, f)).toBe(true);
              expect(meets(sale, ship, max + 1, floorPct, f)).toBe(false);
            } else {
              expect(meets(sale, ship, 1, floorPct, f)).toBe(false);
            }
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

const product: SupplierProduct = {
  supplier: 'manual',
  supplierSku: 'man_1',
  title: 'Widget',
  description: 'd',
  images: ['https://x.test/a.jpg'],
  costCents: 700,
  shippingCents: 150,
  stock: 4,
  warehouseCountry: 'CN',
  handlingDays: 3,
};

describe('ManualSupplierConnector', () => {
  const lookup: ManualProductLookup = {
    find: async (sku) => (sku === product.supplierSku ? product : null),
    findMany: async (skus) => (skus.includes(product.supplierSku) ? [product] : []),
    list: async () => ({ items: [product], total: 1 }),
  };
  const c = new ManualSupplierConnector(lookup);

  it('reads product, stock and price from the lookup', async () => {
    expect(c.supplier).toBe('manual');
    expect(await c.getProduct('man_1')).toEqual(product);
    expect(await c.getProduct('nope')).toBeNull();
    expect(await c.getStockAndPrice(['man_1', 'nope'])).toEqual([{ supplierSku: 'man_1', costCents: 700, shippingCents: 150, stock: 4 }]);
    expect(await c.listCatalog({ page: 1, pageSize: 10 })).toEqual({ items: [product], total: 1 });
  });

  it('never places orders or returns, and has no tracking', async () => {
    const input = { idempotencyKey: 'e1', supplierSku: 'man_1', quantity: 1, shipTo: { line1: 'a', city: 'b', state: 'c', postalCode: 'd', country: 'US' }, buyerName: 'x', now: new Date() };
    await expect(c.placeOrder(input)).rejects.toMatchObject({ name: 'ManualSupplierError', code: 'MANUAL_ORDER' });
    await expect(c.requestReturn({ supplierOrderId: 's', reason: 'r' })).rejects.toBeInstanceOf(ManualSupplierError);
    await expect(c.requestReturn({ supplierOrderId: 's', reason: 'r' })).rejects.toMatchObject({ code: 'MANUAL_RETURN' });
    expect(await c.getTracking('s', new Date())).toBeNull();
    expect(new ManualSupplierError('MANUAL_ORDER', 'custom').message).toBe('custom');
  });
});
