import { http, HttpResponse, delay } from 'msw';
import type { AccountPatch, LedgerEntry, SupplierKind } from '@/api/types';
import * as store from './store';
import { nextId, state } from './store';

const B = '/api/v1';
const err = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });
const latency = () => delay(import.meta.env.MODE === 'test' ? 0 : 180);

const toCsv = (rows: LedgerEntry[]) =>
  ['id,at,kind,orderId,amountCents,amountUsd', ...rows.map((e) => [e.id, e.at, e.kind, e.orderId ?? '', e.amountCents, (e.amountCents / 100).toFixed(2)].join(','))].join('\n');

export const handlers = [
  // Account & setup
  http.get(`${B}/account`, async () => { await latency(); return HttpResponse.json(state.account); }),
  http.patch(`${B}/account`, async ({ request }) => {
    await latency();
    const patch = (await request.json()) as AccountPatch;
    const pricingRule = { ...state.account.pricingRule, ...(patch.pricingRule ?? {}) };
    if (pricingRule.floorPct > pricingRule.targetPct) return err(400, 'BAD_REQUEST', 'targetPct must be >= floorPct');
    Object.assign(state.account, patch, { pricingRule, fees: { ...state.account.fees, ...(patch.fees ?? {}) } });
    for (const l of state.listings) { l.projectedMarginPct = store.marginForListing(l); l.floorPriceCents = store.floorPriceFor(l); }
    return HttpResponse.json(state.account);
  }),
  http.post(`${B}/account/ebay/connect`, async () => {
    await delay(600);
    state.account.ebayConnected = true;
    state.account.ebayUsername = 'demo_seller';
    return HttpResponse.json(state.account);
  }),
  http.post(`${B}/suppliers`, async ({ request }) => {
    await latency();
    const { supplier } = (await request.json()) as { supplier: SupplierKind };
    if (supplier !== 'mock') return err(422, 'SUPPLIER_NOT_AVAILABLE', 'Only the mock supplier is available in mock mode');
    return HttpResponse.json(store.addSupplier(supplier), { status: 201 });
  }),
  http.delete(`${B}/suppliers/:id`, async ({ params }) => {
    await latency();
    state.account.supplierConnections = state.account.supplierConnections.filter((s) => s.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),

  // Discovery
  http.get(`${B}/discovery`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const minMargin = parseFloat(url.searchParams.get('minMarginPct') ?? '');
    const page = parseInt(url.searchParams.get('page') ?? '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') ?? '50', 10);
    let items = store.products.map(store.toDiscoveryItem);
    if (q) items = items.filter((i) => i.title.toLowerCase().includes(q) || i.categoryHint?.toLowerCase().includes(q) || i.supplierSku.toLowerCase().includes(q));
    if (!Number.isNaN(minMargin)) items = items.filter((i) => i.projectedMarginPct >= minMargin);
    const total = items.length;
    return HttpResponse.json({ items: items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize });
  }),
  http.get(`${B}/discovery/:id`, async ({ params }) => {
    await latency();
    const p = store.productById(String(params.id));
    return p ? HttpResponse.json(store.toDiscoveryItem(p)) : err(404, 'NOT_FOUND', 'Product not found');
  }),

  // Listings
  http.get(`${B}/listings`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    let items = state.listings.map((l) => ({ ...l, product: store.productById(l.productId)! }));
    if (status) items = items.filter((l) => l.status === status);
    if (q) items = items.filter((l) => l.title.toLowerCase().includes(q));
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 200 });
  }),
  http.post(`${B}/listings`, async ({ request }) => {
    await delay(500);
    const { productIds } = (await request.json()) as { productIds: string[] };
    return HttpResponse.json(store.createListings(productIds), { status: 201 });
  }),
  http.patch(`${B}/listings/:id`, async ({ params, request }) => {
    await latency();
    const l = state.listings.find((x) => x.id === params.id);
    if (!l) return err(404, 'NOT_FOUND', 'Listing not found');
    const patch = (await request.json()) as { title?: string; priceCents?: number; status?: 'active' | 'paused' };
    if (patch.priceCents !== undefined) {
      const floor = store.floorPriceFor(l);
      if (patch.priceCents < floor)
        return HttpResponse.json({ error: { code: 'PRICE_BELOW_FLOOR', message: `Price ${patch.priceCents} is below the floor ${floor}`, details: { floorPriceCents: floor } } }, { status: 422 });
      l.priceCents = patch.priceCents;
    }
    if (patch.title !== undefined) l.title = patch.title;
    if (patch.status === 'paused') { l.status = 'paused'; l.pauseReason = 'manual'; }
    if (patch.status === 'active') store.publish([l.id]);
    l.projectedMarginPct = store.marginForListing(l);
    return HttpResponse.json({ ...l, product: store.productById(l.productId) });
  }),
  http.post(`${B}/listings/publish`, async ({ request }) => {
    await delay(400);
    const { ids } = (await request.json()) as { ids: string[] };
    return HttpResponse.json(store.publish(ids));
  }),
  http.post(`${B}/listings/sync`, async () => { await delay(900); return HttpResponse.json(store.sync()); }),

  // Orders
  http.get(`${B}/orders`, async ({ request }) => {
    await latency();
    const status = new URL(request.url).searchParams.get('status');
    let items = state.orders;
    if (status) items = items.filter((o) => o.status === status);
    const rows = items.map((o) => ({ ...o, listing: { title: state.listings.find((l) => l.id === o.listingId)?.title ?? 'Unknown listing' } }));
    return HttpResponse.json({ items: rows, total: rows.length, page: 1, pageSize: 200 });
  }),
  http.get(`${B}/orders/:id`, async ({ params }) => {
    await latency();
    const o = state.orders.find((x) => x.id === params.id);
    if (!o) return err(404, 'NOT_FOUND', 'Order not found');
    const sortAt = <T extends { at: string }>(xs: T[]) => [...xs].sort((a, b) => a.at.localeCompare(b.at));
    return HttpResponse.json({
      ...o,
      listing: { title: state.listings.find((l) => l.id === o.listingId)?.title ?? 'Unknown listing' },
      events: sortAt(state.events.filter((e) => e.orderId === o.id)),
      messages: sortAt(state.messages.filter((m) => m.orderId === o.id)),
      ledger: sortAt(state.ledger.filter((e) => e.orderId === o.id)),
    });
  }),
  http.post(`${B}/orders/:id/decision`, async ({ params, request }) => {
    await delay(400);
    const { action } = (await request.json()) as { action: 'fulfil' | 'cancel' };
    try { return HttpResponse.json(store.decide(String(params.id), action)); }
    catch (e) { const x = e as { status?: number; code?: string; message: string }; return err(x.status ?? 500, x.code ?? 'ERROR', x.message); }
  }),
  http.post(`${B}/orders/simulate`, async ({ request }) => {
    await delay(700);
    const body = (await request.json()) as { listingId: string; buyerName?: string; priceDriftPct?: number };
    try { return HttpResponse.json(store.simulate(body), { status: 201 }); }
    catch (e) { const x = e as { status?: number; code?: string; message: string }; return err(x.status ?? 500, x.code ?? 'ERROR', x.message); }
  }),

  // Dashboard & ledger
  http.get(`${B}/dashboard`, async () => { await latency(); return HttpResponse.json(store.dashboard()); }),
  http.get(`${B}/ledger`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const entries = state.ledger.filter((e) => (!from || e.at >= from) && (!to || e.at <= `${to}T23:59:59Z`)).sort((a, b) => b.at.localeCompare(a.at));
    const sum = (kinds: LedgerEntry['kind'][]) => entries.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + e.amountCents, 0);
    // Totals are positive magnitudes like the API: profit = revenue - fees - cost.
    const revenueCents = sum(['sale']) + sum(['refund']);
    const feesCents = -sum(['ebay_fee']);
    const costCents = -sum(['supplier_cost', 'supplier_shipping']);
    return HttpResponse.json({ entries, totals: { revenueCents, feesCents, costCents, profitCents: revenueCents - feesCents - costCents, payoutCents: sum(['payout']) } });
  }),
  http.get(`${B}/ledger/export.csv`, () => new HttpResponse(toCsv(state.ledger), { headers: { 'Content-Type': 'text/csv' } })),

  // Messages
  http.get(`${B}/messages`, async ({ request }) => {
    await latency();
    const url = new URL(request.url);
    const orderId = url.searchParams.get('orderId');
    const unanswered = url.searchParams.get('unansweredOnly') === 'true';
    let items = [...state.messages].sort((a, b) => b.at.localeCompare(a.at));
    if (orderId) items = items.filter((m) => m.orderId === orderId);
    if (unanswered) items = items.filter((m) => m.direction === 'in' && !m.answered);
    return HttpResponse.json(items);
  }),
  http.post(`${B}/messages/:id/reply`, async ({ params, request }) => {
    await latency();
    const original = state.messages.find((m) => m.id === params.id);
    if (!original) return err(404, 'NOT_FOUND', 'Message not found');
    const { body } = (await request.json()) as { body: string };
    const reply = { id: nextId('msg'), accountId: 'acc_demo', orderId: original.orderId, direction: 'out' as const, kind: original.kind, body, answered: true, at: new Date().toISOString() };
    original.answered = true;
    state.messages.unshift(reply);
    return HttpResponse.json(reply, { status: 201 });
  }),
];
