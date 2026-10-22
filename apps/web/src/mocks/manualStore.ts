// Mock behaviour for the manual supplier (CONTRACT.md → Manual supplier v1.3): same fields, status transitions and error codes as the API.
import type { ManualProductInput, Order, Product, SupplierQuote } from '@/api/types';
import { accountFees, computeMargin, priceForTarget } from '@/lib/money';
import { addLedger, nextId, productById, pushEvent, state, marginForListing, compliance } from './store';

export class ApiErr extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

const now = () => new Date().toISOString();
const isHttps = (v: unknown): v is string => {
  try { return typeof v === 'string' && new URL(v).protocol === 'https:'; } catch { return false; }
};
const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
const isStr = (v: unknown, min: number, max: number): v is string => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;

function validation(issues: { path: string[]; message: string }[]): never {
  throw new ApiErr(400, 'VALIDATION', 'Invalid request', issues);
}

function checkProduct(b: Record<string, unknown>, partial: boolean) {
  const issues: { path: string[]; message: string }[] = [];
  const bad = (path: string, message: string) => issues.push({ path: [path], message });
  const has = (k: string) => !partial || k in b;
  if (has('title') && !isStr(b.title, 3, 80)) bad('title', 'Title must be 3 to 80 characters');
  if (has('description') && !isStr(b.description, 1, 10_000)) bad('description', 'Description is required');
  if (has('images') && !(Array.isArray(b.images) && b.images.length >= 1 && b.images.length <= 12 && b.images.every(isHttps))) bad('images', '1 to 12 https URLs');
  if (has('costCents') && !isInt(b.costCents, 1)) bad('costCents', 'Cost must be more than 0');
  if (has('shippingCents') && !isInt(b.shippingCents, 0)) bad('shippingCents', 'Shipping must be 0 or more');
  if (has('stock') && !isInt(b.stock, 0)) bad('stock', 'Stock must be a whole number, 0 or more');
  if (has('handlingDays') && !isInt(b.handlingDays, 1, 60)) bad('handlingDays', 'Lead time must be 1 to 60 days');
  if ('warehouseCountry' in b && !(typeof b.warehouseCountry === 'string' && /^[A-Za-z]{2}$/.test(b.warehouseCountry))) bad('warehouseCountry', '2-letter country code');
  if ('supplierUrl' in b && b.supplierUrl !== null && !isHttps(b.supplierUrl)) bad('supplierUrl', 'Must be an https URL');
  for (const k of ['brand', 'categoryHint']) if (k in b && b[k] !== null && typeof b[k] !== 'string') bad(k, 'Must be text');
  if (issues.length) validation(issues);
}

// Products
export const listManual = () => [...state.manualProducts].reverse();

export function createManual(b: Record<string, unknown>): Product {
  checkProduct(b, false);
  if (!state.account.supplierConnections.some((s) => s.supplier === 'manual' && s.status === 'connected'))
    throw new ApiErr(422, 'SUPPLIER_NOT_CONNECTED', 'Connect the manual supplier first');
  const i = b as unknown as ManualProductInput;
  const p: Product = {
    id: nextId('prod_man'), supplier: 'manual', supplierSku: `man_${Math.random().toString(36).slice(2, 8)}`, title: i.title.trim(), description: i.description.trim(),
    images: i.images, costCents: i.costCents, shippingCents: i.shippingCents, stock: i.stock, warehouseCountry: (i.warehouseCountry ?? 'CN').toUpperCase(),
    handlingDays: i.handlingDays, updatedAt: now(),
  };
  if (i.supplierUrl) p.supplierUrl = i.supplierUrl;
  if (i.brand) p.brand = i.brand;
  if (i.categoryHint) p.categoryHint = i.categoryHint;
  state.manualProducts.push(p);
  return p;
}

export function patchManual(id: string, b: Record<string, unknown>): Product {
  const p = state.manualProducts.find((x) => x.id === id);
  if (!p) throw new ApiErr(404, 'NOT_FOUND', 'Product not found');
  checkProduct(b, true);
  const before = { cost: p.costCents, ship: p.shippingCents };
  for (const [k, v] of Object.entries(b)) {
    if (k === 'warehouseCountry') p.warehouseCountry = String(v).toUpperCase();
    else if (v === null) delete (p as unknown as Record<string, unknown>)[k];
    else if (k !== 'id' && k !== 'supplierSku') (p as unknown as Record<string, unknown>)[k] = typeof v === 'string' ? v.trim() : v;
  }
  p.updatedAt = now();
  sweepProduct(p, before.cost !== p.costCents || before.ship !== p.shippingCents);
  return p;
}

/** The listing sweep scoped to one product: reprice or pause on a cost move, pause on stock 0, block if the lead time no longer fits. */
function sweepProduct(p: Product, costMoved: boolean) {
  const { pricingRule, handlingTimeDays } = state.account;
  const fees = accountFees(state.account);
  for (const l of state.listings.filter((x) => x.productId === p.id && (x.status === 'active' || x.status === 'paused'))) {
    const gate = compliance(p, handlingTimeDays);
    if (!gate.ok) { l.status = 'blocked'; l.pauseReason = gate.code; pushEvent('listing.blocked', { code: gate.code }, { listingId: l.id }); continue; }
    if (p.stock === 0) {
      if (l.status === 'active') { l.status = 'paused'; l.pauseReason = 'out_of_stock'; pushEvent('listing.paused', { reason: 'out_of_stock' }, { listingId: l.id }); }
    } else if (costMoved) {
      const target = priceForTarget(p.costCents, p.shippingCents, fees, pricingRule);
      // Within 25% of the current price the listing follows the cost; a bigger jump pauses it for the seller to look at.
      if (Math.abs(target - l.priceCents) * 4 <= l.priceCents) {
        l.priceCents = target;
        if (l.status === 'paused' && (l.pauseReason === 'below_floor' || l.pauseReason === 'out_of_stock')) { l.status = 'active'; l.pauseReason = undefined; }
        pushEvent('listing.repriced', { priceCents: target }, { listingId: l.id });
      } else if (l.status === 'active') { l.status = 'paused'; l.pauseReason = 'below_floor'; pushEvent('listing.paused', { reason: 'below_floor' }, { listingId: l.id }); }
    } else if (l.status === 'paused' && l.pauseReason === 'out_of_stock') {
      l.status = 'active'; l.pauseReason = undefined; pushEvent('listing.resumed', {}, { listingId: l.id });
    }
    l.projectedMarginPct = marginForListing(l);
  }
}

export function deleteManual(id: string) {
  const p = state.manualProducts.find((x) => x.id === id);
  if (!p) throw new ApiErr(404, 'NOT_FOUND', 'Product not found');
  const mine = state.listings.filter((l) => l.productId === id);
  const ordered = state.orders.some((o) => mine.some((l) => l.id === o.listingId));
  if (ordered || mine.some((l) => l.status !== 'draft')) throw new ApiErr(422, 'PRODUCT_IN_USE', 'A listing or an order still uses this product');
  state.listings = state.listings.filter((l) => l.productId !== id);
  state.manualProducts = state.manualProducts.filter((x) => x.id !== id);
}

// Orders
const orderOrThrow = (id: string): Order => {
  const o = state.orders.find((x) => x.id === id);
  if (!o) throw new ApiErr(404, 'NOT_FOUND', 'Order not found');
  return o;
};
const productOf = (o: Order) => productById(state.listings.find((l) => l.id === o.listingId)?.productId ?? '');
export const isManualOrder = (o: Order) => productOf(o)?.supplier === 'manual';

/** Largest combined supplier cost + shipping that still meets the floor. Margin only falls as cost rises, so binary search is exact. */
function maxSupplierCost(o: Order): number {
  const { pricingRule } = state.account;
  const fees = accountFees(state.account);
  const ok = (c: number) => computeMargin({ salePriceCents: o.salePriceCents, buyerShippingCents: o.buyerShippingCents, supplierCostCents: c, supplierShippingCents: 0, toolFeeCents: 0, fees }).netMarginPct >= pricingRule.floorPct;
  if (!ok(0)) return 0;
  let lo = 0, hi = o.salePriceCents + o.buyerShippingCents;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (ok(mid)) lo = mid; else hi = mid - 1; }
  return lo;
}

/** Extra fields on GET /orders/:id for manual orders. */
export function orderExtras(o: Order) {
  const p = productOf(o);
  if (p?.supplier !== 'manual') return {};
  return { supplier: { kind: 'manual' as const, url: p.supplierUrl, title: p.title, supplierSku: p.supplierSku }, maxSupplierCostCents: maxSupplierCost(o) };
}

function amounts(b: Record<string, unknown>, minCost: number) {
  const issues: { path: string[]; message: string }[] = [];
  if (!isInt(b.costCents, minCost)) issues.push({ path: ['costCents'], message: minCost > 0 ? 'Cost must be more than 0' : 'Cost must be 0 or more' });
  if (!isInt(b.shippingCents, 0)) issues.push({ path: ['shippingCents'], message: 'Shipping must be 0 or more' });
  return { issues, costCents: b.costCents as number, shippingCents: b.shippingCents as number };
}

const marginFor = (o: Order, costCents: number, shippingCents: number) =>
  computeMargin({ salePriceCents: o.salePriceCents, buyerShippingCents: o.buyerShippingCents, supplierCostCents: costCents, supplierShippingCents: shippingCents, toolFeeCents: 0, fees: accountFees(state.account) });

export function quote(id: string, b: Record<string, unknown>): SupplierQuote {
  const o = orderOrThrow(id);
  const a = amounts(b, 0);
  if (a.issues.length) validation(a.issues);
  if (o.status !== 'awaiting_supplier') throw new ApiErr(422, 'ORDER_NOT_AWAITING_SUPPLIER', 'This order is not waiting for a supplier order');
  const m = marginFor(o, a.costCents, a.shippingCents);
  return { netProfitCents: m.netProfitCents, netMarginPct: m.netMarginPct, ebayFeesCents: m.ebayFeesCents, maxSupplierCostCents: maxSupplierCost(o), meetsFloor: m.netMarginPct >= state.account.pricingRule.floorPct };
}

export function recordSupplierOrder(id: string, b: Record<string, unknown>): Order {
  const o = orderOrThrow(id);
  const a = amounts(b, 1);
  if (!isStr(b.supplierOrderId, 1, 100)) a.issues.push({ path: ['supplierOrderId'], message: 'Supplier order id must be 1 to 100 characters' });
  if (a.issues.length) validation(a.issues);
  const ref = (b.supplierOrderId as string).trim();
  if (o.status === 'ordered' && o.supplierOrderId) {
    if (o.supplierOrderId === ref) return o;
    throw new ApiErr(409, 'SUPPLIER_ORDER_EXISTS', 'This eBay order already has a supplier order');
  }
  if (o.status !== 'awaiting_supplier') throw new ApiErr(422, 'ORDER_NOT_AWAITING_SUPPLIER', 'This order is not waiting for a supplier order');
  const m = marginFor(o, a.costCents, a.shippingCents);
  if (m.netMarginPct < state.account.pricingRule.floorPct && b.confirmBelowFloor !== true)
    throw new ApiErr(422, 'BELOW_FLOOR', 'These amounts put the order below your margin floor', { maxSupplierCostCents: maxSupplierCost(o), netMarginPct: m.netMarginPct, netProfitCents: m.netProfitCents });
  Object.assign(o, { status: 'ordered', supplierOrderId: ref, supplierCostCents: a.costCents, supplierShippingCents: a.shippingCents, ebayFeesCents: m.ebayFeesCents, netProfitCents: m.netProfitCents, updatedAt: now() });
  addLedger(o.id, 'sale', o.salePriceCents + o.buyerShippingCents);
  addLedger(o.id, 'ebay_fee', -m.ebayFeesCents);
  addLedger(o.id, 'supplier_cost', -a.costCents);
  if (a.shippingCents > 0) addLedger(o.id, 'supplier_shipping', -a.shippingCents);
  pushEvent('order.supplier_ordered', { confirmBelowFloor: b.confirmBelowFloor === true }, { orderId: o.id });
  state.messages.unshift({ id: nextId('msg'), accountId: 'acc_demo', orderId: o.id, direction: 'out', kind: 'order_confirmed', answered: true, body: `Thanks for your order, ${o.buyerName.split(' ')[0]}. It is being prepared and will ship within ${state.account.handlingTimeDays} business days.`, at: now() });
  return o;
}

const payoutDate = () => new Date(Date.now() + (state.account.newSeller ? 30 : 3) * 86400_000).toISOString();

export function addTracking(id: string, b: Record<string, unknown>): Order {
  const o = orderOrThrow(id);
  const issues: { path: string[]; message: string }[] = [];
  if (!isStr(b.trackingNumber, 1, 60)) issues.push({ path: ['trackingNumber'], message: 'Tracking number must be 1 to 60 characters' });
  if (!isStr(b.carrier, 1, 40)) issues.push({ path: ['carrier'], message: 'Carrier must be 1 to 40 characters' });
  if (issues.length) validation(issues);
  if (o.status !== 'ordered' || !isManualOrder(o)) throw new ApiErr(422, 'TRACKING_NOT_MANUAL', 'Tracking can only be added by hand to a placed manual order');
  Object.assign(o, { status: 'shipped', trackingNumber: (b.trackingNumber as string).trim(), carrier: (b.carrier as string).trim(), payoutExpectedAt: payoutDate(), updatedAt: now() });
  pushEvent('order.shipped', { carrier: o.carrier, trackingNumber: o.trackingNumber }, { orderId: o.id });
  state.messages.unshift({ id: nextId('msg'), accountId: 'acc_demo', orderId: o.id, direction: 'out', kind: 'shipped', answered: true, body: `Your order has shipped with ${o.carrier}. Tracking: ${o.trackingNumber}.`, at: now() });
  return o;
}

export function markDelivered(id: string): Order {
  const o = orderOrThrow(id);
  if (!isManualOrder(o)) throw new ApiErr(422, 'DELIVERY_NOT_MANUAL', 'Only manual-supplier orders are marked delivered by hand');
  if (o.status === 'delivered') return o;
  if (o.status !== 'shipped') throw new ApiErr(422, 'ORDER_NOT_SHIPPED', 'Only a shipped order can be marked delivered');
  Object.assign(o, { status: 'delivered', deliveredAt: now(), payoutExpectedAt: payoutDate(), updatedAt: now() });
  pushEvent('order.delivered_manual', {}, { orderId: o.id });
  state.messages.unshift({ id: nextId('msg'), accountId: 'acc_demo', orderId: o.id, direction: 'out', kind: 'delivered', answered: true, body: 'Your order has been delivered. Thanks for shopping with us.', at: now() });
  return o;
}
