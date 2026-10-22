import type {
  Account, ComplianceResult, DashboardResponse, DiscoveryItem, Event, LadderDecision, LedgerEntry, Listing, Message, Order,
  Product, SupplierConnection, SupplierKind,
} from '@/api/types';
import { computeMargin, priceForTarget } from '@/lib/money';
import { demoAccount, freshAccount } from './fixtures/account';
import { blockedBrands, byId as productById, products } from './fixtures/products';
import { listings as seedListings } from './fixtures/listings';
import { events as seedEvents, ledger as seedLedger, messages as seedMessages, orders as seedOrders } from './fixtures/orders';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
let seq = 100;
export const nextId = (prefix: string) => `${prefix}_${(++seq).toString(36)}`;
const now = () => new Date().toISOString();

export interface MockState {
  account: Account;
  listings: Listing[];
  orders: Order[];
  events: Event[];
  messages: Message[];
  ledger: LedgerEntry[];
}

export let state: MockState = makeState();

export function makeState(opts: { fresh?: boolean } = {}): MockState {
  const account = clone(opts.fresh ? freshAccount : demoAccount);
  const listings = clone(seedListings);
  for (const l of listings) {
    const p = productById(l.productId);
    if (p) l.floorPriceCents = priceForTarget(p.costCents, p.shippingCents, account.fees, { ...account.pricingRule, targetPct: account.pricingRule.floorPct });
  }
  return { account, listings, orders: clone(seedOrders), events: clone(seedEvents), messages: clone(seedMessages), ledger: clone(seedLedger) };
}

export function resetState(opts: { fresh?: boolean } = {}) {
  state = makeState(opts);
}

function pushEvent(type: string, payload: Record<string, unknown>, ref: { orderId?: string; listingId?: string } = {}) {
  state.events.unshift({ id: nextId('evt'), accountId: 'acc_demo', type, payload, at: now(), ...ref });
}

// Compliance mirrors the backend gate closely enough for the UI to show every branch.
export function compliance(p: Product, handlingTimeDays: number): ComplianceResult {
  if (p.brand && blockedBrands.includes(p.brand.toLowerCase()))
    return { ok: false, code: 'VERO_MATCH', detail: `Brand "${p.brand}" is on the VeRO blocklist` };
  if (p.images.length === 0) return { ok: false, code: 'NO_IMAGES', detail: 'Supplier provides no product images' };
  if (p.shippingCents >= 900 && p.warehouseCountry !== 'US' && handlingTimeDays <= 3)
    return { ok: false, code: 'HANDLING_TIME_EXCEEDED', detail: `Estimated 8–12 day ship time exceeds your ${handlingTimeDays}-day handling time` };
  return { ok: true };
}

export function toDiscoveryItem(p: Product): DiscoveryItem {
  const { fees, pricingRule, handlingTimeDays } = state.account;
  const projectedPriceCents = priceForTarget(p.costCents, p.shippingCents, fees, pricingRule);
  const m = computeMargin({ salePriceCents: projectedPriceCents, buyerShippingCents: 0, supplierCostCents: p.costCents, supplierShippingCents: p.shippingCents, toolFeeCents: 0, fees });
  return { ...p, projectedPriceCents, projectedMarginPct: m.netMarginPct, compliance: compliance(p, handlingTimeDays) };
}

export function marginForListing(l: Listing, costOverride?: number): number {
  const p = productById(l.productId);
  if (!p) return l.projectedMarginPct;
  return computeMargin({
    salePriceCents: l.priceCents, buyerShippingCents: l.buyerShippingCents,
    supplierCostCents: costOverride ?? p.costCents, supplierShippingCents: p.shippingCents, toolFeeCents: 0, fees: state.account.fees,
  }).netMarginPct;
}

export function floorPriceFor(l: Listing): number {
  const p = productById(l.productId);
  if (!p) return 0;
  return priceForTarget(p.costCents, p.shippingCents, state.account.fees, { ...state.account.pricingRule, targetPct: state.account.pricingRule.floorPct });
}

export function createListings(productIds: string[]) {
  const created: Listing[] = [];
  const blocked: { productId: string; compliance: ComplianceResult }[] = [];
  for (const pid of productIds) {
    const p = productById(pid);
    if (!p) continue;
    const item = toDiscoveryItem(p);
    if (!item.compliance.ok) {
      blocked.push({ productId: pid, compliance: item.compliance });
      continue;
    }
    const l: Listing = {
      id: nextId('lst'), accountId: 'acc_demo', productId: pid, title: p.title.replace(/\b\w/g, (c) => c.toUpperCase()), description: p.description,
      priceCents: item.projectedPriceCents, floorPriceCents: 0, buyerShippingCents: 0, quantity: Math.min(5, p.stock), status: 'draft',
      projectedMarginPct: item.projectedMarginPct, lastSyncAt: null, createdAt: now(),
    };
    l.floorPriceCents = floorPriceFor(l);
    state.listings.unshift(l);
    pushEvent('listing.created', { title: l.title }, { listingId: l.id });
    created.push(l);
  }
  return { created, blocked };
}

export function publish(ids: string[]) {
  const published: Listing[] = [];
  for (const l of state.listings) {
    if (ids.includes(l.id) && (l.status === 'draft' || l.status === 'paused')) {
      l.status = 'active';
      l.ebayItemId ??= `mock-${Math.random().toString(36).slice(2, 7)}`;
      l.pauseReason = undefined;
      pushEvent('listing.published', { ebayItemId: l.ebayItemId }, { listingId: l.id });
      published.push(l);
    }
  }
  return { published, blocked: [] };
}

export function sync() {
  let repriced = 0, paused = 0, resumed = 0;
  for (const l of state.listings) {
    if (l.status !== 'active' && l.status !== 'paused') continue;
    const p = productById(l.productId);
    if (!p) continue;
    const r = Math.random();
    if (r < 0.2) {
      const drift = 1 + (Math.random() * 0.3 - 0.15);
      p.costCents = Math.round(p.costCents * drift);
      const m = marginForListing(l);
      if (m < state.account.pricingRule.floorPct) {
        if (l.status === 'active') { l.status = 'paused'; l.pauseReason = 'below_floor'; paused++; pushEvent('listing.paused', { reason: 'below_floor' }, { listingId: l.id }); }
      } else if (l.status === 'paused' && l.pauseReason === 'below_floor') {
        l.status = 'active'; l.pauseReason = undefined; resumed++; pushEvent('listing.resumed', {}, { listingId: l.id });
      } else {
        l.priceCents = priceForTarget(p.costCents, p.shippingCents, state.account.fees, state.account.pricingRule); repriced++;
        pushEvent('listing.repriced', { priceCents: l.priceCents }, { listingId: l.id });
      }
      l.projectedMarginPct = marginForListing(l);
      l.floorPriceCents = floorPriceFor(l);
    }
    l.lastSyncAt = now();
  }
  pushEvent('sync.completed', { repriced, paused, resumed });
  return { repriced, paused, resumed, checked: state.listings.length, blocked: 0 };
}

function addLedger(orderId: string, kind: LedgerEntry['kind'], amountCents: number) {
  state.ledger.unshift({ id: nextId('led'), accountId: 'acc_demo', orderId, kind, amountCents, at: now() });
}

function spentToday(): number {
  const today = now().slice(0, 10);
  return state.ledger.filter((e) => (e.kind === 'supplier_cost' || e.kind === 'supplier_shipping') && e.at.startsWith(today)).reduce((s, e) => s - e.amountCents, 0);
}

function placeSupplierOrder(o: Order) {
  o.status = 'ordered';
  o.supplierOrderId = `MS-${Math.floor(88400 + Math.random() * 500)}`;
  o.payoutExpectedAt = new Date(Date.now() + 8 * 86400_000).toISOString();
  addLedger(o.id, 'supplier_cost', -(o.supplierCostCents ?? 0));
  if (o.supplierShippingCents) addLedger(o.id, 'supplier_shipping', -o.supplierShippingCents);
  pushEvent('order.ordered', { supplierOrderId: o.supplierOrderId }, { orderId: o.id });
  state.messages.unshift({ id: nextId('msg'), accountId: 'acc_demo', orderId: o.id, direction: 'out', kind: 'order_confirmed', answered: true, body: `Thanks for your order, ${o.buyerName.split(' ')[0]}. It is being prepared and will ship within ${state.account.handlingTimeDays} business days.`, at: now() });
  window.setTimeout(() => {
    const live = state.orders.find((x) => x.id === o.id);
    if (!live || live.status !== 'ordered') return;
    live.status = 'shipped'; live.carrier = 'USPS'; live.trackingNumber = `94001118992234${Math.floor(10000 + Math.random() * 89999)}`; live.updatedAt = now();
    pushEvent('order.shipped', { carrier: live.carrier, trackingNumber: live.trackingNumber }, { orderId: live.id });
    state.messages.unshift({ id: nextId('msg'), accountId: 'acc_demo', orderId: live.id, direction: 'out', kind: 'shipped', answered: true, body: `Your order has shipped with ${live.carrier}. Tracking: ${live.trackingNumber}.`, at: now() });
  }, 8000);
}

export function simulate(body: { listingId: string; buyerName?: string; priceDriftPct?: number }): Order {
  const l = state.listings.find((x) => x.id === body.listingId);
  if (!l) throw Object.assign(new Error('Listing not found'), { status: 404, code: 'NOT_FOUND' });
  const p = productById(l.productId);
  if (!p) throw Object.assign(new Error('Product not found'), { status: 404, code: 'NOT_FOUND' });
  const cost = Math.max(1, Math.round(p.costCents * (1 + (body.priceDriftPct ?? 0) / 100)));
  const m = computeMargin({ salePriceCents: l.priceCents, buyerShippingCents: l.buyerShippingCents, supplierCostCents: cost, supplierShippingCents: p.shippingCents, toolFeeCents: 0, fees: state.account.fees });
  const id = nextId('ord');
  const o: Order = {
    id, accountId: 'acc_demo', listingId: l.id, ebayOrderId: `eb-sim-${id.slice(4)}`, buyerName: body.buyerName || 'Simulated Buyer',
    shipTo: { name: body.buyerName || 'Simulated Buyer', line1: '77 Mock Lane', city: 'Denver', state: 'CO', postalCode: '80202', country: 'US' },
    salePriceCents: l.priceCents, buyerShippingCents: l.buyerShippingCents, status: 'checking', supplierCostCents: cost, supplierShippingCents: p.shippingCents,
    ebayFeesCents: m.ebayFeesCents, netProfitCents: m.netProfitCents, createdAt: now(), updatedAt: now(),
  };
  state.orders.unshift(o);
  addLedger(o.id, 'sale', o.salePriceCents + o.buyerShippingCents);
  addLedger(o.id, 'ebay_fee', -m.ebayFeesCents);
  pushEvent('order.paid', { salePriceCents: o.salePriceCents }, { orderId: o.id });
  pushEvent('order.checking', { supplierCostCents: cost, previousCostCents: p.costCents, netMarginPct: m.netMarginPct }, { orderId: o.id });

  let decision: LadderDecision;
  if (p.stock === 0) decision = { action: 'cancel', reason: 'out_of_stock' };
  else if (m.netMarginPct >= state.account.pricingRule.floorPct) decision = { action: 'fulfil', reason: 'within_tolerance' };
  else decision = { action: 'hold', reason: 'below_floor', deadline: new Date(Date.now() + state.account.handlingTimeDays * 86400_000 - 12 * 3600_000).toISOString() };
  o.ladderDecision = decision;

  if (decision.action === 'cancel') { o.status = 'cancelled'; pushEvent('order.cancelled', { reason: decision.reason }, { orderId: o.id }); }
  else if (decision.action === 'hold') { o.status = 'held'; o.holdDeadline = decision.deadline; pushEvent('order.held', { deadline: decision.deadline }, { orderId: o.id }); }
  else if (spentToday() + cost + p.shippingCents > state.account.dailySpendCapCents) { o.status = 'queued'; pushEvent('order.queued', { spentTodayCents: spentToday(), capCents: state.account.dailySpendCapCents }, { orderId: o.id }); }
  else placeSupplierOrder(o);
  return o;
}

export function decide(id: string, action: 'fulfil' | 'cancel'): Order {
  const o = state.orders.find((x) => x.id === id);
  if (!o) throw Object.assign(new Error('Order not found'), { status: 404, code: 'NOT_FOUND' });
  if (o.status !== 'held') throw Object.assign(new Error(`Order is ${o.status}, decisions apply to held orders only`), { status: 422, code: 'ORDER_NOT_HELD' });
  pushEvent('order.decision', { action }, { orderId: o.id });
  if (action === 'cancel') { o.status = 'cancelled'; pushEvent('order.cancelled', { reason: 'seller_decision' }, { orderId: o.id }); }
  else placeSupplierOrder(o);
  o.updatedAt = now();
  return o;
}

export function dashboard(): DashboardResponse {
  const floatOrders = state.orders.filter((o) => ['ordered', 'shipped', 'delivered'].includes(o.status) && !o.paidOutAt && o.supplierCostCents !== undefined);
  const byOrder = floatOrders.map((o) => ({
    orderId: o.id,
    listingTitle: state.listings.find((l) => l.id === o.listingId)?.title ?? 'Unknown listing',
    amountCents: (o.supplierCostCents ?? 0) + (o.supplierShippingCents ?? 0),
    payoutExpectedAt: o.status === 'delivered' ? o.payoutExpectedAt ?? null : null,
    status: o.status,
  }));
  const today = now().slice(0, 10);
  const todays = state.orders.filter((o) => o.createdAt.startsWith(today) && o.status !== 'cancelled');
  const count = (s: Listing['status']) => state.listings.filter((l) => l.status === s).length;
  return {
    float: { outstandingCents: byOrder.reduce((s, x) => s + x.amountCents, 0), byOrder },
    today: { orders: todays.length, revenueCents: todays.reduce((s, o) => s + o.salePriceCents, 0), profitCents: todays.reduce((s, o) => s + (o.netProfitCents ?? 0), 0), supplierSpendCents: spentToday(), spendCapCents: state.account.dailySpendCapCents },
    health: { lateShipmentPct: 0.012, defectPct: 0.0, casesOpen: 0, thresholds: { lateShipmentPct: 0.03, defectPct: 0.005 } },
    listings: { active: count('active'), paused: count('paused'), draft: count('draft'), blocked: count('blocked'), ended: count('ended') },
    recentEvents: state.events.slice(0, 12),
  };
}

export function addSupplier(supplier: SupplierKind): SupplierConnection {
  const labels: Record<SupplierKind, string> = { mock: 'Mock supplier (demo catalog)', cjdropshipping: 'CJdropshipping', spocket: 'Spocket' };
  const c: SupplierConnection = { id: nextId('sup'), accountId: 'acc_demo', supplier, status: supplier === 'mock' ? 'connected' : 'not_configured', label: labels[supplier], createdAt: now() };
  state.account.supplierConnections.push(c);
  return c;
}

export { products, productById };
