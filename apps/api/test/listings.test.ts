import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateTitle } from '../src/services/pricingService.js';
import { createTestApp, type TestApp } from './helpers.js';

interface DiscoveryItem {
  id: string;
  title: string;
  projectedPriceCents: number;
  projectedMarginPct: number;
  compliance: { ok: boolean; code?: string };
  description: string;
}

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => t.close());

describe('discovery', () => {
  it('returns projected prices/margins and visibly blocked items', async () => {
    const res = await t.api<{ items: DiscoveryItem[]; total: number }>('GET', '/discovery?pageSize=100');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(60);
    expect(res.body.items).toHaveLength(60);
    const ok = res.body.items.filter((i) => i.compliance.ok);
    for (const i of ok) {
      expect(i.projectedPriceCents % 100).toBe(99);
      // nearest-.99 rounding may dip a little under target on cheap items, never under the floor
      expect(i.projectedMarginPct).toBeGreaterThanOrEqual(0.1);
      expect(i.projectedMarginPct).toBeGreaterThanOrEqual(0.2 - 50 / i.projectedPriceCents);
    }
    const codes = res.body.items.filter((i) => !i.compliance.ok).map((i) => i.compliance.code);
    expect(codes.filter((c) => c === 'VERO_MATCH')).toHaveLength(3);
    expect(codes.filter((c) => c === 'NO_IMAGES')).toHaveLength(2);
  });

  it('filters by q and minMarginPct, paginates, caps pageSize at 200', async () => {
    const q = await t.api<{ items: DiscoveryItem[] }>('GET', '/discovery?q=dog');
    expect(q.body.items.length).toBeGreaterThan(0);
    expect(q.body.items.every((i) => i.title.toLowerCase().includes('dog'))).toBe(true);
    const m = await t.api<{ items: DiscoveryItem[]; total: number }>('GET', '/discovery?minMarginPct=0.2&pageSize=5&page=2');
    expect(m.body.items.length).toBeLessThanOrEqual(5);
    expect(m.body.items.every((i) => i.projectedMarginPct >= 0.2)).toBe(true);
    const big = await t.api<{ pageSize: number }>('GET', '/discovery?pageSize=999');
    expect(big.body.pageSize).toBe(200);
  });

  it('GET /discovery/:id returns the full description', async () => {
    const list = await t.api<{ items: DiscoveryItem[] }>('GET', '/discovery?pageSize=1');
    const id = list.body.items[0]?.id as string;
    const one = await t.api<DiscoveryItem>('GET', `/discovery/${id}`);
    expect(one.status).toBe(200);
    expect(one.body.description.length).toBeGreaterThan(0);
    expect((await t.api('GET', '/discovery/prd_nope')).status).toBe(404);
  });
});

describe('title generator', () => {
  it('strips boilerplate, dedupes, keeps <= 80 chars', () => {
    const title = generateTitle('Silicone Kitchen Utensil Set 12 Piece Heat Resistant Non-Stick Free Shipping Hot Sale Silicone', 'Home & Kitchen');
    expect(title).not.toMatch(/free shipping|hot sale/i);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.startsWith('Silicone Kitchen Utensil Set')).toBe(true);
    expect((title.match(/silicone/gi) ?? []).length).toBe(1);
    const long = generateTitle('A'.repeat(50) + ' ' + 'B'.repeat(50) + ' ' + 'C'.repeat(20));
    expect(long.length).toBeLessThanOrEqual(80);
  });
});

describe('listings', () => {
  it('creates drafts (blocked products reported), publishes, patches, enforces floor', async () => {
    const disc = await t.api<{ items: DiscoveryItem[] }>('GET', '/discovery?pageSize=100');
    const good = disc.body.items.filter((i) => i.compliance.ok).slice(0, 2).map((i) => i.id);
    const bad = disc.body.items.find((i) => i.compliance.code === 'VERO_MATCH')?.id as string;

    const created = await t.api<{ created: { id: string; status: string; title: string; priceCents: number; floorPriceCents: number; projectedMarginPct: number }[]; blocked: { productId: string; compliance: { code: string } }[] }>('POST', '/listings', { productIds: [...good, bad] });
    expect(created.status).toBe(201);
    expect(created.body.created).toHaveLength(2);
    expect(created.body.blocked).toEqual([{ productId: bad, compliance: expect.objectContaining({ ok: false, code: 'VERO_MATCH' }) }]);
    const draft = created.body.created[0] as { id: string; status: string; title: string; priceCents: number; floorPriceCents: number; projectedMarginPct: number };
    expect(draft.status).toBe('draft');
    expect(draft.title.length).toBeLessThanOrEqual(80);
    expect(draft.floorPriceCents).toBeLessThan(draft.priceCents);
    expect(draft.projectedMarginPct).toBeGreaterThanOrEqual(0.195);

    const below = await t.api<{ error: { code: string } }>('PATCH', `/listings/${draft.id}`, { priceCents: draft.floorPriceCents - 1 });
    expect(below.status).toBe(422);
    expect(below.body.error.code).toBe('PRICE_BELOW_FLOOR');

    const notPublished = await t.api<{ error: { code: string } }>('PATCH', `/listings/${draft.id}`, { status: 'active' });
    expect(notPublished.status).toBe(422);

    const pub = await t.api<{ published: { id: string; status: string; ebayItemId?: string }[]; blocked: unknown[] }>('POST', '/listings/publish', { ids: created.body.created.map((l) => l.id) });
    expect(pub.status).toBe(200);
    expect(pub.body.published).toHaveLength(2);
    expect(pub.body.published[0]?.status).toBe('active');
    expect(pub.body.published[0]?.ebayItemId).toMatch(/^mock-/);
    expect(t.connectors.mockEbay?.listings.size).toBe(2);

    const patched = await t.api<{ priceCents: number; status: string; pauseReason?: string; product: { supplierSku: string } }>('PATCH', `/listings/${draft.id}`, { priceCents: draft.priceCents + 100, status: 'paused', title: 'Custom title' });
    expect(patched.status).toBe(200);
    expect(patched.body.priceCents).toBe(draft.priceCents + 100);
    expect(patched.body.status).toBe('paused');
    expect(patched.body.pauseReason).toBe('manual');
    expect(patched.body.product.supplierSku).toBeTruthy();

    const list = await t.api<{ items: { id: string; status: string; product: { id: string } }[]; total: number }>('GET', '/listings?status=paused');
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]?.product.id).toBeTruthy();
    const search = await t.api<{ total: number }>('GET', '/listings?q=Custom');
    expect(search.body.total).toBe(1);
  });

  it('publish re-runs the compliance gate (VeRO notice added after draft)', async () => {
    const disc = await t.api<{ items: DiscoveryItem[] }>('GET', '/discovery?q=bird&pageSize=5');
    const product = disc.body.items.find((i) => i.compliance.ok) as DiscoveryItem;
    const created = await t.api<{ created: { id: string }[] }>('POST', '/listings', { productIds: [product.id] });
    const id = created.body.created[0]?.id as string;
    await t.db.blockedBrand.create({ data: { id: 'brd_test', pattern: 'Bird Feeder', source: 'vero_notice' } });
    const pub = await t.api<{ published: unknown[]; blocked: { id: string; compliance: { code: string } }[] }>('POST', '/listings/publish', { ids: [id] });
    expect(pub.body.published).toHaveLength(0);
    expect(pub.body.blocked).toEqual([{ id, compliance: expect.objectContaining({ code: 'VERO_MATCH' }) }]);
    const row = await t.db.listing.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('blocked');
    await t.db.blockedBrand.delete({ where: { id: 'brd_test' } });
  });
});
