import { describe, expect, it } from 'vitest';
import {
  brandMatcher,
  complianceGate,
  findBlockedBrand,
  isAllowedSupplier,
  SEED_BLOCKED_BRANDS,
  SUPPLIER_ALLOWLIST,
  type ComplianceInput,
} from '../src/index.js';

const ok: ComplianceInput = {
  supplier: 'mock',
  brand: 'Generic',
  title: 'Stainless Steel Insulated Tumbler 30oz',
  categoryHint: 'Home & Kitchen',
  images: ['https://img.test/a.jpg'],
  supplierHandlingDays: 2,
  accountHandlingTimeDays: 3,
  blockedBrands: SEED_BLOCKED_BRANDS,
};

describe('allowlist', () => {
  it('contains exactly the three suppliers', () => {
    expect([...SUPPLIER_ALLOWLIST]).toEqual(['mock', 'cjdropshipping', 'spocket']);
    expect(isAllowedSupplier('amazon')).toBe(false);
    expect(isAllowedSupplier('spocket')).toBe(true);
  });
});

describe('brand matching', () => {
  it('is case-insensitive and whole-word', () => {
    expect(brandMatcher('Nike').test('nike running shoes')).toBe(true);
    expect(brandMatcher('Nike').test('Nikeys brand')).toBe(false);
    expect(brandMatcher('Apple').test('Pineapple slicer')).toBe(false);
    expect(brandMatcher('Apple').test('Apple Watch band')).toBe(true);
  });
  it('treats hyphen and space interchangeably', () => {
    expect(findBlockedBrand('ray ban style sunglasses', SEED_BLOCKED_BRANDS)).toBe('Ray-Ban');
    expect(findBlockedBrand('RayBan sunglasses', SEED_BLOCKED_BRANDS)).toBe('Ray-Ban');
  });
  it('seeds ~25 brands', () => {
    expect(SEED_BLOCKED_BRANDS.length).toBeGreaterThanOrEqual(25);
  });
});

describe('complianceGate', () => {
  it('passes a clean product', () => {
    expect(complianceGate(ok)).toEqual({ ok: true });
  });

  it('SUPPLIER_NOT_ALLOWED', () => {
    const r = complianceGate({ ...ok, supplier: 'aliexpress' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('SUPPLIER_NOT_ALLOWED');
  });

  it('VERO_MATCH on brand', () => {
    const r = complianceGate({ ...ok, brand: 'Nike' });
    expect(r).toMatchObject({ ok: false, code: 'VERO_MATCH' });
  });

  it('VERO_MATCH on title', () => {
    const r = complianceGate({ ...ok, brand: undefined, title: 'Lego compatible building bricks' });
    expect(r).toMatchObject({ ok: false, code: 'VERO_MATCH' });
  });

  it('VERO_MATCH honours extra patterns from VeRO notices', () => {
    const r = complianceGate({ ...ok, title: 'Acme Widget', blockedBrands: [...SEED_BLOCKED_BRANDS, 'Acme'] });
    expect(r).toMatchObject({ ok: false, code: 'VERO_MATCH', detail: expect.stringContaining('Acme') });
  });

  it('RESTRICTED_CATEGORY from hint and title', () => {
    expect(complianceGate({ ...ok, categoryHint: 'Medical Devices' })).toMatchObject({ ok: false, code: 'RESTRICTED_CATEGORY' });
    expect(complianceGate({ ...ok, title: 'AR-15 firearm parts kit' })).toMatchObject({ ok: false, code: 'RESTRICTED_CATEGORY' });
    expect(complianceGate({ ...ok, title: 'Recalled infant sleeper' })).toMatchObject({ ok: false, code: 'RESTRICTED_CATEGORY' });
    expect(complianceGate({ ...ok, title: 'Disposable vape pen' })).toMatchObject({ ok: false, code: 'RESTRICTED_CATEGORY' });
    expect(complianceGate({ ...ok, categoryHint: 'Tobacco' })).toMatchObject({ ok: false, code: 'RESTRICTED_CATEGORY' });
    expect(complianceGate({ ...ok, title: 'Gun holster kit' })).toMatchObject({ ok: false, code: 'RESTRICTED_CATEGORY' });
  });

  it('does not flag harmless "gun" products', () => {
    expect(complianceGate({ ...ok, title: 'Massage Gun Deep Tissue 6 Heads' })).toEqual({ ok: true });
    expect(complianceGate({ ...ok, title: 'Hot Glue Gun Kit with 30 Sticks' })).toEqual({ ok: true });
  });

  it('NO_IMAGES', () => {
    expect(complianceGate({ ...ok, images: [] })).toMatchObject({ ok: false, code: 'NO_IMAGES' });
    expect(complianceGate({ ...ok, images: ['  '] })).toMatchObject({ ok: false, code: 'NO_IMAGES' });
  });

  it('HANDLING_TIME_EXCEEDED', () => {
    expect(complianceGate({ ...ok, supplierHandlingDays: 5 })).toMatchObject({ ok: false, code: 'HANDLING_TIME_EXCEEDED' });
    expect(complianceGate({ ...ok, supplierHandlingDays: 3 })).toEqual({ ok: true });
  });

  it('checks in priority order: supplier before brand', () => {
    expect(complianceGate({ ...ok, supplier: 'amazon', brand: 'Nike', images: [] })).toMatchObject({ code: 'SUPPLIER_NOT_ALLOWED' });
  });
});
