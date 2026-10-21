import { describe, expect, it } from 'vitest';
import {
  complianceGate,
  MockEbay,
  MockSupplier,
  mulberry32,
  NotConfiguredError,
  RealCjDropshipping,
  RealEbay,
  RealSpocket,
  SEED_BLOCKED_BRANDS,
  SEED_ROWS,
} from '../src/index.js';

const shipTo = { line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' };

describe('MockSupplier catalog', () => {
  it('seeds ~60 products across 6 categories with US and CN warehouses', async () => {
    const s = new MockSupplier();
    const page = await s.listCatalog({ page: 1, pageSize: 200 });
    expect(page.total).toBe(SEED_ROWS.length);
    expect(page.total).toBeGreaterThanOrEqual(58);
    expect(new Set(page.items.map((p) => p.categoryHint)).size).toBe(6);
    expect(new Set(page.items.map((p) => p.warehouseCountry))).toEqual(new Set(['US', 'CN']));
    for (const p of page.items) {
      expect(Number.isInteger(p.costCents)).toBe(true);
      expect(p.costCents).toBeGreaterThan(0);
    }
  });

  it('is deterministic for the same seed', async () => {
    const a = await new MockSupplier({ seed: 7 }).listCatalog({ page: 1, pageSize: 200 });
    const b = await new MockSupplier({ seed: 7 }).listCatalog({ page: 1, pageSize: 200 });
    expect(a).toEqual(b);
  });

  it('includes 3 VeRO traps and 2 image-less products', async () => {
    const s = new MockSupplier();
    const { items } = await s.listCatalog({ page: 1, pageSize: 200 });
    const results = items.map((p) =>
      complianceGate({ supplier: p.supplier, brand: p.brand, title: p.title, categoryHint: p.categoryHint, images: p.images, supplierHandlingDays: p.handlingDays, accountHandlingTimeDays: 3, blockedBrands: SEED_BLOCKED_BRANDS }),
    );
    const codes = results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.code));
    expect(codes.filter((c) => c === 'VERO_MATCH')).toHaveLength(3);
    expect(codes.filter((c) => c === 'NO_IMAGES')).toHaveLength(2);
  });

  it('paginates and searches', async () => {
    const s = new MockSupplier();
    const p1 = await s.listCatalog({ page: 1, pageSize: 10 });
    const p2 = await s.listCatalog({ page: 2, pageSize: 10 });
    expect(p1.items).toHaveLength(10);
    expect(p1.items[0]?.supplierSku).not.toBe(p2.items[0]?.supplierSku);
    const q = await s.listCatalog({ page: 1, pageSize: 50, q: 'dog' });
    expect(q.total).toBeGreaterThan(0);
    expect(q.items.every((p) => p.title.toLowerCase().includes('dog'))).toBe(true);
  });
});

describe('MockSupplier drift', () => {
  it('moves ~10% of SKUs by at most +/-15% and is deterministic per rng', async () => {
    const a = new MockSupplier();
    const b = new MockSupplier();
    const before = new Map((await a.listCatalog({ page: 1, pageSize: 200 })).items.map((p) => [p.supplierSku, p.costCents]));
    const ra = a.drift(mulberry32(99));
    const rb = b.drift(mulberry32(99));
    expect(ra).toEqual(rb);
    expect(ra.changed.length).toBeGreaterThanOrEqual(2);
    expect(ra.changed.length).toBeLessThanOrEqual(15);
    for (const sku of ra.changed) {
      const p = await a.getProduct(sku);
      const old = before.get(sku) ?? 0;
      expect(p?.costCents).toBeGreaterThanOrEqual(Math.floor(old * 0.85) - 1);
      expect(p?.costCents).toBeLessThanOrEqual(Math.ceil(old * 1.15) + 1);
    }
  });
});

describe('MockSupplier orders', () => {
  it('placeOrder is idempotent by idempotencyKey and decrements stock once', async () => {
    const s = new MockSupplier({ trackingDelayMs: 1000 });
    const sku = 'HK-002';
    s.setSku(sku, { stock: 10 });
    const now = new Date('2026-10-20T10:00:00Z');
    const a = await s.placeOrder({ idempotencyKey: 'ebay-1', supplierSku: sku, quantity: 1, shipTo, buyerName: 'A', now });
    const b = await s.placeOrder({ idempotencyKey: 'ebay-1', supplierSku: sku, quantity: 1, shipTo, buyerName: 'A', now });
    expect(a).toEqual(b);
    expect(s.orderCount).toBe(1);
    expect((await s.getStockAndPrice([sku]))[0]?.stock).toBe(9);
    const c = await s.placeOrder({ idempotencyKey: 'ebay-2', supplierSku: sku, quantity: 2, shipTo, buyerName: 'B', now });
    expect(c.supplierOrderId).not.toBe(a.supplierOrderId);
    expect(c.costCents).toBe(a.costCents * 2);
  });

  it('tracking appears only after the configured delay', async () => {
    const s = new MockSupplier({ trackingDelayMs: 30_000 });
    s.setSku('PS-001', { stock: 5 });
    const now = new Date('2026-10-20T10:00:00Z');
    const { supplierOrderId } = await s.placeOrder({ idempotencyKey: 'k', supplierSku: 'PS-001', quantity: 1, shipTo, buyerName: 'A', now });
    expect(await s.getTracking(supplierOrderId, new Date(now.getTime() + 29_999))).toBeNull();
    const t = await s.getTracking(supplierOrderId, new Date(now.getTime() + 30_000));
    expect(t?.trackingNumber).toMatch(/^9400/);
    expect(t?.carrier).toBeTruthy();
    expect(await s.getTracking('nope', now)).toBeNull();
  });

  it('rejects unknown SKU and insufficient stock', async () => {
    const s = new MockSupplier();
    const now = new Date();
    await expect(s.placeOrder({ idempotencyKey: 'x', supplierSku: 'NOPE', quantity: 1, shipTo, buyerName: 'A', now })).rejects.toThrow(/unknown SKU/);
    s.setSku('HK-001', { stock: 0 });
    await expect(s.placeOrder({ idempotencyKey: 'y', supplierSku: 'HK-001', quantity: 1, shipTo, buyerName: 'A', now })).rejects.toThrow(/insufficient/);
  });

  it('requestReturn works for known orders', async () => {
    const s = new MockSupplier();
    s.setSku('HK-001', { stock: 3 });
    const { supplierOrderId } = await s.placeOrder({ idempotencyKey: 'r', supplierSku: 'HK-001', quantity: 1, shipTo, buyerName: 'A', now: new Date() });
    expect((await s.requestReturn({ supplierOrderId, reason: 'damaged' })).rmaId).toContain(supplierOrderId);
  });
});

describe('MockEbay', () => {
  it('creates, updates, ends listings and records fulfillments/messages', async () => {
    const e = new MockEbay();
    const { ebayItemId } = await e.createListing({ sku: 'HK-001', title: 't', description: 'd', images: ['i'], priceCents: 1999, buyerShippingCents: 0, quantity: 3, handlingTimeDays: 3 });
    expect(ebayItemId).toMatch(/^mock-/);
    await e.setQuantity(ebayItemId, 0);
    await e.updateListing(ebayItemId, { priceCents: 2099 });
    expect(e.listings.get(ebayItemId)).toMatchObject({ quantity: 0, priceCents: 2099 });
    await e.endListing(ebayItemId);
    expect(e.listings.get(ebayItemId)?.ended).toBe(true);
    await e.createShippingFulfillment({ ebayOrderId: 'o1', trackingNumber: 'tn', carrier: 'USPS', shippedAt: new Date().toISOString() });
    await e.sendBuyerMessage('o1', 'hello');
    expect(e.fulfillments).toHaveLength(1);
    expect(e.messages).toHaveLength(1);
    expect(await e.getPayoutSchedule()).toEqual({ payoutDelayDays: 3, newSellerHold: false });
    expect(await new MockEbay({ newSellerHold: true }).getPayoutSchedule()).toMatchObject({ payoutDelayDays: 30 });
  });
});

describe('real connector scaffolds', () => {
  it('throw NotConfiguredError without credentials', async () => {
    const ebay = new RealEbay({});
    await expect(ebay.getPayoutSchedule()).rejects.toBeInstanceOf(NotConfiguredError);
    expect(() => ebay.authorizeUrl()).toThrow(NotConfiguredError);
    const cj = new RealCjDropshipping({});
    await expect(cj.listCatalog({ page: 1, pageSize: 10 })).rejects.toThrow(/CJ_API_KEY/);
    const sp = new RealSpocket({});
    await expect(sp.getProduct('x')).rejects.toThrow(/SPOCKET_API_KEY/);
  });
  it('builds an authorize URL when app credentials exist', () => {
    const url = new RealEbay({ clientId: 'id', ruName: 'ru', env: 'sandbox' }).authorizeUrl();
    expect(url).toContain('auth.sandbox.ebay.com');
    expect(url).toContain('client_id=id');
  });
});
