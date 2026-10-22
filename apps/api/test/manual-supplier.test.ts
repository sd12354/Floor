import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import { createTestApp, publishOne, type TestApp } from './helpers.js';

interface Prod {
  id: string;
  supplier: string;
  supplierSku: string;
  title: string;
  costCents: number;
  shippingCents: number;
  stock: number;
  handlingDays: number;
  warehouseCountry: string;
  supplierUrl?: string;
}
interface Ord {
  id: string;
  status: string;
  ebayOrderId: string;
  supplierOrderId?: string;
  supplierCostCents?: number;
  supplierShippingCents?: number;
  ebayFeesCents?: number;
  netProfitCents?: number;
  trackingNumber?: string;
  carrier?: string;
  payoutExpectedAt?: string;
  deliveredAt?: string;
}
interface OrdDetail extends Ord {
  supplier?: { kind: string; url?: string; title: string; supplierSku: string };
  maxSupplierCostCents?: number;
  events: { type: string; payload: Record<string, unknown> }[];
  messages: { kind: string }[];
  ledger: { kind: string; amountCents: number }[];
}
interface Lst {
  id: string;
  status: string;
  priceCents: number;
  pauseReason?: string;
  ebayItemId?: string;
}
interface ApiError {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

const goodProduct = {
  title: 'Bamboo Desk Organizer Set',
  description: 'Five-piece bamboo organizer for desks.',
  images: ['https://cdn.example.com/organizer-1.jpg', 'https://cdn.example.com/organizer-2.jpg'],
  costCents: 1000,
  shippingCents: 200,
  stock: 40,
  handlingDays: 3,
  supplierUrl: 'https://www.alibaba.com/product-detail/organizer_1600.html',
};

let t: TestApp;

async function addProduct(over: Record<string, unknown> = {}): Promise<Prod> {
  const res = await t.api<Prod>('POST', '/manual-products', { ...goodProduct, ...over });
  expect(res.status).toBe(201);
  return res.body;
}

async function listAndPublish(productId: string): Promise<Lst> {
  const created = await t.api<{ created: Lst[]; blocked: unknown[] }>('POST', '/listings', { productIds: [productId] });
  expect(created.status).toBe(201);
  const draft = created.body.created[0];
  if (!draft) throw new Error(`no draft: ${JSON.stringify(created.body.blocked)}`);
  const pub = await t.api<{ published: Lst[] }>('POST', '/listings/publish', { ids: [draft.id] });
  const listing = pub.body.published[0];
  if (!listing) throw new Error('not published');
  return listing;
}

async function manualListing(over: Record<string, unknown> = {}): Promise<{ product: Prod; listing: Lst }> {
  const product = await addProduct(over);
  return { product, listing: await listAndPublish(product.id) };
}

async function simulate(listingId: string, extra: Record<string, unknown> = {}): Promise<Ord> {
  const res = await t.api<Ord>('POST', '/orders/simulate', { listingId, ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

const detail = async (id: string) => (await t.api<OrdDetail>('GET', `/orders/${id}`)).body;
const err = (r: { body: unknown }) => (r.body as ApiError).error;

beforeAll(async () => {
  t = await createTestApp({ dailySpendCapCents: 100_000 });
  const conn = await t.api<{ supplier: string; status: string; label: string }>('POST', '/suppliers', { supplier: 'manual' });
  expect(conn.status).toBe(201);
});
afterAll(async () => t.close());

describe('connecting the manual supplier', () => {
  it('connects with the contract label and needs no credentials', async () => {
    const res = await t.api<{ supplier: string; status: string; label: string }>('POST', '/suppliers', { supplier: 'manual' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ supplier: 'manual', status: 'connected', label: 'Manual supplier (Alibaba, CJ, any wholesaler)' });
    const account = await t.api<{ supplierConnections: { supplier: string }[] }>('GET', '/account');
    expect(account.body.supplierConnections.map((c) => c.supplier).sort()).toEqual(['manual', 'mock']);
  });

  it('is allowed in real mode too, while real mode still refuses the mock supplier', async () => {
    const real = await buildServer({ config: loadConfig({ databaseUrl: 'file:unused', mode: 'real', nodeEnv: 'test', schedulerEnabled: false }), db: t.db });
    await real.ready();
    const call = (body: unknown) =>
      real.inject({ method: 'POST', url: '/api/v1/suppliers', headers: { authorization: `Bearer ${t.seller.token}`, 'x-account-id': 'acc_demo', 'content-type': 'application/json' }, payload: JSON.stringify(body) });
    const manual = await call({ supplier: 'manual' });
    expect(manual.statusCode).toBe(201);
    expect(JSON.parse(manual.body)).toMatchObject({ supplier: 'manual', status: 'connected' });
    const mock = await call({ supplier: 'mock' });
    expect(mock.statusCode).toBe(422);
    expect(JSON.parse(mock.body).error.code).toBe('SUPPLIER_NOT_AVAILABLE');
    await real.close();
  });

  it('keeps refusing suppliers that are not on the allowlist', async () => {
    const res = await t.api<ApiError>('POST', '/suppliers', { supplier: 'aliexpress' });
    expect(res.status).toBe(422);
    expect(err(res).code).toBe('SUPPLIER_NOT_ALLOWED');
  });
});

describe('manual products CRUD', () => {
  it('creates with generated sku, defaults and listing in newest-first order', async () => {
    const a = await addProduct({ title: 'Older manual widget' });
    const b = await addProduct({ title: 'Newer manual widget', warehouseCountry: 'us', brand: 'Acme' });
    expect(a).toMatchObject({ supplier: 'manual', warehouseCountry: 'CN', handlingDays: 3, supplierUrl: goodProduct.supplierUrl });
    expect(a.supplierSku).toMatch(/^man_[\w-]{6,}$/);
    expect(b.warehouseCountry).toBe('US');
    const list = await t.api<{ items: Prod[]; total: number }>('GET', '/manual-products');
    expect(list.status).toBe(200);
    const ids = list.body.items.map((p) => p.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    expect(list.body.items.every((p) => p.supplier === 'manual')).toBe(true);
    expect(list.body.total).toBe(list.body.items.length);
  });

  it('shows manual products in discovery with a compliance verdict', async () => {
    const p = await addProduct({ title: 'Discoverable manual gadget' });
    const res = await t.api<{ items: (Prod & { compliance: { ok: boolean }; projectedPriceCents: number })[] }>('GET', '/discovery?supplier=manual&q=Discoverable');
    const item = res.body.items.find((i) => i.id === p.id);
    expect(item?.compliance.ok).toBe(true);
    expect(item?.projectedPriceCents).toBeGreaterThan(p.costCents);
  });

  it('validates input: https-only urls, ranges, lengths', async () => {
    const bad: Record<string, unknown>[] = [
      { title: 'ab' },
      { title: 'x'.repeat(81) },
      { description: '' },
      { images: [] },
      { images: Array.from({ length: 13 }, (_, i) => `https://cdn.example.com/${i}.jpg`) },
      { images: ['http://cdn.example.com/a.jpg'] },
      { images: ['not a url'] },
      { costCents: 0 },
      { costCents: 10.5 },
      { shippingCents: -1 },
      { stock: -1 },
      { handlingDays: 0 },
      { handlingDays: 61 },
      { warehouseCountry: 'CHN' },
      { supplierUrl: 'http://www.alibaba.com/x' },
      { supplierUrl: 'javascript:alert(1)' },
    ];
    for (const over of bad) {
      const res = await t.api<ApiError>('POST', '/manual-products', { ...goodProduct, ...over });
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(err(res).code).toBe('VALIDATION');
    }
    const missing = await t.api<ApiError>('POST', '/manual-products', { title: 'Only a title' });
    expect(missing.status).toBe(400);
    const patchBad = await t.api<ApiError>('PATCH', `/manual-products/${(await addProduct()).id}`, { supplierUrl: 'http://x.test' });
    expect(patchBad.status).toBe(400);
    expect(err(patchBad).code).toBe('VALIDATION');
    const edge = await t.api<Prod>('POST', '/manual-products', { ...goodProduct, title: 'abc', stock: 0, shippingCents: 0, handlingDays: 60, images: Array.from({ length: 12 }, (_, i) => `https://cdn.example.com/${i}.jpg`) });
    expect(edge.status).toBe(201);
  });

  it('requires a connected manual supplier to add products', async () => {
    const conns = await t.api<{ supplierConnections: { id: string; supplier: string }[] }>('GET', '/account');
    const manual = conns.body.supplierConnections.find((c) => c.supplier === 'manual');
    expect((await t.api('DELETE', `/suppliers/${manual?.id}`)).status).toBe(204);
    const res = await t.api<ApiError>('POST', '/manual-products', goodProduct);
    expect(res.status).toBe(422);
    expect(err(res).code).toBe('SUPPLIER_NOT_CONNECTED');
    await t.api('POST', '/suppliers', { supplier: 'manual' });
    expect((await t.api('POST', '/manual-products', goodProduct)).status).toBe(201);
  });

  it('PATCH updates fields, clears optional ones with null, and 404s on unknown or non-manual products', async () => {
    const p = await addProduct({ brand: 'Acme' });
    const res = await t.api<Prod & { brand?: string }>('PATCH', `/manual-products/${p.id}`, { title: 'Renamed organizer', brand: null, supplierUrl: null, handlingDays: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Renamed organizer', handlingDays: 2 });
    expect(res.body.brand).toBeUndefined();
    expect(res.body.supplierUrl).toBeUndefined();
    expect(res.body.supplierSku).toBe(p.supplierSku);
    expect((await t.api('PATCH', `/manual-products/${p.id}`, {})).status).toBe(200);
    expect((await t.api('PATCH', '/manual-products/prd_missing', { stock: 1 })).status).toBe(404);
    const auto = await t.db.product.findFirstOrThrow({ where: { supplier: 'mock' } });
    expect((await t.api('PATCH', `/manual-products/${auto.id}`, { stock: 1 })).status).toBe(404);
    expect((await t.api('DELETE', `/manual-products/${auto.id}`)).status).toBe(404);
  });

  it('PATCH cost/stock sweeps only that product: reprices, pauses at stock 0 and resumes', async () => {
    const { product, listing } = await manualListing({ title: 'Sweep target gadget' });
    const other = await manualListing({ title: 'Untouched sibling gadget' });
    const before = listing.priceCents;
    const item = (await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } })).ebayItemId as string;

    const up = await t.api<Prod>('PATCH', `/manual-products/${product.id}`, { costCents: 1200 });
    expect(up.status).toBe(200);
    const repriced = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(repriced.priceCents).toBeGreaterThan(before);
    expect(repriced.status).toBe('active');
    expect(t.connectors.mockEbay?.listings.get(item)?.priceCents).toBe(repriced.priceCents);

    const down = await t.api('PATCH', `/manual-products/${product.id}`, { costCents: 1050 });
    expect(down.status).toBe(200);
    expect((await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } })).priceCents).toBeLessThan(repriced.priceCents);

    await t.api('PATCH', `/manual-products/${product.id}`, { stock: 0 });
    const paused = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(paused).toMatchObject({ status: 'paused', pauseReason: 'out_of_stock' });
    expect(t.connectors.mockEbay?.listings.get(item)?.quantity).toBe(0);

    await t.api('PATCH', `/manual-products/${product.id}`, { stock: 5 });
    expect((await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe('active');
    expect((await t.db.listing.findUniqueOrThrow({ where: { id: other.listing.id } })).priceCents).toBe(other.listing.priceCents);
  });

  it('a manual product is never overwritten by the supplier sweep', async () => {
    const { product } = await manualListing({ title: 'Sweep proof gadget', costCents: 1111 });
    await t.api('POST', '/listings/sync');
    await t.app.jobs.tick();
    const row = await t.db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row).toMatchObject({ costCents: 1111, shippingCents: 200, stock: 40 });
  });

  it('DELETE removes unused products and their drafts, but refuses PRODUCT_IN_USE', async () => {
    const unused = await addProduct({ title: 'Removable draft gadget' });
    const draft = await t.api<{ created: Lst[] }>('POST', '/listings', { productIds: [unused.id] });
    const draftId = draft.body.created[0]?.id as string;
    expect((await t.api('DELETE', `/manual-products/${unused.id}`)).status).toBe(204);
    expect(await t.db.listing.findUnique({ where: { id: draftId } })).toBeNull();
    expect((await t.api('DELETE', `/manual-products/${unused.id}`)).status).toBe(404);

    const live = await manualListing({ title: 'Live listing gadget' });
    const blockedByListing = await t.api<ApiError>('DELETE', `/manual-products/${live.product.id}`);
    expect(blockedByListing.status).toBe(422);
    expect(err(blockedByListing).code).toBe('PRODUCT_IN_USE');

    await t.api('PATCH', `/listings/${live.listing.id}`, { status: 'paused' });
    await t.db.listing.update({ where: { id: live.listing.id }, data: { status: 'draft' } });
    const ordered = await manualListing({ title: 'Ordered gadget' });
    await simulate(ordered.listing.id);
    await t.db.listing.update({ where: { id: ordered.listing.id }, data: { status: 'draft' } });
    const blockedByOrder = await t.api<ApiError>('DELETE', `/manual-products/${ordered.product.id}`);
    expect(blockedByOrder.status).toBe(422);
    expect(err(blockedByOrder).code).toBe('PRODUCT_IN_USE');
    // A draft-only product with no orders is fine.
    expect((await t.api('DELETE', `/manual-products/${live.product.id}`)).status).toBe(204);
  });
});

describe('lead time vs handling time', () => {
  it('blocks listing a product whose lead time exceeds the account handling time', async () => {
    const p = await addProduct({ title: 'Slow boat gadget', handlingDays: 10 });
    const res = await t.api<{ created: Lst[]; blocked: { productId: string; compliance: { ok: boolean; code: string } }[] }>('POST', '/listings', { productIds: [p.id] });
    expect(res.body.created).toHaveLength(0);
    expect(res.body.blocked[0]).toMatchObject({ productId: p.id, compliance: { ok: false, code: 'HANDLING_TIME_EXCEEDED' } });
  });

  it('blocks publishing a draft once the lead time is raised past the handling time', async () => {
    const p = await addProduct({ title: 'Lead time creep gadget' });
    const draft = (await t.api<{ created: Lst[] }>('POST', '/listings', { productIds: [p.id] })).body.created[0] as Lst;
    await t.api('PATCH', `/manual-products/${p.id}`, { handlingDays: 12 });
    const pub = await t.api<{ published: Lst[]; blocked: { id: string; compliance: { code: string } }[] }>('POST', '/listings/publish', { ids: [draft.id] });
    expect(pub.body.published).toHaveLength(0);
    expect(pub.body.blocked[0]).toMatchObject({ id: draft.id, compliance: { code: 'HANDLING_TIME_EXCEEDED' } });
  });

  it('blocks a live listing on the next sweep when the lead time grows', async () => {
    const { product, listing } = await manualListing({ title: 'Live lead time gadget' });
    await t.api('PATCH', `/manual-products/${product.id}`, { handlingDays: 30 });
    const row = await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } });
    expect(row).toMatchObject({ status: 'blocked', pauseReason: 'HANDLING_TIME_EXCEEDED' });
  });
});

describe('manual order flow', () => {
  it('happy path: sale -> awaiting_supplier -> quote -> supplier order -> tracking -> delivered', async () => {
    const { product, listing } = await manualListing({ title: 'Happy path organizer' });
    const order = await simulate(listing.id, { buyerName: 'Grace Hopper' });
    expect(order.status).toBe('awaiting_supplier');
    expect(order.supplierOrderId).toBeUndefined();

    const awaiting = await detail(order.id);
    expect(awaiting.ledger).toEqual([]);
    expect(awaiting.events.map((e) => e.type)).toContain('order.awaiting_supplier');
    expect(awaiting.supplier).toEqual({ kind: 'manual', url: goodProduct.supplierUrl, title: 'Happy path organizer', supplierSku: product.supplierSku });
    expect(awaiting.maxSupplierCostCents).toBeGreaterThan(product.costCents + product.shippingCents);
    const list = await t.api<{ items: Ord[] }>('GET', '/orders?status=awaiting_supplier');
    expect(list.body.items.map((o) => o.id)).toContain(order.id);

    const quote = await t.api<{ netProfitCents: number; netMarginPct: number; ebayFeesCents: number; maxSupplierCostCents: number; meetsFloor: boolean }>(
      'POST',
      `/orders/${order.id}/supplier-quote`,
      { costCents: 1000, shippingCents: 200 },
    );
    expect(quote.status).toBe(200);
    expect(quote.body.meetsFloor).toBe(true);
    expect(quote.body.maxSupplierCostCents).toBe(awaiting.maxSupplierCostCents);
    expect(quote.body.netProfitCents).toBeGreaterThan(0);
    expect((await detail(order.id)).status).toBe('awaiting_supplier');

    const placed = await t.api<Ord>('POST', `/orders/${order.id}/supplier-order`, { supplierOrderId: 'ALI-778812', costCents: 1000, shippingCents: 200 });
    expect(placed.status).toBe(200);
    expect(placed.body).toMatchObject({ status: 'ordered', supplierOrderId: 'ALI-778812', supplierCostCents: 1000, supplierShippingCents: 200 });
    expect(placed.body.ebayFeesCents).toBe(quote.body.ebayFeesCents);
    expect(placed.body.netProfitCents).toBe(quote.body.netProfitCents);
    const ordered = await detail(order.id);
    expect(ordered.ledger.map((e) => e.kind).sort()).toEqual(['ebay_fee', 'sale', 'supplier_cost', 'supplier_shipping']);
    expect(ordered.ledger.find((e) => e.kind === 'supplier_cost')?.amountCents).toBe(-1000);
    expect(ordered.ledger.find((e) => e.kind === 'supplier_shipping')?.amountCents).toBe(-200);
    const booked = ordered.events.find((e) => e.type === 'order.supplier_ordered');
    expect(booked?.payload).toMatchObject({ confirmBelowFloor: false });
    expect(ordered.messages.map((m) => m.kind)).toContain('order_confirmed');

    const track = await t.api<Ord>('POST', `/orders/${order.id}/tracking`, { trackingNumber: 'YT2412345678', carrier: 'YunExpress' });
    expect(track.status).toBe(200);
    expect(track.body).toMatchObject({ status: 'shipped', trackingNumber: 'YT2412345678', carrier: 'YunExpress' });
    expect(track.body.payoutExpectedAt).toBeTruthy();
    expect(t.connectors.mockEbay?.fulfillments.find((f) => f.ebayOrderId === order.ebayOrderId)).toMatchObject({ trackingNumber: 'YT2412345678', carrier: 'YunExpress' });
    const shipped = await detail(order.id);
    expect(shipped.events.map((e) => e.type)).toContain('order.shipped');
    expect(shipped.messages.map((m) => m.kind)).toContain('shipped');

    const done = await t.api<Ord>('POST', `/orders/${order.id}/delivered`);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('delivered');
    expect(done.body.deliveredAt).toBeTruthy();
    const final = await detail(order.id);
    expect(final.events.map((e) => e.type)).toEqual(expect.arrayContaining(['order.delivered_manual', 'order.delivered']));
    expect(final.messages.map((m) => m.kind)).toContain('delivered');
    // Repeat is a no-op.
    expect((await t.api<Ord>('POST', `/orders/${order.id}/delivered`)).body.status).toBe('delivered');
  });

  it('rejects a supplier order below the floor (BELOW_FLOOR) until confirmBelowFloor is sent', async () => {
    const { listing } = await manualListing({ title: 'Below floor organizer' });
    const order = await simulate(listing.id);
    const max = (await detail(order.id)).maxSupplierCostCents as number;
    const overpay = max + 150;

    const quote = await t.api<{ meetsFloor: boolean; maxSupplierCostCents: number }>('POST', `/orders/${order.id}/supplier-quote`, { costCents: overpay - 200, shippingCents: 200 });
    expect(quote.body).toMatchObject({ meetsFloor: false, maxSupplierCostCents: max });

    const refused = await t.api<ApiError>('POST', `/orders/${order.id}/supplier-order`, { supplierOrderId: 'ALI-1', costCents: overpay - 200, shippingCents: 200 });
    expect(refused.status).toBe(422);
    expect(err(refused).code).toBe('BELOW_FLOOR');
    expect(err(refused).details).toMatchObject({ maxSupplierCostCents: max });
    expect(err(refused).details?.netMarginPct).toBeLessThan(0.1);
    expect(typeof err(refused).details?.netProfitCents).toBe('number');
    const unchanged = await detail(order.id);
    expect(unchanged.status).toBe('awaiting_supplier');
    expect(unchanged.ledger).toEqual([]);

    // Exactly at the maximum is still fine one call later; one cent over is not.
    const oneOver = await t.api<ApiError>('POST', `/orders/${order.id}/supplier-order`, { supplierOrderId: 'ALI-1', costCents: max - 199, shippingCents: 200 });
    expect(err(oneOver).code).toBe('BELOW_FLOOR');

    const forced = await t.api<Ord>('POST', `/orders/${order.id}/supplier-order`, { supplierOrderId: 'ALI-1', costCents: overpay - 200, shippingCents: 200, confirmBelowFloor: true });
    expect(forced.status).toBe(200);
    expect(forced.body.status).toBe('ordered');
    const ev = (await detail(order.id)).events.find((e) => e.type === 'order.supplier_ordered');
    expect(ev?.payload).toMatchObject({ confirmBelowFloor: true });
  });

  it('accepts a supplier order exactly at the maximum cost', async () => {
    const { listing } = await manualListing({ title: 'At the limit organizer' });
    const order = await simulate(listing.id);
    const max = (await detail(order.id)).maxSupplierCostCents as number;
    const ok = await t.api<Ord>('POST', `/orders/${order.id}/supplier-order`, { supplierOrderId: 'ALI-EDGE', costCents: max - 200, shippingCents: 200 });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('ordered');
  });

  it('is idempotent on supplierOrderId and answers 409 SUPPLIER_ORDER_EXISTS for a different one', async () => {
    const { listing } = await manualListing({ title: 'Idempotent organizer' });
    const order = await simulate(listing.id);
    const body = { supplierOrderId: 'ALI-42', costCents: 1000, shippingCents: 200 };
    const first = await t.api<Ord>('POST', `/orders/${order.id}/supplier-order`, body);
    const again = await t.api<Ord>('POST', `/orders/${order.id}/supplier-order`, body);
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    const other = await t.api<ApiError>('POST', `/orders/${order.id}/supplier-order`, { ...body, supplierOrderId: 'ALI-43' });
    expect(other.status).toBe(409);
    expect(err(other).code).toBe('SUPPLIER_ORDER_EXISTS');
    const d = await detail(order.id);
    expect(d.supplierOrderId).toBe('ALI-42');
    expect(d.ledger).toHaveLength(4);
    expect(d.messages.filter((m) => m.kind === 'order_confirmed')).toHaveLength(1);
  });

  it('two racing submissions book the order once', async () => {
    const { listing } = await manualListing({ title: 'Racing organizer' });
    const order = await simulate(listing.id);
    const body = { supplierOrderId: 'ALI-RACE', costCents: 1000, shippingCents: 200 };
    const [a, b] = await Promise.all([t.api<Ord>('POST', `/orders/${order.id}/supplier-order`, body), t.api<Ord>('POST', `/orders/${order.id}/supplier-order`, body)]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    expect((await detail(order.id)).ledger).toHaveLength(4);
  });

  it('uses the right error codes outside awaiting_supplier', async () => {
    const { listing } = await manualListing({ title: 'Wrong state organizer' });
    const order = await simulate(listing.id);
    const body = { supplierOrderId: 'ALI-9', costCents: 1000, shippingCents: 200 };

    // Tracking / delivered before the order is placed.
    expect(err(await t.api<ApiError>('POST', `/orders/${order.id}/tracking`, { trackingNumber: 'T1', carrier: 'C' })).code).toBe('TRACKING_NOT_MANUAL');
    expect(err(await t.api<ApiError>('POST', `/orders/${order.id}/delivered`)).code).toBe('ORDER_NOT_SHIPPED');

    await t.api('POST', `/orders/${order.id}/supplier-order`, body);
    // Shipped orders no longer accept quotes, supplier orders or tracking.
    await t.api('POST', `/orders/${order.id}/tracking`, { trackingNumber: 'T1', carrier: 'C' });
    const quoteLate = await t.api<ApiError>('POST', `/orders/${order.id}/supplier-quote`, { costCents: 1, shippingCents: 0 });
    expect(quoteLate.status).toBe(422);
    expect(err(quoteLate).code).toBe('ORDER_NOT_AWAITING_SUPPLIER');
    // Replaying the recorded supplier order is still a 200 once shipped; a different id is a 409.
    expect((await t.api<Ord>('POST', `/orders/${order.id}/supplier-order`, body)).status).toBe(200);
    expect(err(await t.api<ApiError>('POST', `/orders/${order.id}/supplier-order`, { ...body, supplierOrderId: 'OTHER' })).code).toBe('SUPPLIER_ORDER_EXISTS');
    expect(err(await t.api<ApiError>('POST', `/orders/${order.id}/tracking`, { trackingNumber: 'T2', carrier: 'C' })).code).toBe('TRACKING_NOT_MANUAL');
    expect((await t.api('POST', '/orders/ord_missing/supplier-quote', { costCents: 1, shippingCents: 0 })).status).toBe(404);
    expect((await t.api('POST', '/orders/ord_missing/supplier-order', body)).status).toBe(404);
    expect((await t.api('POST', '/orders/ord_missing/tracking', { trackingNumber: 'x', carrier: 'y' })).status).toBe(404);
    expect((await t.api('POST', '/orders/ord_missing/delivered')).status).toBe(404);
  });

  it('keeps tracking and delivered for manual orders only', async () => {
    const auto = await publishOne(t, 'garden bed');
    const order = await simulate(auto.id);
    expect(order.status).toBe('ordered');
    expect(err(await t.api<ApiError>('POST', `/orders/${order.id}/tracking`, { trackingNumber: 'T1', carrier: 'C' })).code).toBe('TRACKING_NOT_MANUAL');
    expect(err(await t.api<ApiError>('POST', `/orders/${order.id}/delivered`)).code).toBe('DELIVERY_NOT_MANUAL');
    const d = await detail(order.id);
    expect(d.supplier).toBeUndefined();
    expect(d.maxSupplierCostCents).toBeUndefined();
  });

  it('validates the order endpoints', async () => {
    const { listing } = await manualListing({ title: 'Validation organizer' });
    const order = await simulate(listing.id);
    const cases: [string, unknown][] = [
      ['supplier-quote', {}],
      ['supplier-quote', { costCents: -1, shippingCents: 0 }],
      ['supplier-quote', { costCents: 1.5, shippingCents: 0 }],
      ['supplier-order', { supplierOrderId: '', costCents: 100, shippingCents: 0 }],
      ['supplier-order', { supplierOrderId: 'x'.repeat(101), costCents: 100, shippingCents: 0 }],
      ['supplier-order', { supplierOrderId: 'ok', costCents: 0, shippingCents: 0 }],
      ['supplier-order', { supplierOrderId: 'ok', costCents: 100, shippingCents: -5 }],
      ['supplier-order', { supplierOrderId: 'ok', costCents: 100, shippingCents: 0, confirmBelowFloor: 'yes' }],
      ['tracking', { trackingNumber: '', carrier: 'C' }],
      ['tracking', { trackingNumber: 'x'.repeat(61), carrier: 'C' }],
      ['tracking', { trackingNumber: 'T', carrier: '' }],
      ['tracking', { trackingNumber: 'T', carrier: 'c'.repeat(41) }],
    ];
    for (const [path, body] of cases) {
      const res = await t.api<ApiError>('POST', `/orders/${order.id}/${path}`, body);
      expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(400);
      expect(err(res).code).toBe('VALIDATION');
    }
    expect((await detail(order.id)).status).toBe('awaiting_supplier');
  });

  it('cancels an order from awaiting_supplier without ledger entries', async () => {
    const { listing } = await manualListing({ title: 'Cancelled organizer' });
    const order = await simulate(listing.id);
    const fulfil = await t.api<ApiError>('POST', `/orders/${order.id}/decision`, { action: 'fulfil' });
    expect(fulfil.status).toBe(422);
    expect(err(fulfil).code).toBe('ORDER_NOT_HELD');
    const res = await t.api<Ord>('POST', `/orders/${order.id}/decision`, { action: 'cancel' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
    const d = await detail(order.id);
    expect(d.ledger).toEqual([]);
    expect(d.events.find((e) => e.type === 'order.cancelled')?.payload).toMatchObject({ reason: 'manual' });
    expect(err(await t.api<ApiError>('POST', `/orders/${order.id}/supplier-order`, { supplierOrderId: 'late', costCents: 1000, shippingCents: 200 })).code).toBe('ORDER_NOT_AWAITING_SUPPLIER');
    // A shipped / ordered order cannot be cancelled with a decision.
    const ordered = await simulate((await manualListing({ title: 'Ordered then cancel organizer' })).listing.id);
    await t.api('POST', `/orders/${ordered.id}/supplier-order`, { supplierOrderId: 'A1', costCents: 1000, shippingCents: 200 });
    expect(err(await t.api<ApiError>('POST', `/orders/${ordered.id}/decision`, { action: 'cancel' })).code).toBe('ORDER_NOT_HELD');
  });

  it('a held manual order that is approved moves to awaiting_supplier', async () => {
    const { listing } = await manualListing({ title: 'Held then approved organizer' });
    const order = await simulate(listing.id, { priceDriftPct: 90 });
    expect(order.status).toBe('held');
    const approved = await t.api<Ord>('POST', `/orders/${order.id}/decision`, { action: 'fulfil' });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('awaiting_supplier');
    const d = await detail(order.id);
    expect(d.ledger).toEqual([]);
    expect(d.events.map((e) => e.type)).toEqual(expect.arrayContaining(['order.decision', 'order.awaiting_supplier']));
    // The seller still has the margin check at order time: the drifted cost needs the override.
    const refused = await t.api<ApiError>('POST', `/orders/${order.id}/supplier-order`, { supplierOrderId: 'H1', costCents: 1900, shippingCents: 200 });
    expect(err(refused).code).toBe('BELOW_FLOOR');
  });

  it('a held manual order whose product is out of stock is cancelled on approval', async () => {
    const { product, listing } = await manualListing({ title: 'Held out of stock organizer' });
    const order = await simulate(listing.id, { priceDriftPct: 90 });
    expect(order.status).toBe('held');
    await t.db.product.update({ where: { id: product.id }, data: { stock: 0 } });
    const res = await t.api<Ord>('POST', `/orders/${order.id}/decision`, { action: 'fulfil' });
    expect(res.body.status).toBe('cancelled');
  });

  it('duplicate webhooks stay no-ops and never create a second awaiting order', async () => {
    const { listing } = await manualListing({ title: 'Webhook organizer' });
    const hook = {
      ebayOrderId: 'EBAY-MANUAL-1',
      listingId: listing.id,
      buyerName: 'Katherine Johnson',
      shipTo: { line1: '1 Orbit Way', city: 'Hampton', state: 'VA', postalCode: '23666', country: 'US' },
      salePriceCents: listing.priceCents,
    };
    const first = await t.api<{ duplicate: boolean; order: Ord }>('POST', '/webhooks/ebay', hook);
    expect(first.status).toBe(201);
    expect(first.body.order.status).toBe('awaiting_supplier');
    await t.api('POST', `/orders/${first.body.order.id}/supplier-order`, { supplierOrderId: 'W1', costCents: 1000, shippingCents: 200 });
    const replay = await t.api<{ duplicate: boolean; order: Ord }>('POST', '/webhooks/ebay', hook);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(replay.body.order.status).toBe('ordered');
    expect(await t.db.order.count({ where: { ebayOrderId: 'EBAY-MANUAL-1' } })).toBe(1);
    expect((await detail(first.body.order.id)).ledger).toHaveLength(4);
  });

  it('never calls the supplier connector to place a manual order', async () => {
    const { listing } = await manualListing({ title: 'No connector call organizer' });
    const spy = t.connectors.manualSupplier;
    const original = spy.placeOrder.bind(spy);
    let calls = 0;
    spy.placeOrder = (input) => {
      calls += 1;
      return original(input);
    };
    const order = await simulate(listing.id);
    await t.app.jobs.tick();
    expect(order.status).toBe('awaiting_supplier');
    expect(calls).toBe(0);
    spy.placeOrder = original;
  });
});

describe('scheduler and dashboard', () => {
  it('never auto-cancels or auto-delivers manual orders, and the dashboard flags them', async () => {
    const { listing } = await manualListing({ title: 'Patient organizer' });
    const waiting = await simulate(listing.id);
    const shippedOne = await simulate(listing.id);
    await t.api('POST', `/orders/${shippedOne.id}/supplier-order`, { supplierOrderId: 'S1', costCents: 1000, shippingCents: 200 });
    await t.api('POST', `/orders/${shippedOne.id}/tracking`, { trackingNumber: 'T1', carrier: 'C' });

    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const jobs = t.app.jobs;
    await jobs.tick(future);
    await jobs.cancelExpiredHolds(future);
    expect((await detail(waiting.id)).status).toBe('awaiting_supplier');
    expect((await detail(shippedOne.id)).status).toBe('shipped');

    const dash = await t.api<{ awaitingSupplier: { count: number; oldestAt?: string }; today: { supplierSpendCents: number } }>('GET', '/dashboard');
    expect(dash.body.awaitingSupplier.count).toBeGreaterThanOrEqual(1);
    const row = await t.db.order.findUniqueOrThrow({ where: { id: waiting.id } });
    const oldest = await t.db.order.findFirstOrThrow({ where: { status: 'awaiting_supplier' }, orderBy: { createdAt: 'asc' } });
    expect(dash.body.awaitingSupplier.oldestAt).toBe(oldest.createdAt.toISOString());
    expect(row.status).toBe('awaiting_supplier');
  });

  it('dashboard reports an empty awaitingSupplier when nothing waits', async () => {
    const solo = await createTestApp();
    const dash = await solo.api<{ awaitingSupplier: { count: number; oldestAt?: string } }>('GET', '/dashboard');
    expect(dash.body.awaitingSupplier).toEqual({ count: 0 });
    await solo.close();
  });
});

describe('daily spend cap', () => {
  it('counts awaiting_supplier reservations, queues the overflow and drains it when room appears', async () => {
    const capped = await createTestApp({ dailySpendCapCents: 2300 });
    await capped.api('POST', '/suppliers', { supplier: 'manual' });
    const p = (await capped.api<Prod>('POST', '/manual-products', goodProduct)).body;
    const created = await capped.api<{ created: Lst[] }>('POST', '/listings', { productIds: [p.id] });
    const draft = created.body.created[0] as Lst;
    await capped.api('POST', '/listings/publish', { ids: [draft.id] });

    const first = (await capped.api<Ord>('POST', '/orders/simulate', { listingId: draft.id })).body;
    const second = (await capped.api<Ord>('POST', '/orders/simulate', { listingId: draft.id })).body;
    expect(first.status).toBe('awaiting_supplier');
    expect(second.status).toBe('queued');

    const dash = await capped.api<{ today: { supplierSpendCents: number; spendCapCents: number }; awaitingSupplier: { count: number } }>('GET', '/dashboard');
    expect(dash.body.today.supplierSpendCents).toBe(1200);
    expect(dash.body.awaitingSupplier.count).toBe(1);

    // Still no room: the drain leaves it queued.
    await capped.app.jobs.drainQueue();
    expect((await capped.api<OrdDetail>('GET', `/orders/${second.id}`)).body.status).toBe('queued');

    // Raising the cap lets the queue drain into awaiting_supplier (not ordered).
    await capped.api('PATCH', '/account', { dailySpendCapCents: 5000 });
    await capped.app.jobs.drainQueue();
    const drained = (await capped.api<OrdDetail>('GET', `/orders/${second.id}`)).body;
    expect(drained.status).toBe('awaiting_supplier');
    expect(drained.ledger).toEqual([]);
    expect(drained.events.map((e) => e.type)).toEqual(expect.arrayContaining(['order.queued', 'order.awaiting_supplier']));

    // Recording the supplier order swaps the reservation for the real ledger spend, without double counting.
    await capped.api('POST', `/orders/${first.id}/supplier-order`, { supplierOrderId: 'C1', costCents: 1000, shippingCents: 200 });
    const after = await capped.api<{ today: { supplierSpendCents: number } }>('GET', '/dashboard');
    expect(after.body.today.supplierSpendCents).toBe(2400);

    // A cancelled awaiting order releases its reservation.
    await capped.api('POST', `/orders/${second.id}/decision`, { action: 'cancel' });
    const released = await capped.api<{ today: { supplierSpendCents: number } }>('GET', '/dashboard');
    expect(released.body.today.supplierSpendCents).toBe(1200);
    await capped.close();
  });
});

describe('authentication', () => {
  it('requires a session on every new route', async () => {
    const routes: [string, string, unknown?][] = [
      ['GET', '/manual-products'],
      ['POST', '/manual-products', goodProduct],
      ['PATCH', '/manual-products/prd_x', { stock: 1 }],
      ['DELETE', '/manual-products/prd_x'],
      ['POST', '/orders/ord_x/supplier-quote', { costCents: 1, shippingCents: 0 }],
      ['POST', '/orders/ord_x/supplier-order', { supplierOrderId: 'a', costCents: 1, shippingCents: 0 }],
      ['POST', '/orders/ord_x/tracking', { trackingNumber: 'a', carrier: 'b' }],
      ['POST', '/orders/ord_x/delivered'],
    ];
    for (const [method, url, body] of routes) {
      const res = await t.anon<ApiError>(method as 'GET', url, body);
      expect(res.status, `${method} ${url}`).toBe(401);
      expect(err(res).code).toBe('UNAUTHENTICATED');
    }
  });
});

describe('review fixes', () => {
  const hook = (listingId: string, n: string, price: number) => ({
    ebayOrderId: `EBAY-REV-${n}`,
    listingId,
    buyerName: 'Buyer ' + n,
    shipTo: { line1: '1 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
    salePriceCents: price,
  });

  it('cannot oversell: the last unit goes to one order, the other is cancelled out_of_stock', async () => {
    const { product, listing } = await manualListing({ title: 'Last unit organizer', stock: 1 });
    const [a, b] = await Promise.all([
      t.api<{ order: Ord }>('POST', '/webhooks/ebay', hook(listing.id, 'A', listing.priceCents)),
      t.api<{ order: Ord }>('POST', '/webhooks/ebay', hook(listing.id, 'B', listing.priceCents)),
    ]);
    expect([a.body.order.status, b.body.order.status].sort()).toEqual(['awaiting_supplier', 'cancelled']);
    const row = await t.db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.stock).toBe(0);
    const lost = [a.body.order, b.body.order].find((o) => o.status === 'cancelled') as Ord;
    const d = await detail(lost.id);
    expect(d.ledger).toEqual([]);
    expect(d.events.find((e) => e.type === 'order.cancelled')?.payload).toMatchObject({ reason: 'out_of_stock' });
    expect(await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } })).toMatchObject({ status: 'paused', pauseReason: 'out_of_stock' });
    // The cancelled loser did not hand back a unit it never held.
    expect((await t.db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(0);
  });

  it('returns the unit when the seller cancels an awaiting order, but not once it is ordered', async () => {
    const { product, listing } = await manualListing({ title: 'Restock organizer', stock: 2 });
    const one = await simulate(listing.id);
    const two = await simulate(listing.id);
    expect((await t.db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(0);
    expect((await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe('paused');
    await t.api('POST', `/orders/${one.id}/decision`, { action: 'cancel' });
    expect((await t.db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(1);
    expect((await t.db.listing.findUniqueOrThrow({ where: { id: listing.id } })).status).toBe('active');
    await t.api('POST', `/orders/${two.id}/supplier-order`, { supplierOrderId: 'R2', costCents: 1000, shippingCents: 200 });
    expect((await t.db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(1);
  });

  it('a seller PATCH of stock is not clobbered by the pipeline', async () => {
    const { product, listing } = await manualListing({ title: 'Patch survives organizer', stock: 5 });
    await t.api('PATCH', `/manual-products/${product.id}`, { stock: 9 });
    await simulate(listing.id);
    expect((await t.db.product.findUniqueOrThrow({ where: { id: product.id } })).stock).toBe(8);
  });

  it('cancel racing the supplier order never leaves a half-state', async () => {
    const { product, listing } = await manualListing({ title: 'Race cancel organizer', stock: 3 });
    const order = await simulate(listing.id);
    const [rec, cancel] = await Promise.all([
      t.api('POST', `/orders/${order.id}/supplier-order`, { supplierOrderId: 'RC1', costCents: 1000, shippingCents: 200 }),
      t.api('POST', `/orders/${order.id}/decision`, { action: 'cancel' }),
    ]);
    const d = await detail(order.id);
    const stock = (await t.db.product.findUniqueOrThrow({ where: { id: product.id } })).stock;
    if (d.status === 'ordered') {
      expect(rec.status).toBe(200);
      expect(cancel.status).toBeGreaterThanOrEqual(409);
      expect(d.ledger).toHaveLength(4);
      expect(stock).toBe(2);
    } else {
      expect(d.status).toBe('cancelled');
      expect(rec.status).toBe(422);
      expect(d.ledger).toEqual([]);
      expect(stock).toBe(3);
    }
  });

  it('a double-clicked tracking submit pushes to eBay once, and a failed push can be retried', async () => {
    const { listing } = await manualListing({ title: 'Double click organizer' });
    const order = await simulate(listing.id);
    await t.api('POST', `/orders/${order.id}/supplier-order`, { supplierOrderId: 'DC1', costCents: 1000, shippingCents: 200 });
    const ebay = t.connectors.mockEbay;
    if (!ebay) throw new Error('mock ebay');
    const original = ebay.createShippingFulfillment.bind(ebay);
    let fail = true;
    ebay.createShippingFulfillment = async (input) => {
      if (fail) {
        fail = false;
        throw new Error('ebay down');
      }
      return original(input);
    };
    const failed = await t.api('POST', `/orders/${order.id}/tracking`, { trackingNumber: 'DC-T', carrier: 'C' });
    expect(failed.status).toBe(500);
    expect((await detail(order.id)).status).toBe('ordered');
    const [x, y] = await Promise.all([
      t.api<Ord>('POST', `/orders/${order.id}/tracking`, { trackingNumber: 'DC-T', carrier: 'C' }),
      t.api<Ord>('POST', `/orders/${order.id}/tracking`, { trackingNumber: 'DC-T', carrier: 'C' }),
    ]);
    expect([x.status, y.status].some((s) => s === 200)).toBe(true);
    expect(ebay.fulfillments.filter((f) => f.ebayOrderId === order.ebayOrderId)).toHaveLength(1);
    expect((await detail(order.id)).status).toBe('shipped');
    ebay.createShippingFulfillment = original;
  });

  it('a replayed supplier order resends a lost order_confirmed message once', async () => {
    const { listing } = await manualListing({ title: 'Lost confirmation organizer' });
    const order = await simulate(listing.id);
    const body = { supplierOrderId: 'LC1', costCents: 1000, shippingCents: 200 };
    await t.api('POST', `/orders/${order.id}/supplier-order`, body);
    await t.db.message.deleteMany({ where: { orderId: order.id } });
    expect((await t.api('POST', `/orders/${order.id}/supplier-order`, body)).status).toBe(200);
    expect((await t.api('POST', `/orders/${order.id}/supplier-order`, body)).status).toBe(200);
    expect((await detail(order.id)).messages.filter((m) => m.kind === 'order_confirmed')).toHaveLength(1);
  });

  it('rejects oversized numbers with 400 VALIDATION instead of failing', async () => {
    const huge = 1e15;
    for (const over of [{ costCents: huge }, { shippingCents: huge }, { costCents: 100_000_001 }, { stock: 1_000_001 }, { stock: huge }]) {
      const res = await t.api<ApiError>('POST', '/manual-products', { ...goodProduct, ...over });
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect(err(res).code).toBe('VALIDATION');
    }
    const p = await addProduct({ costCents: 100_000_000, stock: 1_000_000 });
    expect((await t.api('PATCH', `/manual-products/${p.id}`, { stock: huge })).status).toBe(400);
    const { listing } = await manualListing({ title: 'Bounds organizer' });
    const order = await simulate(listing.id);
    for (const [path, body] of [
      ['supplier-quote', { costCents: huge, shippingCents: 0 }],
      ['supplier-quote', { costCents: 1, shippingCents: huge }],
      ['supplier-order', { supplierOrderId: 'B', costCents: huge, shippingCents: 0 }],
      ['supplier-order', { supplierOrderId: 'B', costCents: 100, shippingCents: huge }],
    ] as const) {
      const res = await t.api<ApiError>('POST', `/orders/${order.id}/${path}`, body);
      expect(res.status).toBe(400);
      expect(err(res).code).toBe('VALIDATION');
    }
  });
});
